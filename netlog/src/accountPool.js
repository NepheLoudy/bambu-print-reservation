/**
 * 校园网账号登录策略池（netlog v2 复活引擎的账号供给层）
 *
 * 配置文件（NETLOG_ACCOUNT_POOL，默认 <数据目录>/campus-accounts.local.json，不进 git）：
 * {
 *   "preferred": "31108753",
 *   "accounts":  [{ "user": "...", "password": "...", "priority": 1, "note": "" }, ...],
 *   "bannedThisMonth": [{ "user": "...", "month": "2026-09", "reason": "slow-throttled", "bannedAt": 169... }]
 * }
 *
 * 规则：
 *   - 首选项优先（在池内且未被当月弃用时永远排第一——曼波 2026-09-27 指定 31108753）；
 *   - 其余按 priority 升序轮换；
 *   - 弃用（本月不再使用）：慢速判定命中的账号记入 bannedThisMonth，当月不再被选，自然月 1 号自动失效；
 *   - 弃用记录持久化回写配置文件（跨重启保留），原子写（tmp+rename）。
 *
 * 垫底（v18，曼波 2026-10-07 定「首选只是优先不是拉锯」）：被抢（复活成功后短时间又掉线）
 * 的账号持久垫底一段时间——排序沉到所有健康账号之后（垫底档内仍按优先级轮换，池不失能），
 * 到期自动复位。与「弃用」的两档语义：弃用=当月彻底不选；垫底=可用但只在没得选时才轮到。
 * 垫底是运行时状态，存独立状态文件（NETLOG_DEMOTE_FILE，默认 <数据目录>/account-demotions.json，
 * push.js 不上传——池配置文件是种子会被部署覆盖，垫底状态不应随部署丢失）。
 */
const fs = require('fs');
const path = require('path');

function currentMonth(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function loadPool(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      preferred: data.preferred || null,
      accounts: Array.isArray(data.accounts) ? data.accounts.filter((a) => a.user && a.password) : [],
      banned: Array.isArray(data.bannedThisMonth) ? data.bannedThisMonth : [],
    };
  } catch {
    return { preferred: null, accounts: [], banned: [] };
  }
}

function savePool(file, pool) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const out = { preferred: pool.preferred, accounts: pool.accounts, bannedThisMonth: pool.banned };
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2));
  fs.renameSync(tmp, file);
}

/**
 * @param {string} file 配置文件路径
 * @param {Function} [nowLike] 时间源（可注入测试），返回 Date
 */
function createAccountPool(file, nowLike = () => new Date()) {
  const now = () => (typeof nowLike === 'function' ? nowLike() : nowLike);

  function isBanned(user) {
    const month = currentMonth(now());
    return loadPool(file).banned.some((b) => b.user === user && b.month === month);
  }

  /** 按策略排序的全部可用账号（首选项优先 → priority 升序），已剔除当月弃用 */
  function listCandidates() {
    const pool = loadPool(file);
    const alive = pool.accounts.filter((a) => !isBanned(a.user));
    const preferred = pool.preferred ? alive.find((a) => a.user === pool.preferred) : null;
    const rest = alive
      .filter((a) => a.user !== pool.preferred)
      .sort((x, y) => (x.priority || 99) - (y.priority || 99));
    return preferred ? [preferred, ...rest] : rest;
  }

  /** 给账号打当月弃用标记（幂等）并持久化 */
  function banThisMonth(user, reason = 'slow-throttled') {
    const pool = loadPool(file);
    const month = currentMonth(now());
    if (!pool.banned.some((b) => b.user === user && b.month === month)) {
      pool.banned.push({ user, month, reason, bannedAt: now().toISOString() });
      savePool(file, pool);
    }
    return loadPool(file).banned;
  }

  return { listCandidates, isBanned, banThisMonth, currentMonth };
}

/**
 * 账号垫底 store（v18）：持久化被抢账号的垫底状态，跨重启保留。
 * 文件格式（JSON 数组）：[{ "user", "until"(epoch ms), "reason", "demotedAt"(ISO) }, ...]
 * 读时惰性过滤过期条目（不主动回收写盘，下次 demote 时顺带清理）。
 */
function createDemoteStore(file, nowLike = () => new Date()) {
  const now = () => (typeof nowLike === 'function' ? nowLike() : nowLike);

  function load() {
    try {
      const arr = JSON.parse(fs.readFileSync(file, 'utf8'));
      return Array.isArray(arr) ? arr.filter((d) => d && d.user) : [];
    } catch {
      return []; // 无文件/半截写=无垫底
    }
  }

  function save(list) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(list, null, 2));
    fs.renameSync(tmp, file);
  }

  /** 垫底账号 hours 小时（幂等：同账号重复垫底刷新 until 取更晚） */
  function demote(user, hours, reason = 'kicked') {
    const t = now().getTime();
    const until = t + hours * 3600 * 1000;
    const list = load().filter((d) => d.user !== user && d.until > t);
    const prev = load().find((d) => d.user === user);
    list.push({ user, until: prev && prev.until > until ? prev.until : until, reason, demotedAt: new Date(t).toISOString() });
    save(list);
    return list;
  }

  /** 当前仍生效的垫底列表 */
  function active() {
    const t = now().getTime();
    return load().filter((d) => d.until > t);
  }

  return { demote, active };
}

/** 纯函数（stub 可测）：候选按垫底状态重排——健康的在前、垫底的沉底，各自保持原序 */
function rankWithDemotions(candidates, demotions) {
  const list = Array.isArray(candidates) ? candidates : [];
  const demotedSet = new Set((demotions || []).map((d) => d.user));
  return [...list.filter((a) => !demotedSet.has(a.user)), ...list.filter((a) => demotedSet.has(a.user))];
}

module.exports = { createAccountPool, createDemoteStore, rankWithDemotions, currentMonth, loadPool, savePool };
