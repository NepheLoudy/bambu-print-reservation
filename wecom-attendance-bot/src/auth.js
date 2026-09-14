const crypto = require('crypto');

// ============================================================
// 管理端点鉴权（照 feishu-gateway/src/auth.js 模板，2026-09-15 随项目落地）
// 凭据存储沿用工作区约定——token 只放 .env（ATTENDANCE_API_TOKEN，不进 git），
// 值与全工作区共享 token 同值（运维只记一个）。校验用 timingSafeEqual 防时序侧信道。
// fail-closed：未配置 token = 写端点整体锁定（健康检查与只读 GET 不受限）。
// ============================================================

function safeEqual(a, b) {
  const ab = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function requireApiToken(req, res, next) {
  const expected = process.env.ATTENDANCE_API_TOKEN;
  if (!expected) {
    return res.status(503).json({ error: '未配置 ATTENDANCE_API_TOKEN，管理端点已锁定（在 .env 配置后重启生效）' });
  }
  const provided = req.get('X-API-Token') || req.query.token || '';
  if (!safeEqual(provided, expected)) {
    return res.status(403).json({ error: '鉴权失败：X-API-Token 缺失或不匹配' });
  }
  next();
}

module.exports = { requireApiToken };
