#!/usr/bin/env node
// ============================================================
// ZKLink 端点校准探测（一次性工具，凭据到位后手动跑）
//
// 背景（2026-10-07 无凭据侦查）：zklink.zktecoiot.com 是 qiankun 微前端壳，
// 考勤模块 zkbio_att 动态挂载、OAuth2 Bearer 指纹，但真实登录/拉数端点
// 无法无凭据验证。本脚本按候选序列逐个试登录，命中后带 token 试拉数，
// 输出每步 HTTP 状态与响应指纹（token 脱敏），帮我们把
// ZKLINK_LOGIN_PATH / ZKLINK_TRANSACTION_PATH 回填 .env。
//
// 用法：.env 配好 ZKLINK_USERNAME/ZKLINK_PASSWORD 后：node scripts/zklink-probe.js
// ============================================================
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const BASE = (process.env.ZKLINK_BASE_URL || 'https://zklink.zktecoiot.com').replace(/\/+$/, '');
const USER = process.env.ZKLINK_USERNAME || '';
const PASS = process.env.ZKLINK_PASSWORD || '';

if (!USER || !PASS) {
  console.error('先在 .env 配置 ZKLINK_USERNAME / ZKLINK_PASSWORD 再跑本脚本');
  process.exit(1);
}

// 候选登录形态：路径 × 请求体风格（Spring Security OAuth2 password 流 / JSON REST）
const LOGIN_CANDIDATES = [
  { path: '/oauth/token', style: 'form-oauth', init: () => new URLSearchParams({ grant_type: 'password', username: USER, password: PASS, client_id: process.env.ZKLINK_CLIENT_ID || '', client_secret: process.env.ZKLINK_CLIENT_SECRET || '' }) },
  { path: '/oauth/token', style: 'json', init: () => JSON.stringify({ username: USER, password: PASS }) },
  { path: '/auth/oauth/token', style: 'form-oauth', init: () => new URLSearchParams({ grant_type: 'password', username: USER, password: PASS }) },
  { path: '/auth/login', style: 'json', init: () => JSON.stringify({ username: USER, password: PASS }) },
  { path: '/api/login', style: 'json', init: () => JSON.stringify({ username: USER, password: PASS }) },
  { path: '/login', style: 'json', init: () => JSON.stringify({ username: USER, password: PASS }) },
  { path: '/zkbio_att/api/login', style: 'json', init: () => JSON.stringify({ username: USER, password: PASS }) },
];

const TX_CANDIDATES = [
  '/zkbio_att/api/attendance/transaction/list',
  '/zkbio_att/api/transaction/list',
  '/zkbio_att/api/attendance/clockingRecords',
  '/api/attendance/transaction/list',
];

function redact(s) {
  return String(s)
    .replace(/"(access_token|token|refresh_token)"\s*:\s*"([^"]{6})[^"]*"/g, '$1":"$2***"')
    .replace(/(Bearer\s+)([A-Za-z0-9._-]{6})[A-Za-z0-9._-]*/g, '$1$2***');
}

function extractToken(j) {
  if (!j || typeof j !== 'object') return '';
  return j.access_token || (j.data && (j.data.access_token || j.data.token)) || j.token || '';
}

(async () => {
  console.log(`目标：${BASE}（账号 ${USER.slice(0, 2)}***）\n== 阶段 1：登录端点探测 ==`);
  let hit = null;
  for (const c of LOGIN_CANDIDATES) {
    const body = c.init();
    const headers = c.style === 'form-oauth'
      ? { 'Content-Type': 'application/x-www-form-urlencoded' }
      : { 'Content-Type': 'application/json' };
    try {
      const res = await fetch(BASE + c.path, { method: 'POST', headers, body, signal: AbortSignal.timeout(15000) });
      const text = await res.text();
      let j = null; try { j = JSON.parse(text); } catch {}
      const token = extractToken(j);
      console.log(`[${res.status}] POST ${c.path} (${c.style}) → ${token ? `✅ 拿到 token（${redact(text).slice(0, 160)}）` : redact(text).slice(0, 160)}`);
      if (token) { hit = { ...c, token }; break; }
    } catch (e) {
      console.log(`[ERR] POST ${c.path} (${c.style}) → ${e.message}`);
    }
  }
  if (!hit) {
    console.log('\n❌ 全部候选登录端点未命中。请浏览器登录一次，F12 → Network 找登录请求的真实路径与载荷形态，回填 ZKLINK_LOGIN_PATH（或把形态抄进本脚本候选表）再跑。');
    process.exit(2);
  }
  console.log(`\n✅ 登录命中：ZKLINK_LOGIN_PATH=${hit.path}（${hit.style} 形态）\n\n== 阶段 2：拉数端点探测 ==`);
  const fmt = (ms) => {
    const d = new Date(ms);
    return d.toISOString().slice(0, 19).replace('T', ' ');
  };
  const end = Date.now();
  const start = end - 7 * 86400 * 1000;
  for (const p of TX_CANDIDATES) {
    const qs = new URLSearchParams({ beginDate: fmt(start), endDate: fmt(end), page: '1', pageSize: '10' });
    if (process.env.ZKLINK_ATT_GROUP_ID) qs.set('attGroupId', process.env.ZKLINK_ATT_GROUP_ID);
    try {
      const res = await fetch(`${BASE}${p}?${qs}`, { headers: { Authorization: `Bearer ${hit.token}` }, signal: AbortSignal.timeout(15000) });
      const text = await res.text();
      let j = null; try { j = JSON.parse(text); } catch {}
      const d = (j && j.data) || j;
      const list = d && (d.records || d.list || d.rows);
      console.log(`[${res.status}] GET ${p} → ${Array.isArray(list) ? `✅ ${list.length} 条（首条键：${list[0] ? Object.keys(list[0]).join(',') : '-'}）` : redact(text).slice(0, 160)}`);
    } catch (e) {
      console.log(`[ERR] GET ${p} → ${e.message}`);
    }
  }
  console.log('\n== 收尾 ==\n把命中的路径回填 .env：ZKLINK_LOGIN_PATH / ZKLINK_TRANSACTION_PATH，\nZKLINK_DATA_SOURCE=http，然后 npm run push 部署。若拉数参数名不对（beginDate/endDate），\n按阶段 2 首条记录的响应结构调 src/zklink.js 的 fetchTransactions/normalizeRecord。');
})();
