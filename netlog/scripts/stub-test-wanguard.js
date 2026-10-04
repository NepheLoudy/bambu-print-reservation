/**
 * 离线桩测试 · wanGuard 断网复活引擎（2026-09-27 v2）：
 *   ①wan 断+lan 活 → 复活启动，首选项账号（31108753）永远先试
 *   ②每 tick 一个账号，wan 真恢复才算成功（revive_success + 慢速判定挂起）
 *   ③慢速判定：恢复后 20s 宽限；3 次探针中位数 > 基线×3 → ban「本月不再使用」+ 自动换号
 *   ④慢速通过不 ban；候选用尽 → revive_exhausted + 30 分钟冷却（冷却期内不再触发）
 *   ⑤lan 断时不复活（路由器问题，登录无意义）
 *   ⑥手动 forceRevive 网络已通时也启动（供实测协议）
 * 全部外部依赖走桩；用法：node scripts/stub-test-wanguard.js
 */
const path = require('path');
const os = require('os');
const fs = require('fs');
const { createWanGuard, median } = require(path.join(__dirname, '..', 'src', 'wanGuard.js'));

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
}

/** 内存账号池文件 */
function makePoolFile(accounts, preferred) {
  const f = path.join(os.tmpdir(), `pool-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.json`);
  fs.writeFileSync(f, JSON.stringify({ preferred, accounts, bannedThisMonth: [] }));
  return f;
}

function makeDeps({ poolUsers, preferred = '31108753', baseline = 100, verifySession } = {}) {
  const d = {
    clock: 1_700_000_000_000,
    events: [],
    logins: [],
    banned: [],
    latencyQueue: [],   // probeLatency 依次弹出的值（null=失败）
    wanOk: false,
    lanOk: true,
    trafficOk: true,    // v9 流量探测原始结果（软踢场景置 false）
    lanFailTicks: 0,
    poolFile: makePoolFile(poolUsers.map(([user, password, priority]) => ({ user, password, priority })), preferred),
  };
  const { createAccountPool } = require(path.join(__dirname, '..', 'src', 'accountPool.js'));
  const pool = createAccountPool(d.poolFile, () => new Date(d.clock));
  const guard = createWanGuard({
    candidates: () => pool.listCandidates(),
    authIp: async () => '10.253.32.177',
    login: async (acct) => { d.logins.push(acct.user); },
    probeLatency: async () => (d.latencyQueue.length ? d.latencyQueue.shift() : baseline),
    verifySession,
    ban: (user, reason) => d.banned.push({ user, reason }),
    emit: (event, detail) => d.events.push({ event, detail }),
    now: () => new Date(d.clock),
    tickMs: 60000,
  });
  d.pool = pool;
  d.guard = guard;
  d.nextTick = async () => guard.onTick(d.wanOk, d.lanOk, d.trafficOk);
  return d;
}

