/**
 * 本地冒烟测试（不依赖飞书凭证）：
 * 启动两个 mock 消费者 + 无凭证网关，通过 /api/dispatch 验证路由、模式、legacy 转换与去重。跑完自清理。
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const CWD = __dirname;
let failures = 0;

function assert(name, cond, detail) {
  if (cond) {
    console.log(`✓ ${name}`);
  } else {
    failures++;
    console.error(`✗ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

// mock 消费者：记录收到的请求，通过 /__requests 查看
function startMockWithList(port, name) {
  const requests = [];
  const handler = (req, res) => {
    if (req.url === '/__requests') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(requests));
      return;
    }
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let parsed = null;
      try { parsed = JSON.parse(body); } catch (e) {}
      requests.push({ url: req.url, body: parsed });
      console.log(`[${name}] ${req.url} ${body.slice(0, 300)}`);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ reply: 'mock-reply' }));
    });
  };
  const server = http.createServer(handler);
  server.listen(port, () => console.log(`[${name}] up on :${port}`));
  return { requests };
}

async function main() {
  const mockA = startMockWithList(3999, 'MOCK-A(mock)');
  const mockB = startMockWithList(3998, 'MOCK-B(mocklegacy)');

  const gateway = spawn('node', ['src/index.js'], {
    cwd: CWD,
    env: Object.assign({}, process.env, {
      PORT: '3010',
      APP_ID: '',
      APP_SECRET: '',
      CONSUMERS:
        'mock|http://localhost:3999/api/feishu/event|http://localhost:3999/api/chat/command;mocklegacy|http://localhost:3998/api/feishu/event||legacy',
      DEFAULT_TARGET: 'mock',
      MESSAGE_ROUTES: JSON.stringify([
        { match: { prefix: '/approval' }, target: 'mock', mode: 'command' },
        { match: { contains: 'accept-order', mention: true }, target: 'mocklegacy', mode: 'event' },
      ]),
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  gateway.stdout.on('data', (d) => process.stdout.write('[GW] ' + d));
  gateway.stderr.on('data', (d) => process.stdout.write('[GW!] ' + d));

  function msgEvent(messageId, text, extra) {
    const extraEvent = Object.assign({}, extra);
    const extraMessage = extraEvent.message || {};
    delete extraEvent.message;
    return {
      type: 'im.message.receive_v1',
      event: Object.assign(extraEvent, {
        message: Object.assign(
          {
            message_id: messageId,
            message_type: 'text',
            chat_type: 'group',
            chat_id: 'oc_test',
            content: JSON.stringify({ text }),
          },
          extraMessage
        ),
        sender: { sender_id: { open_id: 'ou_test' } },
      }),
    };
  }

  async function dispatch(body) {
    const res = await fetch('http://localhost:3010/api/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.json();
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(1500);

  try {
    const health = await (await fetch('http://localhost:3010/api/health')).json();
    assert('health: ws 未配凭证时 stopped', health.ws === 'stopped');
    assert(
      'health: 消费者解析正确（legacy 标记生效）',
      health.consumers.length === 2 && health.consumers[0].name === 'mock' && health.consumers[1].legacy === true,
      JSON.stringify(health.consumers)
    );

    // 1. /approval 指令 → command 模式转发到指令端点
    await dispatch(msgEvent('m1', '/approval-list'));
    await sleep(300);
    const cmdReqs = mockA.requests.filter((r) => r.url === '/api/chat/command');
    assert(
      '指令路由: /approval-list → mock 指令端点',
      cmdReqs.length === 1 && cmdReqs[0].body && cmdReqs[0].body.command === '/approval-list',
      JSON.stringify(mockA.requests)
    );

    // 2. 普通消息 → 默认目标 event 模式
    await dispatch(msgEvent('m2', 'hello world'));
    await sleep(300);
    const evtReqs = mockA.requests.filter((r) => r.url === '/api/feishu/event');
    assert(
      '默认路由: 普通消息 → mock 事件端点（原始事件结构）',
      evtReqs.length === 1 && evtReqs[0].body && evtReqs[0].body.header.event_type === 'im.message.receive_v1'
        && evtReqs[0].body.event.message.message_id === 'm2',
      JSON.stringify(evtReqs)
    );

    // 3. @机器人 + 关键词 → mocklegacy（event 模式）
    await dispatch(
      msgEvent('m3', '@_user_1 please accept-order', {
        message: {
          mentions: [{ key: '@_user_1', id: 'self', mentioned_type: 'app' }],
        },
      })
    );
    await sleep(300);
    assert(
      'mention+contains 路由: → mocklegacy 事件端点',
      mockB.requests.length === 1 && mockB.requests[0].url === '/api/feishu/event',
      JSON.stringify(mockB.requests)
    );

    // 4. bitable V2 事件 → 普通消费者收 V2 帧，legacy 消费者收到拆分的旧版单记录事件
    await dispatch({
      type: 'drive.file.bitable_record_changed_v1',
      event: {
        table_id: 'tblX',
        action_list: [
          { action: 'record_added', record_id: 'recA' },
          { action: 'record_edited', record_id: 'recB', after_value: { status: 'approved' } },
        ],
      },
    });
    await sleep(300);
    const aBitable = mockA.requests.filter((r) => r.url === '/api/feishu/event' && r.body && r.body.header.event_type === 'drive.file.bitable_record_changed_v1');
    assert(
      'bitable 广播: mock 收到 1 条 V2 帧（含 action_list）',
      aBitable.length === 1 && aBitable[0].body.event.action_list.length === 2,
      JSON.stringify(mockA.requests)
    );
    const bLegacy = mockB.requests.filter((r) => r.url === '/api/feishu/event' && r.body && r.body.header && r.body.header.event_type && r.body.header.event_type.startsWith('bitable.record.'));
    const updateFrame = bLegacy.find((r) => r.body.header.event_type === 'bitable.record.update');
    assert(
      'bitable legacy 转换: mocklegacy 收到 create/update 单记录事件',
      bLegacy.length === 2 && !!updateFrame && updateFrame.body.event.record.fields.status === 'approved',
      JSON.stringify(mockB.requests)
    );

    // 5. 相同 message_id 重复投递 → 去重跳过
    const dup = await dispatch(msgEvent('m1', '/approval-list'));
    assert('去重: 重复 message_id 被跳过', dup.duplicated === true, JSON.stringify(dup));
  } finally {
    gateway.kill();
    await sleep(300);
  }

  console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('冒烟测试异常:', err);
  process.exit(1);
});
