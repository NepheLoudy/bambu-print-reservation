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
// feishu 模块桩：机器人本体私聊走这里（dmSent 记录送达）
const ROOT2 = path.join(__dirname, '..');
const feishuPath = require.resolve(path.join(ROOT2, 'src', 'feishu.js'));
require(feishuPath);
const dmSent = [];
require.cache[feishuPath].exports = {
  NOTIFY_OPEN_IDS: ['ou_test'],
  sendTextToOpenId: async (oid, text) => {
    if (global.__dmFail) throw new Error('模拟私聊失败（断网时发不出去）');
    dmSent.push({ oid, text });
    if (global.__onDm) { const fn = global.__onDm; global.__onDm = null; fn(); }
  },
};
const { createEngine, offlineGapInfo } = require(path.join(__dirname, '..', 'src', 'index.js'));

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

  console.log('\n== 3. wan 断→恢复：私聊失败积压 → 恢复后汇总补发 + 清空 ==');
  const d3 = makeDeps({});
  const e3 = createEngine(d3);
  global.__dmFail = true; // 模拟断网：私聊发不出去
  d3.wan = false; d3.clock += 60_000;
  await e3.tick(); await e3.tick(); // threshold=2 → wan_down
  check('wan 断开被记录', e3.state.wan === false && d3.logs.some((l) => l.event === 'wan_down'));
  check('私聊失败 → wan_down 积压 1 条', d3.backlogFile.length === 1, JSON.stringify(d3.backlogFile));
  // 恢复私聊 + 预置更多积压 → wan_up tick 触发 flushBacklog
  global.__dmFail = false;
  d3.backlogFile.push({ id: 'pre-1', ts: d3.clock, event: 'wan_down', detail: '断网前积压' });
  d3.wan = true; d3.egress = null; d3.clock += 60_000;
  global.__onDm = () => { // 汇总卡发出瞬间，另一处又落了一条积压（模拟冲刷期间新事件）
    d3.backlogFile.push({ id: 'during-1', ts: d3.clock + 1, event: 'lan_down', detail: '冲刷期间新落盘' });
  };
  await e3.tick();
  check('恢复触发汇总补发（汇总卡经私聊发出）', dmSent.some((t) => t.text.includes('断网期间事件汇总')), JSON.stringify(dmSent.map((t) => t.text.slice(0, 30))));
  check('已发条目清除', !d3.backlogFile.some((b) => b.id === 'pre-1'));
  check('冲刷期间新落盘的积压不被覆盖丢失（保留或已补发均算不丢）',
    d3.backlogFile.some((b) => b.id === 'during-1') || dmSent.some((t) => t.text.includes('冲刷期间新落盘')),
    `backlog=${JSON.stringify(d3.backlogFile.map((b) => b.id))} dmSent=${dmSent.length}`);

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

  console.log('\n== 5. 事件分级：过程事件只积压不外发（2026-09-28 刷屏事故回归） ==');
  const d5e = makeDeps({});
  const e5 = createEngine(d5e);
  d5e.clock += 1000;
  await e5.emit('revive_start', '过程事件（不该外发）');
  await e5.emit('account_throttled', '过程事件（不该外发）');
  check('过程事件进积压且标记 process-event',
    d5e.backlogFile.length === 2 && d5e.backlogFile.every((b) => b.error === 'process-event'),
    JSON.stringify(d5e.backlogFile.map((b) => [b.event, b.error])));
  check('过程事件不调 webhook 外发', d5e.webhooks.length === 0);
  d5e.clock += 1000;
  await e5.emit('wan_down', '关键事件（机器人私聊送达）');
  check('关键事件经机器人私聊送达、不积压', d5e.backlogFile.length === 2 && dmSent.length >= 1,
    `backlog=${d5e.backlogFile.length} dmSent=${dmSent.length}`);

  console.log('\n== 6. 日志行 JSONL 可解析、类型齐备 ==');
  const all = [...d3.logs, ...d4.logs];
  check('全部日志行可 JSON.parse 且结构齐备', all.every((l) => l && typeof l.ts === 'number' && l.type));
  check('含 state 与 event 两种类型', all.some((l) => l.type === 'state') && all.some((l) => l.type === 'event'));

  console.log('\n== 7. 复活自愈型断网：无状态机翻转也冲积压 + DownSince 清零（2026-10-04） ==');
  const d7 = makeDeps({});
  const e7 = createEngine(d7);
  await e7.tick(); // 首轮 up
  // guard 式自愈：单轮 wan 失败（原始信号触发复活，2 轮防抖未命中 → 状态机从未翻 down）
  d7.wan = false; d7.clock += 60_000;
  await e7.tick();
  await e7.emit('revive_start', '复活启动（过程事件）');
  await e7.emit('revive_success', '复活成功（过程事件）');
  check('单轮失败不翻 down（复活先于防抖的场景）', e7.state.wan === true && !d7.logs.some((l) => l.event === 'wan_down'));
  check('过程事件滞留积压', d7.backlogFile.length === 2, JSON.stringify(d7.backlogFile.map((b) => b.event)));
  d7.wan = true; d7.clock += 60_000;
  await e7.tick(); // wanOk → 每轮冲刷（不依赖 down→up 翻转）
  check('无翻转恢复也补发汇总卡（复活通知送达）', dmSent.some((t) => t.text.includes('复活成功')), JSON.stringify(dmSent.map((t) => t.text.slice(0, 40))));
  check('积压清空（滞留自愈）', d7.backlogFile.length === 0, JSON.stringify(d7.backlogFile.map((b) => b.event)));
  // DownSince 清零：真 down→up 后 summary 不再挂旧断开时刻
  d7.wan = false; d7.clock += 60_000;
  await e7.tick(); await e7.tick(); // threshold=2 → wan_down
  d7.wan = true; d7.clock += 60_000;
  await e7.tick(); // wan_up
  check('恢复后 wanDownSince 清零（summary 不挂旧时刻）', e7.summary().wanDownSince === null, String(e7.summary().wanDownSince));

  console.log('\n== 8. 流量探测维度（v9）：防抖翻转 + 状态行带 traffic + onTick 收到 trafficOk ==');
  const d8 = makeDeps({});
  d8.probeTraffic = async () => d8.traffic;
  d8.traffic = true;
  const guardSeen = [];
  d8.onTick = async (wanOk, lanOk, trafficOk) => { guardSeen.push(trafficOk); };
  const e8 = createEngine(d8);
  await e8.tick();
  check('状态行带 traffic 字段', d8.logs.some((l) => l.type === 'state' && l.traffic === true), JSON.stringify(d8.logs.filter((l) => l.type === 'state')[0]));
  check('onTick 收到 trafficOk=true', guardSeen[0] === true, JSON.stringify(guardSeen));
  d8.traffic = false;
  await e8.tick();
  check('单次流量失败不翻 down（防抖）', e8.state.traffic !== false && !d8.logs.some((l) => l.event === 'traffic_down'));
  await e8.tick();
  check('连续 2 次失败记 traffic_down 且即时私聊', e8.state.traffic === false
    && d8.logs.some((l) => l.event === 'traffic_down')
    && dmSent.some((t) => t.text.includes('traffic_down')),
  `dmSent=${dmSent.map((t) => t.text.slice(0, 25)).join('|')}`);
  check('onTick 收到 trafficOk=false（guard 软踢触发入口）', guardSeen[guardSeen.length - 1] === false);
  d8.traffic = true;
  await e8.tick();
  check('一次成功即记 traffic_up', e8.state.traffic === true && d8.logs.some((l) => l.event === 'traffic_up'));

  console.log('\n== 9. 未注入流量探针时兼容（trafficOk 恒真，不产生事件/噪声） ==');
  const d9 = makeDeps({});
  const e9 = createEngine(d9);
  await e9.tick();
  check('traffic 恒真且无 traffic_* 事件', e9.state.traffic === true && !d9.logs.some((l) => String(l.event || '').startsWith('traffic')));

  console.log('\n== 10. 断电感知判定（v11）：离线间隔超阈值 → 报告；常规重启/首跑 → null ==');
  const NOW = 1_760_000_000_000;
  check('首跑无历史返回 null', offlineGapInfo(0, NOW, 15 * 60000) === null);
  check('秒级常规重启返回 null', offlineGapInfo(NOW - 8 * 1000, NOW, 15 * 60000) === null);
  const g1 = offlineGapInfo(NOW - 10 * 60000, NOW, 15 * 60000);
  check('10 分钟间隔低于阈值（15 分钟）返回 null', g1 === null);
  const g2 = offlineGapInfo(NOW - 20 * 60000, NOW, 15 * 60000);
  check('20 分钟间隔触发报告且按分钟表述', g2 && g2.human === '20 分钟', JSON.stringify(g2));
  const g3 = offlineGapInfo(NOW - 10.2 * 3600 * 1000, NOW, 15 * 60000);
  check('10.2 小时断电按小时表述', g3 && g3.human === '10.2 小时', JSON.stringify(g3));
  const g4 = offlineGapInfo(NOW - 26 * 3600 * 1000, NOW, 15 * 60000);
  check('26 小时断电按天表述', g4 && g4.human === '1.1 天', JSON.stringify(g4));

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((err) => {
  console.error('测试执行异常:', err);
  process.exit(1);
});
