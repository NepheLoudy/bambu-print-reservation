// ============================================================
// 队员功能使用上报（2026-10-06 流程债清偿：顶层 AGENTS「队员/功能统计上报规则」）
//
// 页面提交/审批是网关路由层看不见的内部命中（同 hub 关键词回答），必须向网关
// POST /api/usage/report 归因，队员活跃/功能分布才覆盖本服务的新交互。
//
// 身份映射说明：本服务用户是本地账号（无飞书 open_id），上报 id 取
// `local:<username>` 命名空间——网关按字符串 id 聚合统计，页面活跃可归因到人；
// 与飞书身份的打通等网页授权（open_id 登录）上线后自然切换。
//
// fire-and-forget：上报失败仅 warn，绝不影响主链路（照 plaza.js 语义）。
// ============================================================

const config = require('../config');

let lastWarnAt = 0;

/**
 * @param {string} username 本地账号名
 * @param {string} feature 功能标识（print-submit / print-approve / print-reject …）
 */
async function reportUsage(username, feature) {
  const url = config.usage.reportUrl;
  if (!url || !username) return;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Token': config.usage.token },
      body: JSON.stringify({ openId: `local:${username}`, feature }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    // 限频告警（网关没起时别刷屏）：5 分钟最多一条
    const now = Date.now();
    if (now - lastWarnAt > 5 * 60 * 1000) {
      lastWarnAt = now;
      console.warn(`[使用上报] 上报失败（不影响主链路）: ${err.message}`);
    }
  }
}

module.exports = { reportUsage };
