const crypto = require('crypto');

// ============================================================
// 管理端点鉴权（2026-09-13）：/api/dispatch 与 /api/usage-sync/run
// 凭据存储沿用工作区约定——token 只放 .env（GATEWAY_API_TOKEN，不进 git），
// push.js 随 .env 下发 NAS。校验用 timingSafeEqual 防时序侧信道。
// fail-closed：未配置 token = 管理端点整体锁定（健康检查与只读 /api/usage 不受限）。
// ============================================================

function safeEqual(a, b) {
  const ab = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function requireApiToken(req, res, next) {
  const expected = process.env.GATEWAY_API_TOKEN;
  if (!expected) {
    return res.status(503).json({ error: '网关未配置 GATEWAY_API_TOKEN，管理端点已锁定（在 .env 配置后重启生效）' });
  }
  const provided = req.get('X-API-Token') || req.query.token || '';
  if (!safeEqual(provided, expected)) {
    return res.status(403).json({ error: '鉴权失败：X-API-Token 缺失或不匹配' });
  }
  next();
}

module.exports = { requireApiToken };
