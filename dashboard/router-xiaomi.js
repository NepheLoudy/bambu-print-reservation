// ============================================================
// 小米路由器管理客户端（实验性，2026-09-16）
// 用途：LAN 设备的踢出/封禁（设备禁用上网）。
//
// 登录算法为小米路由器公开的社区实现：
//   1. GET  /cgi-bin/luci/web                    → 页面里取 key
//   2. nonce = "0_<mac>_<秒级时间>_<4位随机>"
//   3. pwd   = sha1( nonce + sha1(password + key) )
//   4. POST  /cgi-bin/luci/api/xqsystem/login    → { token } → 后续路径带 ;stok=<token>
// 设备列表：GET /cgi-bin/luci/;stok=S/api/misystem/devicelist
// 禁用/恢复：不同固件端点有差异，按候选顺序尝试并把路由器原始响应带回给调用方调参。
//
// 凭据：路由器管理密码（调用方传入），不落盘、不进 git。
// ============================================================

const crypto = require('crypto');

function sha1(s) {
  return crypto.createHash('sha1').update(s).digest('hex');
}

function extractKey(html) {
  const m = /key\s*[:=]\s*'([A-Za-z0-9+/=]{8,})'/.exec(html);
  return m ? m[1] : null;
}

async function fetchWithCookies(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), ...(options.cookie ? { Cookie: options.cookie } : {}) },
  });
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  const cookie = setCookie.map((c) => c.split(';')[0]).join('; ') || options.cookie || '';
  let body = await res.text();
  try { body = JSON.parse(body); } catch { /* 保留原文 */ }
  return { ok: res.ok, status: res.status, body, cookie };
}

/**
 * 登录小米路由器
 * @returns {{stok: string, cookie: string}}
 */
async function login({ host, password, mac = '' }) {
  if (!password) throw Object.assign(new Error('未配置路由器管理密码（ROUTER_PASSWORD）'), { code: 'NO_CONFIG' });
  const web = await fetchWithCookies(`http://${host}/cgi-bin/luci/web`, { timeout: 8000 });
  const key = extractKey(typeof web.body === 'string' ? web.body : JSON.stringify(web.body));
  if (!key) throw new Error('路由器登录页解析失败（未找到 key）——确认是小米路由器管理界面');

  const nonce = `0_${mac || 'test'}_${Math.floor(Date.now() / 1000)}_${Math.floor(1000 + Math.random() * 9000)}`;
  const pwd = sha1(nonce + sha1(password + key));
  const qs = new URLSearchParams({ logtype: '2', username: 'admin', password: pwd, nonce });
  const r = await fetchWithCookies(`http://${host}/cgi-bin/luci/api/xqsystem/login?${qs}`, {
    method: 'POST', cookie: web.cookie, timeout: 8000,
  });
  const token = r.body && (r.body.token || (r.body.data && r.body.data.token));
  if (!token) {
    const msg = (r.body && (r.body.msg || JSON.stringify(r.body))) || '未知响应';
    throw Object.assign(new Error(`路由器登录失败：${msg}`), { code: 'LOGIN_FAIL', routerMsg: msg });
  }
  return { stok: token, cookie: r.cookie };
}

/** 在线设备列表（含 mac/ip/name） */
async function deviceList({ host, stok, cookie }) {
  const r = await fetchWithCookies(`http://${host}/cgi-bin/luci/;stok=${stok}/api/misystem/devicelist`, {
    cookie, timeout: 8000,
  });
  const b = r.body;
  if (!b || (b.code !== 0 && !b.list)) throw new Error(`设备列表失败：${JSON.stringify(b).slice(0, 160)}`);
  return (b.list || []).map((d) => ({ mac: String(d.mac || '').toLowerCase(), ip: d.ip, name: d.name || '', online: true }));
}

/** 禁用某设备上网 / 恢复。不同固件端点有差异：按候选顺序尝试，全部失败时带原始响应报错。 */
async function setMacFilter({ host, stok, cookie }, mac, wantBlock) {
  const base = `http://${host}/cgi-bin/luci/;stok=${stok}`;
  const candidates = [
    { path: '/api/misystem/set_macfilter_model', body: { mac, model: 1, want: wantBlock ? 0 : 1 } },
    { path: '/api/xqnetwork/set_macfilter', body: { macs: mac, model: wantBlock ? 1 : 0 } },
    { path: '/api/misystem/set_macfilter', body: { mac, want: wantBlock ? 0 : 1 } },
  ];
  const attempts = [];
  for (const c of candidates) {
    const r = await fetchWithCookies(base + c.path, {
      method: 'POST', cookie,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(c.body),
      timeout: 8000,
    });
    if (r.body && (r.body.code === 0 || r.body.StatusCode === 0)) return { ok: true, via: c.path };
    attempts.push(`${c.path} → ${JSON.stringify(r.body).slice(0, 80)}`);
  }
  throw new Error(`路由器禁用接口未命中（请把以下信息发给运维调整端点）：${attempts.join(' | ')}`);
}

module.exports = { login, deviceList, setMacFilter };
