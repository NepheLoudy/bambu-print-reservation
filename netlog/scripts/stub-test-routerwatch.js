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
    if (u.includes('/api/misystem/devicelist')) {
      if (state.mgmtDown) throw new Error('connect EHOSTUNREACH');
      const n = state.clients == null ? 10 : state.clients;
      return res(JSON.stringify({ list: Array.from({ length: n }, (_, i) => ({ mac: i })) }), 'application/json');
    }
    throw new Error('unexpected url ' + u);
  };
}

function makeWatcher(state, events, extra = {}) {
  return createRouterWatch({
    host: '192.168.31.1',
    password: 'test-pwd',
    emit: async (event, detail) => { events.push({ event, detail }); },
    fetchImpl: makeFetch(state),
    now: () => new Date(),
    ...extra,
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

  // ⑦（v16）DHCP 探测：连续 2 次失败才 down；恢复报 recover；skipped 静默
  {
    const state = {};
    const events = [];
    let dhcpResult = { ok: true };
    const w = makeWatcher(state, events, { dhcpProbe: async () => dhcpResult, dhcpFailThreshold: 2 });
    await w.tick(); // 基线（DHCP ok）
    dhcpResult = { ok: false, reason: 'timeout' };
    await w.tick();
    check('⑦DHCP 首败（<threshold）不报警', events.filter((e) => e.event === 'router_dhcp_down').length === 0);
    await w.tick();
    check('⑦连续 2 次失败报 router_dhcp_down', events.filter((e) => e.event === 'router_dhcp_down').length === 1);
    await w.tick();
    check('⑦持续失败不重发', events.filter((e) => e.event === 'router_dhcp_down').length === 1);
    dhcpResult = { ok: true };
    await w.tick();
    check('⑦恢复报 router_dhcp_recover', events.some((e) => e.event === 'router_dhcp_recover'));
  }
  {
    const state = {};
    const events = [];
    const w = makeWatcher(state, events, { dhcpProbe: async () => ({ ok: false, skipped: 'bind', reason: 'EADDRINUSE' }) });
    await w.tick();
    await w.tick();
    check('⑦skipped 静默降级不告警', events.filter((e) => e.event.startsWith('router_dhcp')).length === 0);
  }

  // ⑧（v16）在线设备数骤降旁证：基线≥6、低于 50% 报 massdrop，回升报 recover
  {
    const state = {};
    const events = [];
    const w = makeWatcher(state, events);
    state.clients = 10; await w.tick();
    state.clients = 10; await w.tick();
    state.clients = 10; await w.tick(); // 基线 10
    check('⑧正常基线无事件', events.length === 0);
    state.clients = 4; await w.tick();
    check('⑧骤降（10→4）报 router_clients_massdrop', events.filter((e) => e.event === 'router_clients_massdrop').length === 1);
    await w.tick();
    check('⑧持续骤降不重发', events.filter((e) => e.event === 'router_clients_massdrop').length === 1);
    state.clients = 9; await w.tick();
    check('⑧回升报 router_clients_recover', events.some((e) => e.event === 'router_clients_recover'));
  }

  // ⑨（v16）DHCP DISCOVER 报文结构（dhcpProbe.buildDiscover）
  {
    const { buildDiscover } = require(path.join(__dirname, '..', 'src', 'dhcpProbe.js'));
    const { buf, xid } = buildDiscover();
    check('⑨op=BOOTREQUEST + magic cookie', buf[0] === 1 && buf.readUInt32BE(236) === 0x63825363);
    check('⑨option53=DHCPDISCOVER + end 标记', buf[240] === 53 && buf[242] === 1 && buf[243] === 255);
    check('⑨xid 与报文一致', buf.readUInt32BE(4) === xid);
    check('⑨flags 广播位', buf.readUInt16BE(10) === 0x8000);
  }

  // ⑩（v17）固定探针 MAC：陌生 MAC 检查路径伪影勘误——探针必须走固定身份
  {
    const d = require(path.join(__dirname, '..', 'src', 'dhcpProbe.js'));
    const { buf } = d.buildDiscover({ mac: d.DEFAULT_PROBE_MAC });
    check('⑩固定 MAC 写入 chaddr', d.DEFAULT_PROBE_MAC.every((b, i) => buf[28 + i] === b));
    check('⑩默认探针 MAC 为本地管理位且 6 字节', d.DEFAULT_PROBE_MAC.length === 6 && d.DEFAULT_PROBE_MAC[0] % 2 === 0);
    check('⑩默认超时 ≥5000ms（覆盖陌生检查最坏 ~3.9s）', d.PROBE_TIMEOUT_MS >= 5000);
    check('⑩buildDiscover 缺省 mac 仍随机（历史行为）', (() => {
      const a = d.buildDiscover(), b = d.buildDiscover();
      return [0, 3, 5].some((i) => a.buf[28 + i] !== b.buf[28 + i]);
    })());
    check('⑩parseProbeMac 合法/非法/缺省', d.parseProbeMac('aa:bb:cc:dd:ee:ff')[0] === 0xaa
      && d.parseProbeMac('aa-bb-cc-dd-ee-ff').length === 6
      && d.parseProbeMac('zz:bb:cc:dd:ee:ff') === null
      && d.parseProbeMac('') === null);
    // probeDhcp 组装链：socketFactory 注入捕获实际发出的报文，验证 chaddr=固定探针 MAC
    let sent = null;
    const fakeSocket = {
      handlers: {},
      on(ev, fn) { this.handlers[ev] = fn; },
      bind(addr, cb) { cb(); },
      setBroadcast() {},
      send(buf2) { sent = buf2; },
      close() {},
    };
    const r = await d.probeDhcp({
      mac: d.DEFAULT_PROBE_MAC,
      timeoutMs: 300,
      socketFactory: (cb) => cb(fakeSocket),
    });
    check('⑩probeDhcp 发出的 DISCOVER chaddr=固定探针 MAC', sent !== null && d.DEFAULT_PROBE_MAC.every((b, i) => sent[28 + i] === b));
    check('⑩probeDhcp 无应答路径返回 timeout（非 skipped）', r.ok === false && r.reason === 'timeout' && !r.skipped);
  }

  console.log(`\n结果: ${pass} pass / ${fail} fail`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((err) => {
  console.error('测试执行异常:', err);
  process.exit(1);
});
