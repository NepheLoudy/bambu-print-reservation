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

module.exports = { createAccountPool, currentMonth, loadPool, savePool };
