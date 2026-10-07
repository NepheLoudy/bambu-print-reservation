/**
 * 离线桩测试 · routerWatch 主路由无线状态观测（2026-10-07 v14）：
 *   ①正常状态 → 不发任何事件
 *   ②管理面失联（web/登录失败）→ router_mgmt_down 事件，且持续失联不重发
 *   ③失联恢复 → router_mgmt_recover 事件
 *   ④射频 status 翻转为非运行态 → router_radio_down 事件（持续异常不重发）
 *   ⑤ax 翻转 → router_ax_changed 事件
 *   ⑥NETLOG_ROUTER_PASSWORD 未配置 → 停用（tick 返回 skipped，零动作）
 * 全部外部依赖走桩；用法：node scripts/stub-test-routerwatch.js
 */
const path = require('path');
const { createRouterWatch } = require(path.join(__dirname, '..', 'src', 'routerWatch.js'));

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
}

const LOGIN_PAGE = `<html><script>var deviceId='aabbccddeeff';var key='1234567890abcdef';</script></html>`;
/** 构造 mock fetch：按 scenario 返回 web/login/wifi_detail_all */
function makeFetch(state) {
  return async (url, opts = {}) => {
    const u = String(url);
    const res = (body, type = 'text/html') => ({
      text: async () => body,
      headers: { getSetCookie: () => ['x=x; path=/'] },
      cookie: 'x=x',
    });
    if (u.includes('/cgi-bin/luci/web')) {
      if (state.mgmtDown) throw new Error('connect EHOSTUNREACH');
      return res(LOGIN_PAGE);
    }
    if (u.includes('/api/xqsystem/login')) {
      if (state.mgmtDown) throw new Error('connect EHOSTUNREACH');
      return res(JSON.stringify({ token: 'stok-test' }), 'application/json');
    }
    if (u.includes('/api/xqnetwork/wifi_detail_all')) {
      if (state.mgmtDown) throw new Error('connect EHOSTUNREACH');
      const info = state.radios || [
        { ifname: 'wl0', status: '1', ax: '1', ssid: 'SuperQianLi_5G' },
        { ifname: 'wl1', status: '1', ax: '1', ssid: 'SuperQianLi' },
      ];
      return res(JSON.stringify({ info, code: 0 }), 'application/json');
    }
    throw new Error('unexpected url ' + u);
  };
}

function makeWatcher(state, events) {
  return createRouterWatch({
    host: '192.168.31.1',
    password: 'test-pwd',
    emit: async (event, detail) => { events.push({ event, detail }); },
    fetchImpl: makeFetch(state),
    now: () => new Date(),
  });
}

(async () => {
  console.log('—— routerWatch 桩测试 ——');

  // ① 正常：无事件
  {
    const state = {};
    const events = [];
    const w = makeWatcher(state, events);
    const r1 = await w.tick();
    check('①正常首拍无事件', events.length === 0 && r1.mgmtDown === false);
    await w.tick();
    check('①正常第二拍仍无事件', events.length === 0);
    check('①summary enabled 且 mgmtOk', (() => { const s = w.summary(); return s.enabled === true && s.mgmtOk === true; })());
  }

  // ② 管理面失联：down 一次，持续失联不重发
  {
    const state = { mgmtDown: true };
    const events = [];
    const w = makeWatcher(state, events);
    await w.tick();
    check('②失联首拍发 router_mgmt_down', events.filter((e) => e.event === 'router_mgmt_down').length === 1);
    await w.tick();
    await w.tick();
    check('②持续失联不重发', events.filter((e) => e.event === 'router_mgmt_down').length === 1);
  }

  // ③ 失联恢复
  {
    const state = { mgmtDown: true };
    const events = [];
    const w = makeWatcher(state, events);
    await w.tick();
    state.mgmtDown = false;
    await w.tick();
    check('③恢复发 router_mgmt_recover', events.some((e) => e.event === 'router_mgmt_recover'));
  }

  // ④ 射频 status 翻异常：radio_down 一次；持续异常不重发；恢复后再翻再发
  {
    const state = {};
    const events = [];
    const w = makeWatcher(state, events);
    await w.tick(); // 基线（正常）
    state.radios = [
      { ifname: 'wl0', status: '0', ax: '1', ssid: 'SuperQianLi_5G' },
      { ifname: 'wl1', status: '1', ax: '1', ssid: 'SuperQianLi' },
    ];
    await w.tick();
    const downs = events.filter((e) => e.event === 'router_radio_down');
    check('④status 翻异常发 router_radio_down', downs.length === 1 && downs[0].detail.includes('wl0'));
    await w.tick();
    check('④持续异常不重发', events.filter((e) => e.event === 'router_radio_down').length === 1);
    state.radios = null; // 恢复正常
    await w.tick();
    state.radios = [
      { ifname: 'wl0', status: '0', ax: '1', ssid: 'SuperQianLi_5G' },
      { ifname: 'wl1', status: '1', ax: '1', ssid: 'SuperQianLi' },
    ];
    await w.tick();
    check('④恢复后再次翻异常再发', events.filter((e) => e.event === 'router_radio_down').length === 2);
  }

  // ⑤ ax 翻转
  {
    const state = {};
    const events = [];
    const w = makeWatcher(state, events);
    await w.tick(); // 基线 ax=1
    state.radios = [
      { ifname: 'wl0', status: '1', ax: '0', ssid: 'SuperQianLi_5G' },
      { ifname: 'wl1', status: '1', ax: '0', ssid: 'SuperQianLi' },
    ];
    await w.tick();
    const flips = events.filter((e) => e.event === 'router_ax_changed');
    check('⑤ax 翻转发事件', flips.length === 2 && flips.every((e) => e.detail.includes('1→0')));
    await w.tick();
    check('⑤ax 稳定不重发', events.filter((e) => e.event === 'router_ax_changed').length === 2);
  }

  // ⑥ 未配置密码：停用
  {
    const w = createRouterWatch({ host: '192.168.31.1', password: '', emit: async () => {}, fetchImpl: makeFetch({}) });
    const r = await w.tick();
    check('⑥无密码时停用（skipped）', r.skipped === 'disabled');
    check('⑥summary enabled=false', w.summary().enabled === false);
  }

  console.log(`\n结果: ${pass} pass / ${fail} fail`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((err) => {
  console.error('测试执行异常:', err);
  process.exit(1);
});
