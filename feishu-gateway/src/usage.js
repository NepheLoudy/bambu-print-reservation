const fs = require('fs');
const path = require('path');
const config = require('./config');

// ============================================================
// 使用统计（运维台「功能使用 / 队员活跃」看板的数据源）
// - 只计数不改路由：dispatch 在消息命中目标后顺带记录，故障时静默自愈
// - 口径=机器人交互：显式路由命中/私聊/群内 @机器人；群内未 @ 的普通消息不计
//   （按天分桶的明细 feats/users 仅服务运维台与日活跃汇总，不再落多维表格分表）
// - 按天分桶：每日 { total, users: {open_id: {c, last}}, feats: {功能: 次数} }，保留 30 天
// - 落盘目录必须在项目外：部署 tar 会清空 /opt/feishu-gateway，
//   默认 /home/qianli/feishu-gateway-data（与 approval-bot-data 惯例一致），可 GATEWAY_DATA_DIR 覆盖
// - 成员名用共用应用凭证查通讯录并永久缓存（查不到则回退展示 open_id 尾号）
// ============================================================

const KEEP_DAYS = 30;
let dataDir = process.env.GATEWAY_DATA_DIR || '/home/qianli/feishu-gateway-data';
try {
  fs.mkdirSync(dataDir, { recursive: true });
} catch (err) {
  dataDir = __dirname; // 本地开发等写不了系统目录时退回项目内（不入 git）
}
const FILE = path.join(dataDir, 'usage-stats.json');

let stats = { v: 1, names: {}, days: {} };
try {
  stats = Object.assign(stats, JSON.parse(fs.readFileSync(FILE, 'utf-8')));
} catch (err) { /* 首次运行空表起步 */ }

let dirty = false;
setInterval(() => {
  if (!dirty) return;
  dirty = false;
  fs.writeFile(FILE, JSON.stringify(stats), () => {});
}, 60 * 1000);
process.on('SIGINT', () => {
  try { fs.writeFileSync(FILE, JSON.stringify(stats)); } catch (err) { /* 退出不等落盘 */ }
  process.exit(0);
});
process.on('SIGTERM', () => {
  try { fs.writeFileSync(FILE, JSON.stringify(stats)); } catch (err) { /* 退出不等落盘 */ }
  process.exit(0);
});

const pad = (n) => String(n).padStart(2, '0');
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function prune() {
  const keys = Object.keys(stats.days).sort();
  while (keys.length > KEEP_DAYS) delete stats.days[keys.shift()];
}

function recordMessage({ senderId, feature }) {
  try {
    if (!senderId) return;
    const day = stats.days[today()] || (stats.days[today()] = { total: 0, users: {}, feats: {} });
    day.total += 1;
    const u = day.users[senderId] || (day.users[senderId] = { c: 0, last: 0 });
    u.c += 1;
    u.last = Date.now();
    day.feats[feature] = (day.feats[feature] || 0) + 1;
    prune();
    dirty = true;
    ensureName(senderId);
  } catch (err) {
    console.warn('[使用统计] 记录失败（忽略）:', err.message);
  }
}

// 消费方归因上报（2026-09-13 统计覆盖规则）：hub 等服务把网关路由层看不见的
// 功能命中（关键词回答/DDL 确认/专项指令等）回报到这里——只加用户与功能计数，
// 不加 total（total 口径仍是网关路由层交互次数，避免双算）
function recordFeature({ senderId, feature }) {
  try {
    if (!senderId || !feature) return;
    const day = stats.days[today()] || (stats.days[today()] = { total: 0, users: {}, feats: {} });
    const u = day.users[senderId] || (day.users[senderId] = { c: 0, last: 0 });
    u.c += 1;
    u.last = Date.now();
    day.feats[feature] = (day.feats[feature] || 0) + 1;
    prune();
    dirty = true;
    ensureName(senderId);
  } catch (err) {
    console.warn('[使用统计] 归因记录失败（忽略）:', err.message);
  }
}

// ---------- 成员名解析（通讯录，永久缓存；失败 24h 内不重试） ----------
const nameFailedUntil = new Map();
const namePending = new Set();
let tokenCache = null;

async function tenantToken() {
  if (tokenCache && Date.now() < tokenCache.expireAt) return tokenCache.token;
  const appId = config.feishu.appId;
  const appSecret = config.feishu.appSecret;
  if (!appId || !appSecret) return null;
  const res = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(data.msg || 'token 获取失败');
  tokenCache = { token: data.tenant_access_token, expireAt: Date.now() + ((data.expire || 3600) - 300) * 1000 };
  return tokenCache.token;
}

async function resolveName(openId) {
  const token = await tenantToken();
  if (!token) return null;
  const res = await fetch(`https://open.feishu.cn/open-apis/contact/v3/users/${openId}?user_id_type=open_id`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(data.msg || '通讯录查询失败');
  return (data.data && data.data.user && data.data.user.name) || null;
}

function ensureName(openId) {
  if (stats.names[openId] || namePending.has(openId)) return;
  if ((nameFailedUntil.get(openId) || 0) > Date.now()) return;
  namePending.add(openId);
  resolveName(openId)
    .then((name) => {
      if (name) {
        stats.names[openId] = name;
        dirty = true;
      } else {
        nameFailedUntil.set(openId, Date.now() + 24 * 3600 * 1000);
      }
    })
    .catch(() => nameFailedUntil.set(openId, Date.now() + 24 * 3600 * 1000))
    .finally(() => namePending.delete(openId));
}

// ---------- 聚合输出（?days=N，默认 1 天，最大 30） ----------
function aggregate(daysN = 1) {
  const n = Math.min(KEEP_DAYS, Math.max(1, Number(daysN) || 1));
  const dates = Object.keys(stats.days).sort().slice(-n);
  const users = {};
  const feats = {};
  const daily = [];
  let total = 0;
  for (const d of dates) {
    const day = stats.days[d];
    total += day.total || 0;
    daily.push({ date: d, count: day.total || 0 });
    for (const [id, u] of Object.entries(day.users || {})) {
      const x = users[id] || (users[id] = { count: 0, last: 0 });
      x.count += u.c;
      x.last = Math.max(x.last, u.last || 0);
    }
    for (const [f, c] of Object.entries(day.feats || {})) feats[f] = (feats[f] || 0) + c;
  }
  const userList = Object.entries(users)
    .map(([id, x]) => ({ id, name: stats.names[id] || '', count: x.count, last: x.last }))
    .sort((a, b) => b.count - a.count);
  const featList = Object.entries(feats)
    .map(([feat, count]) => ({ feat, count }))
    .sort((a, b) => b.count - a.count);
  return {
    from: dates[0] || null,
    to: dates[dates.length - 1] || null,
    total,
    activeUsers: userList.length,
    users: userList,
    features: featList,
    daily,
  };
}

module.exports = {
  recordMessage,
  recordFeature,
  aggregate,
  statsFile: FILE,
  // 供 bitable-sync 消费：原始日桶 / 姓名缓存 / 飞书客户端
  getAllDays: () => stats.days,
  getNames: () => stats.names,
  resolveName,
  tenantToken,
};
