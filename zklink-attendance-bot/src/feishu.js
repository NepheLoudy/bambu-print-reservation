const crypto = require('crypto');
const config = require('./config');
const report = require('./report');

// ============================================================
// 飞书通道
// - 播报：值日群自定义机器人 webhook（与 duty-bot 看板卡同款链路，非对话型、
//   不经应用身份 im API、不经 gateway，不违反对话铁律）；URL/密钥只落 .env
// - 留档：飞书云文档（docx API，应用身份）追加周报留档——需应用开通 docx 权限
//   且被加为目标文档协作者（可编辑）；未配置/失败时本地 archive/ 目录兜底
// ============================================================

function feishuError(code, msg) {
  const err = new Error(`飞书接口错误 ${code}: ${msg || ''}`);
  err.errcode = code;
  err.hint = describeErrcode(code);
  return err;
}

function describeErrcode(code) {
  if (code === 19021) return '签名不匹配或时间戳超窗：机器人开了「签名校验」需在 .env 配 FEISHU_WEBHOOK_SECRET（或机器人侧改掉签名校验）';
  if (code === 19024) return '未命中自定义关键词：机器人安全设置配了关键词过滤，需调整关键词或在消息里带上';
  if (code === 19022) return '来源 IP 不在机器人白名单：检查机器人安全设置的 IP 白名单';
  if (code === 9499) return '请求体格式错误或超过 20KB：周报明细过大时已自动截断，仍报错请检查 webhook 地址';
  if (code === 11232) return '触发限流（100 次/分）：周播频率不该命中，检查是否有循环重试';
  if (code === 1770002 || code === 1770001) return '云文档不存在或无权限：确认 ARCHIVE_DOC_TOKEN 正确，且应用已被加为该文档协作者（可编辑）';
  if (code === 99991663 || code === 99991661) return '应用身份无权限：飞书后台需开通 docx:document 权限（查看、编辑和管理云文档）';
  return '';
}

/** 签名：key = `${timestamp}\n${secret}` 对空串 HMAC-SHA256 后 base64（官方规则） */
function signFor(timestamp, secret) {
  return crypto
    .createHmac('sha256', `${timestamp}\n${secret}`)
    .update('')
    .digest('base64');
}

/**
 * 经群自定义机器人 webhook 发送交互卡片
 * @param {string} webhookUrl 自定义机器人地址（…/bot/v2/hook/xxx）
 * @param {string} secret 签名密钥（机器人未开启签名校验时传空串）
 * @param {object} cardContent 卡片结构（与 im API 的 interactive content 同构）
 */
