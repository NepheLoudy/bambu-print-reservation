/**
 * Dr.COM（城市热点）eportal 认证客户端 —— netlog v2 复活引擎的协议层
 *
 * 协议来源：4A 保活脚本归档 ping.sh（桌面 qianli-backups/4a-root-ping-archive-20260920.tar.gz，
 * 曾在 4A 上实跑）+ 2026-09-27 在线状态接口实测通过（online_list @801 返回 200 与主路由会话详情）。
 * 认证系统：login.cqu.edu.cn = 10.10.8.162，Web 认证页 80/443，**eportal API 在 801**。
 *
 * 三件套：
 *   onlineList()  GET /eportal/portal/online_list?callback=dr1005&lang=zh
 *                 → JSONP { result:1, list:[{ online_ip, online_mac, user_account, time_long, ... }] }
 *   login(acct)   GET /eportal/portal/login?callback=dr1005&login_method=1
 *                 &user_account=%2C0%2C{学号} &user_password={明文} &wlan_user_ip={要放行的IP}
 *                 &wlan_user_mac=000000000000 &wlan_ac_ip= &wlan_ac_name= &term_ua=... &term_type=1
 *                 &jsVersion=4.2.2 &terminal_type=1 &lang=zh-cn &v=5909 &lang=zh
 *   fetchAuthIp() GET http://login.cqu.edu.cn/（GBK）→ 解析 v4ip='x.x.x.x'（按来源 IP 回显，
 *                 从小电脑发起时即主路由 WAN IP——正是需要认证放行的 IP）
 *
 * 判定原则：login 响应码/文案不做成败依据（各版本 eportal 文案不一），**以 online_list
 * 出现该账号会话 / wan 探测真恢复为准**（engine 层裁决），adapter 只忠实执行与转述。
 */
const http = require('http');

const AUTH_HOST = process.env.NETLOG_AUTH_HOST || '10.10.8.162';
const AUTH_PORT = Number(process.env.NETLOG_AUTH_PORT || 801);
const AUTH_PORTAL_BASE = process.env.NETLOG_AUTH_PORTAL_BASE || '/eportal/portal/';
const AUTH_LOGIN_PAGE_HOST = process.env.NETLOG_AUTH_PAGE_HOST || 'login.cqu.edu.cn';

/** httpGet 注入点（测试可替换）；返回 { status, body }，异常按 { status: 0, body: String(err) } */
function httpGet(url, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs, headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', (e) => resolve({ status: 0, body: String(e && e.message) }));
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
  });
}

function buildUrl(pathname, params) {
  const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return `http://${AUTH_HOST}:${AUTH_PORT}${AUTH_PORTAL_BASE}${pathname}?${qs}`;
}

/** 解析 JSONP：dr1005({...}) → 对象；解析失败返回 null（不做臆断） */
function parseJsonp(body) {
  const m = /\((\{[\s\S]*\})\)/.exec(body || '');
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

/**
 * 当前在线会话列表（可能为空/多人）。
 * @returns {Promise<Array<{ip,mac,user,timeLong,session}>>}
 */
async function onlineList(deps = {}) {
  const get = deps.httpGet || httpGet;
  const r = await get(buildUrl('online_list', { callback: 'dr1005', lang: 'zh' }));
  const data = parseJsonp(r.body);
  if (!data || !Array.isArray(data.list)) return [];
  return data.list.map((x) => ({
    ip: x.online_ip || '',
    mac: x.online_mac || '',
    user: x.user_account || '',
    timeLong: Number(x.time_long || 0),
    session: x.online_session || null,
  }));
}

/**
 * 以指定账号登录（Portal 按 IP 放行：wlan_user_ip 传要放行的 IP，通常=主路由 WAN IP）。
 * 响应原样返回（JSONP 对象或原文），成败由调用方以 onlineList/wan 探测裁决。
 */
async function login({ user, password, authIp }, deps = {}) {
  const get = deps.httpGet || httpGet;
  const url = buildUrl('login', {
    callback: 'dr1005',
    login_method: '1',
    user_account: `,0,${user}`,
    user_password: password,
    wlan_user_ip: authIp || '',
    wlan_user_ipv6: '',
    wlan_user_mac: '000000000000',
    wlan_ac_ip: '',
    wlan_ac_name: '',
    term_ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) qianli-netlog',
    term_type: '1',
    jsVersion: '4.2.2',
    terminal_type: '1',
    lang: 'zh-cn',
    v: '5909',
    lang: 'zh',
  });
  const r = await get(url);
  return { status: r.status, data: parseJsonp(r.body), raw: (r.body || '').slice(0, 300) };
}

/** 登出指定 IP 的会话（尽量温和地释放测试会话；各固件路径不一，失败不抛） */
async function logout(ip, deps = {}) {
  const get = deps.httpGet || httpGet;
  const url = `http://${AUTH_HOST}:${AUTH_PORT}/eportal/?c=ACSetting&a=Logout&ver=1.0&wlan_user_ip=${encodeURIComponent(ip || '')}`;
  const r = await get(url);
  return { status: r.status, raw: (r.body || '').slice(0, 200) };
}

/** 从认证页回显拿本机来源 IP（经 NAT 后即主路由 WAN IP），失败返回 null */
async function fetchAuthIp(deps = {}) {
  const get = deps.httpGet || httpGet;
  const r = await get(`http://${AUTH_LOGIN_PAGE_HOST}/`);
  const m = /v4ip='(\d{1,3}(?:\.\d{1,3}){3})'/.exec(r.body || '');
  return m ? m[1] : null;
}

module.exports = { onlineList, login, logout, fetchAuthIp, parseJsonp, buildUrl, AUTH_HOST, AUTH_PORT };
