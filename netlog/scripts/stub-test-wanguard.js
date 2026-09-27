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

function makeDeps({ poolUsers, preferred = '31108753', baseline = 100 } = {}) {
  const d = {
    clock: 1_700_000_000_000,
    events: [],
    logins: [],
    banned: [],
    latencyQueue: [],   // probeLatency 依次弹出的值（null=失败）
    wanOk: false,
    lanOk: true,
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
    ban: (user, reason) => d.banned.push({ user, reason }),
    emit: (event, detail) => d.events.push({ event, detail }),
    now: () => new Date(d.clock),
    tickMs: 60000,
  });
  d.pool = pool;
  d.guard = guard;
  d.nextTick = async () => guard.onTick(d.wanOk, d.lanOk);
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

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((err) => {
  console.error('测试执行异常:', err);
  process.exit(1);
});
