/**
 * 离线桩测试 · netlog 状态机（2026-09-27 v1，v13 通知节流批扩展）：
 *   ①防抖：单次失败不翻 down，连续 threshold 次才记 lan/wan_down（只记一次）
 *   ②恢复：一次成功即记 up，事件带断开历时（v13 起翻转只落盘不私聊）
 *   ③积压补发：wan 恢复后汇总卡发出、积压清空
 *   ④冲刷竞态回归（quiet-flush v87 同款教训）：补发期间新落盘的积压不被覆盖丢失
 *   ⑤出口 IP 变化：恢复后查到新 IP 记 egress_ip_changed
 *   ⑥通知失败入积压；日志行 JSONL 可解析
 *   ⑫~⑮（v13）：翻转事故聚合（短抖动静默/抖动群汇总卡）、持续断开报警+复报、
 *     revive_session_mismatch 通知冷却、积压补发限频（恢复旁路/攒批/超时兜底）
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
const { createEngine, offlineGapInfo, dohResponseOk } = require(path.join(__dirname, '..', 'src', 'index.js'));

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

  console.log('\n== 3. wan 断→持续→恢复：报警私聊失败积压 → 恢复后汇总补发 + 清空 ==');
  const d3 = makeDeps({});
  const e3 = createEngine(d3);
  global.__dmFail = true; // 模拟断网：私聊发不出去
  d3.wan = false; d3.clock += 60_000;
  await e3.tick(); await e3.tick(); // threshold=2 → wan_down
  check('wan 断开被记录', e3.state.wan === false && d3.logs.some((l) => l.event === 'wan_down'));
  check('v13 翻转只落盘不私聊不积压', d3.backlogFile.length === 0,
    JSON.stringify(d3.backlogFile));
  d3.clock += 11 * 60_000; // 持续断开超 downAlertMs(10min)
  await e3.tick();
  check('持续断开报警私聊失败 → wan_down_sustained 积压 1 条',
    d3.backlogFile.length === 1 && d3.backlogFile[0].event === 'wan_down_sustained',
    JSON.stringify(d3.backlogFile.map((b) => b.event)));
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
  await e5.emit('wan_down_sustained', '关键事件（机器人私聊送达）');
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
  check('连续 2 次失败记 traffic_down 且 v13 起不即时私聊（短抖动静默）', e8.state.traffic === false
    && d8.logs.some((l) => l.event === 'traffic_down')
    && !dmSent.some((t) => t.text.includes('traffic_down')),
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

  console.log('\n== 11. wan 探测 HTTPS 数据面判定（v12）：TCP 代答假阴性免疫 ==');
  check('DoH 合法响应（200 + Status 字段）→ true', dohResponseOk(200, '{"Status":0,"TC":false,"AD":false}'));
  check('captive portal 劫持页（200 但非 DoH JSON）→ false', !dohResponseOk(200, '<html><body>Portal Login</body></html>'));
  check('重定向/拦截（非 200）→ false', !dohResponseOk(302, '') && !dohResponseOk(500, '{"Status":0}'));
  check('空 body / 非 body → false', !dohResponseOk(200, '') && !dohResponseOk(200, null));

  console.log('\n== 12. 翻转事故聚合（v13）：短抖动静默，抖动群达阈值出一张恢复汇总卡 ==');
  const d12 = makeDeps({});
  d12.probeTraffic = async () => d12.traffic;
  d12.traffic = true;
  const e12 = createEngine(d12);
  await e12.tick(); // 首轮 up
  const flap = async (downMs) => {
    d12.traffic = false; await e12.tick(); await e12.tick(); // threshold=2 → down（静默）
    d12.clock += downMs; d12.traffic = true; await e12.tick(); // up（静默）
  };
  const dmCount = () => dmSent.filter((t) => t.text.includes('traffic_recovered')).length;
  await flap(55_000); // 第 1 抖：55s
  check('单次 55s 抖动不私聊不积压', dmCount() === 0 && d12.backlogFile.length === 0,
    `recovered=${dmCount()} backlog=${d12.backlogFile.length}`);
  d12.clock += 5 * 60_000; // 窗口内（<30min）继续抖
  await flap(50_000); // 第 2 抖：累计 105s / 2 次
  check('两次抖动仍低于阈值（105s<5min，2 次<3）不私聊', dmCount() === 0,
    `recovered=${dmCount()}`);
  d12.clock += 5 * 60_000;
  await flap(60_000); // 第 3 抖：3 次 ≥ flapCountAlert → 恢复汇总卡
  const rec12 = dmSent.filter((t) => t.text.includes('traffic_recovered'));
  check('第 3 次抖动触发恢复汇总卡（含次数与累计）',
    rec12.length === 1 && rec12[0].text.includes('3 次') && rec12[0].text.includes('累计'),
    JSON.stringify(rec12.map((t) => t.text.slice(0, 60))));

  console.log('\n== 13. 持续断开报警 + 复报 + 持续断开后恢复（v13） ==');
  const d13 = makeDeps({});
  const e13 = createEngine(d13);
  await e13.tick();
  const before13 = dmSent.length;
  d13.wan = false; d13.clock += 60_000;
  await e13.tick(); await e13.tick(); // wan_down（静默）
  d13.clock += 10 * 60_000 + 30_000; // 越过 downAlertMs(10min)
  await e13.tick();
  let sustained = dmSent.slice(before13).filter((t) => t.text.includes('wan_down_sustained'));
  check('持续 10.5 分钟即时报警', sustained.length === 1, JSON.stringify(sustained.map((t) => t.text.slice(0, 40))));
  d13.clock += 2 * 60 * 60_1000 + 60_000; // 复报窗口（2h）已过
  await e13.tick();
  sustained = dmSent.slice(before13).filter((t) => t.text.includes('wan_down_sustained'));
  check('仍在断开 → 2h 复报一次', sustained.length === 2, `count=${sustained.length}`);
  d13.wan = true; d13.clock += 60_000;
  await e13.tick();
  const rec13 = dmSent.slice(before13).filter((t) => t.text.includes('wan_recovered'));
  check('持续断开后恢复 → wan_recovered 私聊（标明持续断开后）',
    rec13.length === 1 && rec13[0].text.includes('持续断开后'), JSON.stringify(rec13.map((t) => t.text.slice(0, 50))));

  console.log('\n== 14. revive_session_mismatch 通知冷却（v13）：4h 内只私聊一条 ==');
  const d14 = makeDeps({});
  const e14 = createEngine(d14);
  await e14.tick();
  const before14 = dmSent.length;
  await e14.emit('revive_session_mismatch', '归属非 A（第 1 次）');
  check('首条 mismatch 即时私聊', dmSent.length === before14 + 1, `dm=${dmSent.length}`);
  d14.clock += 30 * 60_000; // 拉锯期 30 分钟一轮
  await e14.emit('revive_session_mismatch', '归属非 B（第 2 次）');
  check('冷却期内不私聊、进积压标记 notify-cooldown',
    dmSent.length === before14 + 1
    && d14.backlogFile.some((b) => b.event === 'revive_session_mismatch' && b.error === 'notify-cooldown'),
    `dm=${dmSent.length} backlog=${JSON.stringify(d14.backlogFile.map((b) => b.error))}`);
  d14.clock += 4 * 60 * 60 * 1000 + 60_000;
  await e14.emit('revive_session_mismatch', '归属非 C（冷却已过）');
  check('冷却期满恢复即时私聊', dmSent.length === before14 + 2, `dm=${dmSent.length}`);

  console.log('\n== 15. 积压补发限频（v13）：恢复旁路 / 攒批 / 超时兜底 ==');
  const d15 = makeDeps({});
  const e15 = createEngine(d15);
  await e15.tick();
  const summaries = () => dmSent.filter((t) => t.text.includes('断网期间事件汇总')).length;
  const sumBefore15 = summaries();
  await e15.emit('revive_start', 'p1'); await e15.emit('revive_success', 'p2');
  await e15.tick(); // lastFlushOkAt=0 → 超时兜底路径首冲
  check('首冲（超时兜底）发出汇总卡且积压清空', summaries() === sumBefore15 + 1 && d15.backlogFile.length === 0,
    `sum=${summaries()} backlog=${d15.backlogFile.length}`);
  d15.clock += 30 * 60_000;
  await e15.emit('revive_start', 'p3'); // 单条过程事件
  await e15.tick(); // 未攒批、未超时、无恢复翻转 → 不冲
  check('30 分钟内单条积压不触发补发（限频）', d15.backlogFile.length === 1 && summaries() === sumBefore15 + 1,
    `backlog=${d15.backlogFile.length} sum=${summaries()}`);
  d15.clock += 2 * 60 * 60 * 1000 + 60_000;
  await e15.tick(); // 越过 flushCooldownMs(2h) → 兜底冲
  check('超时兜底补发', d15.backlogFile.length === 0 && summaries() === sumBefore15 + 2,
    `backlog=${d15.backlogFile.length} sum=${summaries()}`);
  d15.clock += 10 * 60_000;
  await e15.emit('revive_start', 'p4'); // 积压 1 条
  d15.wan = false; d15.clock += 60_000;
  await e15.tick(); await e15.tick(); // wan_down（静默）
  d15.wan = true; d15.clock += 60_000;
  await e15.tick(); // wan down→up 翻转 → flushAsap 旁路立即冲
  check('wan 恢复翻转旁路：冷却未到也立即补发', d15.backlogFile.length === 0 && summaries() === sumBefore15 + 3,
    `backlog=${d15.backlogFile.length} sum=${summaries()}`);

  // ⑯（v14）wan 数据面多供应商 AND 判定（2026-10-07「连上没网」事故：受限会话对阿里白名单
  // 真实放行，单源测不出半残态——双源必须全过）
  {
    const { wanPlanePass } = require(path.join(ROOT2, 'src', 'index.js'));
    const ok = async () => true, bad = async () => false;
    check('⑯a 双源全过 → true', (await wanPlanePass(['a', 'b'], ok)) === true);
    check('⑯b 任一失败 → false', (await wanPlanePass(['a', 'b'], async (u) => u === 'a')) === false);
    check('⑯c 空目标表 → false（保守）', (await wanPlanePass([], ok)) === false);
  }

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((err) => {
  console.error('测试执行异常:', err);
  process.exit(1);
});