(async () => {
  console.log('\n== 1. 断网触发复活：首选项永远先试 ==');
  const d1 = makeDeps({ poolUsers: [['31108753', 'pw1', 1], ['20261103', 'pw2', 2], ['20230104', 'pw3', 6]] });
  d1.wanOk = false;
  await d1.nextTick();
  check('复活启动事件', d1.events.some((e) => e.event === 'revive_start'));
  check('首选项 31108753 第一个 login', d1.logins[0] === '31108753', JSON.stringify(d1.logins));
  check('复活中（待验证）', d1.guard.summary().currentUser === '31108753');

  console.log('\n== 2. 下一 tick 未恢复 → 换号；再下一 tick 恢复 → 成功+慢速判定挂起 ==');
  await d1.nextTick();
  check('未恢复换下一个账号', d1.logins.includes('20261103'));
  d1.wanOk = true;
  await d1.nextTick();
  check('wan 恢复记 revive_success', d1.events.some((e) => e.event === 'revive_success'));
  check('慢速判定挂起', d1.guard.summary().pendingSlow === '20261103');

  console.log('\n== 3. 慢速判定：宽限期内不判，超宽限且探针慢 → ban+换号 ==');
  d1.latencyQueue.push(500, 600, 550); // 中位 550 > 基线(~100+)×3 前提下才会 ban；先看宽限
  await d1.nextTick();
  check('宽限期内（20s 内）不判定', d1.banned.length === 0 && d1.guard.summary().pendingSlow === '20261103');
  d1.clock += 25 * 1000; // 越过 20s 宽限
  d1.latencyQueue.push(500, 600, 550);
  await d1.nextTick();
  check('超基线×3 → 账号被 ban', d1.banned.some((b) => b.user === '20261103'), JSON.stringify(d1.banned));
  check('触发 account_throttled 事件', d1.events.some((e) => e.event === 'account_throttled'));
  const lastLogin = d1.logins[d1.logins.length - 1];
  check('自动换号复活（继续 login 剩余候选，首选项重新优先）',
    lastLogin !== '20261103' && lastLogin === '31108753', JSON.stringify(d1.logins));

  console.log('\n== 4. 恢复后慢速正常 → 不 ban ==');
  const d4 = makeDeps({ poolUsers: [['31108753', 'pw1', 1]], baseline: 100 });
  for (let i = 0; i < 5; i++) { d4.latencyQueue.push(95 + i); await d4.guard.sampleBaseline(); } // 预采样健康基线（~97ms，避免落到 30ms 下限）
  d4.wanOk = false;
  await d4.nextTick();
  d4.wanOk = true;
  await d4.nextTick(); // 恢复，pendingSlow
  d4.clock += 25 * 1000;
  d4.latencyQueue.push(90, 110, 100); // 中位 100 ≤ 基线(~97)×3=291
  await d4.nextTick();
  check('慢速通过：无 ban', d4.banned.length === 0, JSON.stringify(d4.banned));
  check('慢速判定收尾（pendingSlow 清空）', d4.guard.summary().pendingSlow === null);

  console.log('\n== 5. 候选用尽 → exhausted + 冷却期内不再触发 ==');
  const d5 = makeDeps({ poolUsers: [['31108753', 'pw1', 1]] });
  d5.wanOk = false;
  await d5.nextTick(); // login 31108753
  await d5.nextTick(); // 未恢复，队列空 → exhausted
  check('账号用尽记 revive_exhausted', d5.events.some((e) => e.event === 'revive_exhausted'));
  const beforeLogins = d5.logins.length;
  await d5.nextTick(); // 冷却期内
  check('冷却期内不再 login', d5.logins.length === beforeLogins);
  check('summary 带 exhaustedUntil', Boolean(d5.guard.summary().exhaustedUntil));

  console.log('\n== 6. lan 断不复活 ==');
  const d6 = makeDeps({ poolUsers: [['31108753', 'pw1', 1]] });
  d6.wanOk = false;
  d6.lanOk = false;
  await d6.nextTick();
  check('lan 断时无复活动作', d6.logins.length === 0 && !d6.events.some((e) => e.event === 'revive_start'));

  console.log('\n== 7. 手动触发：网络已通也启动（协议实测通道） ==');
  const d7 = makeDeps({ poolUsers: [['31108753', 'pw1', 1]] });
  d7.wanOk = true;
  await d7.guard.forceRevive();
  check('手动触发立即 login', d7.logins.length === 1, JSON.stringify(d7.logins));

  console.log('\n== 8. 基线滑动与下限 ==');
  check('median 工具', median([5, 1, 3]) === 3 && median([4, 1, 3, 2]) === 3); // 偶数长度取中间均值 2.5，round=3

  console.log('\n== 9. 软踢场景（v9）：wan 握手通但流量断 → 触发复活；流量恢复才算成功 ==');
  const d9 = makeDeps({ poolUsers: [['31108753', 'pw1', 1], ['20261103', 'pw2', 2]] });
  d9.wanOk = true;   // TCP 握手全绿
  d9.trafficOk = false; // generate_204 拉不动（软踢/限速）
  await d9.nextTick();
  check('软踢触发复活且事件注明软踢嫌疑', d9.events.some((e) => e.event === 'revive_start' && /软踢/.test(e.detail)), JSON.stringify(d9.events));
  check('软踢下首选项先试', d9.logins[0] === '31108753', JSON.stringify(d9.logins));
  d9.trafficOk = true; // 流量恢复（重新认证生效）
  await d9.nextTick();
  check('wan+traffic 双通才判 revive_success', d9.events.some((e) => e.event === 'revive_success'), JSON.stringify(d9.events.map((e) => e.event)));
  check('慢速判定挂起（pendingSlow=首选项账号）', d9.guard.summary().pendingSlow === '31108753');

  console.log('\n== 10. 软踢复活中流量未恢复：换号继续 ==');
  const d10 = makeDeps({ poolUsers: [['31108753', 'pw1', 1], ['20261103', 'pw2', 2]] });
  d10.wanOk = true;
  d10.trafficOk = false;
  await d10.nextTick(); // login 31108753
  await d10.nextTick(); // 流量仍断 → 换下一个候选
  check('流量未恢复换下一候选', d10.logins.includes('20261103'), JSON.stringify(d10.logins));

  console.log('\n== 11. 近期被踢轮换（v10，曼波定）：复活后 30 分钟内再掉线 → 上次的号排队尾 ==');
  const d11 = makeDeps({ poolUsers: [['31108753', 'pw1', 1], ['20261103', 'pw2', 2], ['20253548', 'pw3', 3]] });
  // 第一轮：正常复活，用首选项 31108753
  d11.wanOk = false;
  await d11.nextTick();
  d11.wanOk = true;
  await d11.nextTick(); // revive_success（31108753）
  check('第一轮复活用首选 31108753', d11.logins[0] === '31108753' && d11.events.some((e) => e.event === 'revive_success'), JSON.stringify(d11.logins));
  check('lastRevive 已登记', d11.guard.summary().lastRevive && d11.guard.summary().lastRevive.user === '31108753', JSON.stringify(d11.guard.summary().lastRevive));
  // 第二轮：29 分钟后又掉线（窗口内）→ 被踢轮换，31108753 排队尾，先试 20261103
  d11.clock += 29 * 60 * 1000;
  d11.wanOk = false;
  d11.trafficOk = true;
  await d11.nextTick();
  check('窗口内再掉线轮换避开刚被踢的号', d11.logins[d11.logins.length - 1] === '20261103', JSON.stringify(d11.logins));
  check('轮换事件注记被踢账号', d11.events.some((e) => e.event === 'revive_start' && /31108753 刚被踢/.test(e.detail)), JSON.stringify(d11.events.filter((e) => e.event === 'revive_start').pop()));
  // 第二轮复活成功用 20261103
  d11.wanOk = true;
  await d11.nextTick();
  check('第二轮复活用 20261103', d11.guard.summary().lastRevive.user === '20261103', JSON.stringify(d11.guard.summary().lastRevive));

  console.log('\n== 12. 轮换窗口过期：全新掉线仍按优先级首选开始 ==');
  const d12 = makeDeps({ poolUsers: [['31108753', 'pw1', 1], ['20261103', 'pw2', 2]] });
  d12.wanOk = false;
  await d12.nextTick();
  d12.wanOk = true;
  await d12.nextTick(); // 第一轮成功（31108753）
  d12.clock += 45 * 60 * 1000; // 45 分钟后（窗口 30 分钟已过）再掉线
  d12.wanOk = false;
  d12.trafficOk = true;
  await d12.nextTick();
  check('窗口外掉线仍首选 31108753（不做无谓轮换）', d12.logins[d12.logins.length - 1] === '31108753', JSON.stringify(d12.logins));

  console.log('\n== 13. 成功判定核会话归属（v12）：出口本通/IP 已被他人放行时拒绝假阳性 ==');
  // 13a: 归属非本账号 → revive_session_mismatch，无假阳性 success、无 lastRevive、挂 30 分钟冷却
  const d13 = makeDeps({ poolUsers: [['31108753', 'pw1', 1]], verifySession: async () => false });
  d13.wanOk = false;
  await d13.nextTick(); // 复活启动 + login 31108753
  check('13a 复活已启动且已 login', d13.logins.length === 1, JSON.stringify(d13.logins));
  d13.wanOk = true; // 「恢复」实为 TCP 代答假阴性（他人会话放行出口）
  await d13.nextTick();
  check('13a 归属非本账号 → revive_session_mismatch', d13.events.some((e) => e.event === 'revive_session_mismatch'), JSON.stringify(d13.events.map((e) => e.event)));
  check('13a 不产生假阳性 revive_success', !d13.events.some((e) => e.event === 'revive_success'), JSON.stringify(d13.events.map((e) => e.event)));
  check('13a 不登记 lastRevive', d13.guard.summary().lastRevive === null, JSON.stringify(d13.guard.summary().lastRevive));
  check('13a 挂 30 分钟冷却', !!d13.guard.summary().exhaustedUntil, d13.guard.summary().exhaustedUntil);
  // 冷却内又掉线（软踢）也不重启复活——防 mismatch 每分钟刷屏
  d13.clock += 60 * 1000;
  d13.trafficOk = false;
  await d13.nextTick();
  check('13a 冷却期内不重启复活（防刷屏）', d13.logins.length === 1, JSON.stringify(d13.logins));

  // 13b: 归属本账号 → 正常成功路径
  const d13b = makeDeps({ poolUsers: [['31108753', 'pw1', 1]], verifySession: async () => true });
  d13b.wanOk = false;
  await d13b.nextTick();
  d13b.wanOk = true;
  await d13b.nextTick();
  check('13b 归属本账号 → 正常 revive_success', d13b.events.some((e) => e.event === 'revive_success'), JSON.stringify(d13b.events.map((e) => e.event)));
  check('13b lastRevive 正常登记', d13b.guard.summary().lastRevive && d13b.guard.summary().lastRevive.user === '31108753', JSON.stringify(d13b.guard.summary().lastRevive));

  // 13c: 验证接口异常 → 降级按 wan 探测放行（不因 online_list 抖动卡死复活）
  const d13c = makeDeps({ poolUsers: [['31108753', 'pw1', 1]], verifySession: async () => { throw new Error('online_list unreachable'); } });
  d13c.wanOk = false;
  await d13c.nextTick();
  d13c.wanOk = true;
  await d13c.nextTick();
  check('13c 验证接口异常 → 降级放行照常 revive_success', d13c.events.some((e) => e.event === 'revive_success'), JSON.stringify(d13c.events.map((e) => e.event)));

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((err) => {
  console.error('测试执行异常:', err);
  process.exit(1);
});
