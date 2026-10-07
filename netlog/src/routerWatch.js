// ============================================================
// routerWatch（v14，2026-10-07）：主路由无线侧健康观测
// 背景：RD08 固件会进入「射频配置开着但信标不发/DHCP 僵死」的半死态
//（2026-10-07「新设备连上没网」事故）——netlog 在小电脑（有线侧）自身
// 网络健康，完全感知不到无线侧生病。本模块低频登录 miwifi 管理面拉取
// 射频状态，把「管理面失联 / 射频配置异常 / ax 翻转」变成 netlog 事件
//（进 jsonl + 飞书通知链路）。只观测不动手：救场=每周二 04:03 定时重启
//（小电脑 schtask qianli-router-weekly-reboot）+ 人工。
// 依赖：node18+ 原生 fetch，零新依赖。
// 登录算法与 dashboard/router-xiaomi.js 同源（新固件 SHA256 组合）。
// 凭据：NETLOG_ROUTER_PASSWORD（.env，不进 git）；未配置=模块整体停用。
// ============================================================

const crypto = require('crypto');

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/** miwifi 登录：返回 stok；失败抛错（含路由器原始 msg） */
async function login(host, password, fetchImpl) {
  const web = await fetchImpl(`http://${host}/cgi-bin/luci/web`, { signal: AbortSignal.timeout(8000) });
  const setCookies = web.headers.getSetCookie ? web.headers.getSetCookie() : [];
  const cookie = setCookies.map((c) => c.split(';')[0]).join('; ');
  const html = await web.text();
  const key = (/key\s*[:=]\s*'([A-Za-z0-9+/=]{8,})'/.exec(html) || [])[1];
  const deviceId = (/var\s+deviceId\s*=\s*'([0-9a-fA-F:]{12,17})'/.exec(html) || [])[1] || 'test';
  if (!key) throw new Error('登录页解析失败（未找到 key）');
  const nonce = `0_${deviceId}_${Math.floor(Date.now() / 1000)}_${Math.floor(1000 + Math.random() * 9000)}`;
  const q = new URLSearchParams({ logtype: '2', username: 'admin', password: sha256(nonce + sha256(password + key)), nonce });
  const r = await fetchImpl(`http://${host}/cgi-bin/luci/api/xqsystem/login?${q}`, {
    method: 'POST', cookie, signal: AbortSignal.timeout(8000),
  });
  let b = await r.text();
  try { b = JSON.parse(b); } catch { /* 保留原文 */ }
  const token = b && (b.token || (b.data && b.data.token));
  if (!token) throw new Error(`登录失败：${JSON.stringify(b).slice(0, 120)}`);
  return { stok: token, cookie: r.cookie || cookie };
}

/** 拉取 wifi_detail_all：返回 info 数组（wl0=5G wl1=2.4G …） */
async function fetchWifiDetail(host, stok, cookie, fetchImpl) {
  const r = await fetchImpl(`http://${host}/cgi-bin/luci/;stok=${stok}/api/xqnetwork/wifi_detail_all`, {
    cookie, signal: AbortSignal.timeout(8000),
  });
  let b = await r.text();
  try { b = JSON.parse(b); } catch { throw new Error(`wifi_detail_all 响应非 JSON：${String(b).slice(0, 80)}`); }
  if (!b || !Array.isArray(b.info)) throw new Error('wifi_detail_all 结构异常');
  return b.info;
}

/** 拉取在线设备数（misystem/devicelist 的 list 长度） */
async function fetchDeviceCount(host, stok, cookie, fetchImpl) {
  const r = await fetchImpl(`http://${host}/cgi-bin/luci/;stok=${stok}/api/misystem/devicelist`, {
    cookie, signal: AbortSignal.timeout(8000),
  });
  let b = await r.text();
  try { b = JSON.parse(b); } catch { throw new Error('devicelist 响应非 JSON'); }
  if (!b || !Array.isArray(b.list)) throw new Error('devicelist 结构异常');
  return b.list.length;
}

/** 滑动窗口中位数（v16 设备数基线） */
function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * 创建观测器（依赖注入纯逻辑，可 stub）
 * @param {object} deps
 *   - host, password   路由器地址与管理密码（password 空 = 停用）
 *   - emit(event, detail) async，netlog 事件出口
 *   - fetchImpl        默认 globalThis.fetch（测试注入 mock）
 *   - now()            时间源（测试注入）
 */