async function sendCardToWebhook(webhookUrl, secret, cardContent) {
  if (!webhookUrl) {
    const err = new Error('未配置飞书群机器人 webhook 地址（FEISHU_WEBHOOK_URL，建在值日群）');
    err.errcode = 'NO_CONFIG';
    throw err;
  }
  const body = { msg_type: 'interactive', card: cardContent };
  if (secret) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    body.timestamp = timestamp;
    body.sign = signFor(timestamp, secret);
  }
  const res = await fetch(webhookUrl, {
    method: 'POST',
    // 无超时的 fetch 挂起会拖住定时任务（duty-bot 同款教训）
    signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  const code = data ? (data.code ?? data.StatusCode) : res.status;
  if (code !== 0) {
    const msg = data ? `${data.msg || data.StatusMessage || ''} (code: ${code})` : `HTTP ${res.status} 非 JSON 响应`;
    throw feishuError(code, msg);
  }
  return data;
}

// 播报通道门控（纯函数，桩测试用）
function pickChannels(cfg) {
  const feishu = !!cfg.feishuWebhookUrl;
  if (!feishu) {
    const err = new Error('未配置播报通道：FEISHU_WEBHOOK_URL（值日群自定义机器人 webhook）');
    err.errcode = 'NO_CONFIG';
    throw err;
  }
  return { feishu };
}

// 周报卡片（经典 1.0 卡片；lark_md 不渲染表格 → 逐人一行）
// 有孤条/缺勤标 orange 提醒，全勤绿色
function buildWeeklyCard(win, agg, opts = {}) {
  const maxUserLines = opts.maxUserLines || 40;
  const users = agg.users || [];
  const hasIssue = agg.totals.lonelyDays > 0 || users.some((u) => u.punches === 0);
  const userLines = report.renderUserLines(agg, { maxUserLines });
  const elements = [
    { tag: 'markdown', content: `**打卡 ${agg.totals.punches} 条 · 合计时长 ${report.fmtDuration(agg.totals.totalMs)} · 涉及 ${agg.totals.users} 人（有打卡 ${agg.totals.punchUsers} 人）${agg.totals.lonelyDays ? ` · 孤条 ${agg.totals.lonelyDays} 天` : ''}**` },
    { tag: 'hr' },
    { tag: 'markdown', content: agg.totals.punches ? userLines.join('\n') : '本周无打卡记录（检查名单与 ZKLink 考勤组导出是否匹配）' },
    { tag: 'hr' },
    { tag: 'markdown', content: `> 口径：单日 ≥2 条记「末卡−首卡」，1 条=孤条不计时长 · 打卡明细已留档云文档 · 数据来自 ZKLink 云考勤` },
  ];
  return {
    config: { wide_screen_mode: true },
    header: {
      template: hasIssue ? 'orange' : 'green',
      title: { content: `⏱ 打卡时长周报（${win.label}）`, tag: 'plain_text' },
    },
    elements,
  };
}

// ---------- 云文档留档（docx API，应用身份） ----------
let tenantCache = { token: '', expiresAt: 0 };

async function getTenantToken() {
  if (!config.feishuAppId || !config.feishuAppSecret) {
    const err = new Error('未配置 FEISHU_APP_ID / FEISHU_APP_SECRET（云文档留档需要应用身份）');
    err.errcode = 'NO_CONFIG';
    throw err;
  }
  if (tenantCache.token && Date.now() < tenantCache.expiresAt - 5 * 60 * 1000) return tenantCache.token;
  const res = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: config.feishuAppId, app_secret: config.feishuAppSecret }),
  });
  const j = await res.json();
  if (j.code !== 0 || !j.tenant_access_token) throw feishuError(j.code, j.msg);
  tenantCache = { token: j.tenant_access_token, expiresAt: Date.now() + (j.expire || 7200) * 1000 };
  return tenantCache.token;
}

async function feishuApi(pathName, body) {
  const token = await getTenantToken();
  const res = await fetch(`https://open.feishu.cn/open-apis/${pathName}`, {
    method: 'POST',
    signal: AbortSignal.timeout(20000),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const j = await res.json();
  if (j.code !== 0) throw feishuError(j.code, j.msg);
  return j;
}

// ---- docx 块构造（文本块=2，heading1=3 / heading2=4 / heading3=5） ----
function textBlock(content) {
  return { block_type: 2, text: { elements: [{ text_run: { content } }], style: {} } };
}
function headingBlock(level, content) {
  const key = `heading${level}`;
  return { block_type: 2 + level, [key]: { elements: [{ text_run: { content } }], style: {} } };
}

// 一次 children 请求上限 50 块（官方限制），超量分批顺序追加（全部追加到文档末尾）
async function appendDocBlocks(docToken, blocks) {
  if (!docToken) {
    const err = new Error('未配置 ARCHIVE_DOC_TOKEN（云文档 token，取自文档 URL /docx/ 后段）');
    err.errcode = 'NO_CONFIG';
    throw err;
  }
  let appended = 0;
  for (let i = 0; i < blocks.length; i += 50) {
    const chunk = blocks.slice(i, i + 50);
    await feishuApi(
      `docx/v1/documents/${docToken}/blocks/${docToken}/children?document_revision_id=-1`,
      { children: chunk, index: -1 },
    );
    appended += chunk.length;
  }
  return appended;
}

module.exports = {
  signFor, sendCardToWebhook, pickChannels, buildWeeklyCard,
  getTenantToken, feishuApi, appendDocBlocks, textBlock, headingBlock, describeErrcode,
};
