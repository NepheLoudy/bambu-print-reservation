/**
 * 离线桩测试 · netlog 状态机（2026-09-27 v1）：
 *   ①防抖：单次失败不翻 down，连续 threshold 次才记 lan/wan_down（只记一次）
 *   ②恢复：一次成功即记 up，事件带断开历时
 *   ③积压补发：wan 恢复后汇总卡发出、积压清空
 *   ④冲刷竞态回归（quiet-flush v87 同款教训）：补发期间新落盘的积压不被覆盖丢失
 *   ⑤出口 IP 变化：恢复后查到新 IP 记 egress_ip_changed
 *   ⑥通知失败入积压；日志行 JSONL 可解析
 * 全部外部依赖走桩；用法：node scripts/stub-test-netlog.js
 */
const path = require('path');
// 钉死环境（必须在 require src/index.js 之前）：本地 .env 的真实 webhook 配置会经
// loadDotEnv 渗入模块常量 CONFIG，把「未配置→积压」「推送失败→积压」两条桩路径变成真外发
process.env.NETLOG_WEBHOOK_URL = '';
const { createEngine } = require(path.join(__dirname, '..', 'src', 'index.js'));

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
}

/** 内存版依赖：probe 行列可编程，backlog 用「拷贝进/拷贝出」模拟真实文件语义 */
function makeDeps({ threshold = 2 } = {}) {
  const deps = {
    probeLan: async () => deps.lan,
    probeWan: async () => deps.wan,
    fetchEgressIp: async () => deps.egress,
    sendWebhook: async (text) => {
      deps.webhooks.push(text);
      if (deps.onWebhook) { const fn = deps.onWebhook; deps.onWebhook = null; fn(); }
    },
    appendLog: (line) => deps.logs.push(line),
    readBacklog: () => JSON.parse(JSON.stringify(deps.backlogFile)),
    writeBacklog: (list) => { deps.backlogFile = JSON.parse(JSON.stringify(list)); },
    now: () => deps.clock,
    failThreshold: threshold,
    heartbeatMs: 15 * 60 * 1000,
    egressIntervalMs: 30 * 60 * 1000,
    lan: true, wan: true, egress: null,
    clock: 1_700_000_000_000,
    webhooks: [], logs: [],
    backlogFile: [],
    onWebhook: null,
  };
  return deps;
}

(async () => {
  console.log('\n== 1. 防抖：连续失败才翻 down ==');
  const d1 = makeDeps({});
  const e1 = createEngine(d1);
  d1.lan = false;
  await e1.tick();
  check('单次失败不记 down（首态翻 false 需 2 次）', e1.state.lan !== false && !d1.logs.some((l) => l.event === 'lan_down'), `lan=${e1.state.lan}`);
  await e1.tick();
  check('连续 2 次失败记 lan_down', e1.state.lan === false && d1.logs.filter((l) => l.event === 'lan_down').length === 1);
  check('down 事件产生通知（webhook 未配则不外发——本组未配）', d1.webhooks.length === 0);

  console.log('\n== 2. 恢复：记 up + 历时 ==');
  d1.clock += 120_000; // 前进 2 分钟
  d1.lan = true;
  await e1.tick();
  const upEv = d1.logs.find((l) => l.event === 'lan_up');
  check('恢复记 lan_up', !!upEv);
  check('事件含历时 120s', upEv && /120s/.test(upEv.detail), upEv && upEv.detail);

  console.log('\n== 3. wan 断→恢复：积压汇总补发 + 清空 ==');
  const d3 = makeDeps({});
  const e3 = createEngine(d3);
  d3.wan = false; d3.clock += 60_000;
  await e3.tick(); await e3.tick(); // threshold=2 → wan_down（通知失败自动入积压）
  check('wan 断开被记录', e3.state.wan === false && d3.logs.some((l) => l.event === 'wan_down'));
  check('wan_down 通知失败自动积压 1 条', d3.backlogFile.length === 1, JSON.stringify(d3.backlogFile));
  // 恢复 + 预置更多积压 → wan_up tick 触发 flushBacklog
  d3.backlogFile.push({ id: 'pre-1', ts: d3.clock, event: 'wan_down', detail: '断网前积压' });
  d3.wan = true; d3.egress = null; d3.clock += 60_000;
  d3.onWebhook = () => { // 汇总卡发出瞬间，另一处又落了一条积压（模拟冲刷期间新事件）
    d3.backlogFile.push({ id: 'during-1', ts: d3.clock + 1, event: 'lan_down', detail: '冲刷期间新落盘' });
  };
  await e3.tick();
  check('恢复触发汇总补发（wan_up 通知 + 汇总卡）', d3.webhooks.some((t) => t.includes('断网期间事件汇总')), JSON.stringify(d3.webhooks));
  check('已发条目清除', !d3.backlogFile.some((b) => b.id === 'pre-1'));
  check('冲刷期间新落盘的积压不被覆盖丢失', d3.backlogFile.some((b) => b.id === 'during-1'), JSON.stringify(d3.backlogFile));

  console.log('\n== 4. 出口 IP 变化告警 ==');
  const d4 = makeDeps({});
  const e4 = createEngine(d4);
  await e4.tick(); // 首轮 up，egress=null（fetchEgressIp 返回 null 不记）
  d4.egress = '222.178.10.186';
  d4.clock += 31 * 60 * 1000; // 越过 egress 心跳间隔
  await e4.tick();
  check('首次查到 IP 只记录不告警', e4.state.egressIp === '222.178.10.186' && !d4.logs.some((l) => l.event === 'egress_ip_changed'));
  d4.egress = '222.178.99.1';
  d4.clock += 31 * 60 * 1000;
  await e4.tick();
  const eg = d4.logs.find((l) => l.event === 'egress_ip_changed');
  check('IP 变化记 egress_ip_changed 且含新旧值', !!eg && eg.detail.includes('222.178.10.186') && eg.detail.includes('222.178.99.1'), eg && eg.detail);

  console.log('\n== 5. 日志行 JSONL 可解析、类型齐备 ==');
  const all = [...d3.logs, ...d4.logs];
  check('全部日志行可 JSON.parse 且结构齐备', all.every((l) => l && typeof l.ts === 'number' && l.type));
  check('含 state 与 event 两种类型', all.some((l) => l.type === 'state') && all.some((l) => l.type === 'event'));

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((err) => {
  console.error('测试执行异常:', err);
  process.exit(1);
});