function createRouterWatch(deps) {
  const {
    host, password, emit, fetchImpl = globalThis.fetch, now = () => new Date(),
    dhcpProbe = null,            // (v16) () => Promise<{ok, skipped?}>，未注入=跳过 DHCP 探测
    dhcpFailThreshold = 2,       // 连续 N 次无 OFFER 才判 DHCP down（防单包丢失误报）
    clientBaselineWindow = 6,    // 设备数基线滑动窗口（tick 数）
    clientDropRatio = 0.5,       // 低于基线该比例且基线≥clientBaselineMin 才判骤降
    clientBaselineMin = 6,
  } = deps;
  const disabled = !password;
  let last = null;      // { mgmtOk, radios: Map<ifname, {status, ax, ssid}> }——只存上次快照，状态翻转才发事件
  let lastTickAt = null;
  let dhcpFailStreak = 0, dhcpWasDown = false;     // (v16) DHCP 连续失败计数/当前报警态
  let clientSamples = [];                           // (v16) 设备数滑动基线
  let clientsWasDown = false;                       // (v16) 骤降报警态

  function snapshotRadios(info) {
    const radios = new Map();
    for (const w of info) {
      if (!w.ifname) continue;
      radios.set(w.ifname, { status: String(w.status), ax: String(w.ax), ssid: w.ssid || '' });
    }
    return radios;
  }

  async function tick() {
    if (disabled) return { skipped: 'disabled' };
    lastTickAt = now().toISOString();
    let info, sess;
    try {
      sess = await login(host, password, fetchImpl);
      info = await fetchWifiDetail(host, sess.stok, sess.cookie, fetchImpl);
    } catch (err) {
      const repeated = last !== null && last.mgmtOk === false; // 持续失联不重发
      const first = !repeated;
      last = { mgmtOk: false, radios: last ? last.radios : null };
      if (first) {
        await emit('router_mgmt_down', `路由器管理面失联（${err.message}）——无线半死/整机僵死的前兆，检查路由器；救场=物理重启或等周二 04:03 定时重启`);
      }
      return { mgmtDown: true, repeated };
    }
    const events = [];
    if (last && last.mgmtOk === false) {
      events.push(emit('router_mgmt_recover', '路由器管理面恢复可达'));
    }
    const radios = snapshotRadios(info);
    // 射频配置异常：status !== '1'（配置关/半死——配置层看得见的那一半病），翻转才发
    for (const [ifname, r] of radios) {
      if (r.status !== '1') {
        const prev = last && last.radios && last.radios.get(ifname);
        if (!prev || prev.status === '1') {
          events.push(emit('router_radio_down', `射频 ${ifname}(${r.ssid}) 配置 status=${r.status}（非运行态）——无线半死指纹，新设备可能连不上网`));
        }
      }
    }
    // ax 翻转留痕（2026-10-07 事故变量，1↔0 变化值得记录）
    for (const [ifname, r] of radios) {
      const prev = last && last.radios && last.radios.get(ifname);
      if (prev && prev.ax !== r.ax) {
        events.push(emit('router_ax_changed', `射频 ${ifname}(${r.ssid}) ax ${prev.ax}→${r.ax}（Wi-Fi6 模式翻转）`));
      }
    }
    // (v16) DHCP 服务探测：连续 dhcpFailThreshold 次无 OFFER 判 down——2026-10-07 事故病灶
    //（半死态 DHCP 僵死，新设备拿不到地址），有线侧既有探针测不到。skipped（68 端口被占等）
    // 静默降级不告警；DISCOVER 不写租约，对真实客户端零副作用。
    if (dhcpProbe) {
      const d = await dhcpProbe();
      if (!d.skipped) {
        if (d.ok) {
          dhcpFailStreak = 0;
          if (dhcpWasDown) {
            dhcpWasDown = false;
            events.push(emit('router_dhcp_recover', '路由器 DHCP 服务恢复响应'));
          }
        } else {
          dhcpFailStreak += 1;
          if (dhcpFailStreak >= dhcpFailThreshold && !dhcpWasDown) {
            dhcpWasDown = true;
            events.push(emit('router_dhcp_down', `路由器 DHCP 无应答（连续 ${dhcpFailStreak} 次 DISCOVER）——新设备将拿不到地址（「连上没网」病灶），救场=重启路由器`));
          }
        }
      }
    }
    // (v16) 在线设备数骤降旁证：无线出问题时客户端集体迁逃/掉线（2026-10-07 实况）。
    // 基线=前几轮中位数；骤降只报一次，回升报 recover。devicelist 偶发失败静默（管理面
    // 失联已有独立探测）。
    try {
      const n = await fetchDeviceCount(host, sess.stok, sess.cookie, fetchImpl);
      clientSamples.push(n);
      if (clientSamples.length > clientBaselineWindow) clientSamples.shift();
      const base = median(clientSamples.slice(0, -1)); // 基线不含本轮
      if (clientSamples.length >= 3 && base >= clientBaselineMin && n < base * clientDropRatio) {
        if (!clientsWasDown) {
          clientsWasDown = true;
          events.push(emit('router_clients_massdrop', `在线设备数骤降（基线 ${base} → ${n}）——无线异常/设备集体迁逃的旁证，结合射频/DHCP 状态判断`));
        }
      } else if (clientsWasDown && base > 0 && n >= base * 0.8) {
        clientsWasDown = false;
        events.push(emit('router_clients_recover', `在线设备数回升（${n}，基线 ${base}）`));
      }
    } catch { /* 静默 */ }
    last = { mgmtOk: true, radios };
    await Promise.all(events);
    return { mgmtDown: false, ifnames: [...radios.keys()], events: events.length };
  }

  function summary() {
    if (disabled) return { enabled: false };
    return {
      enabled: true,
      mgmtOk: last ? last.mgmtOk : null,
      lastTickAt,
      radios: last && last.radios
        ? [...last.radios.entries()].map(([ifname, v]) => ({ ifname, ...v }))
        : null,
    };
  }

  return { tick, summary };
}

module.exports = { createRouterWatch, login, fetchWifiDetail };
