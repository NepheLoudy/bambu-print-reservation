const crypto = require('crypto');
const config = require('./config');

// ============================================================
// 飞书播报通道（2026-09-15 v2 扩展：应用并入现有飞书体系）
// - 主通道：群自定义机器人 webhook（与 duty-bot 看板卡同款链路，非对话型、
//   不经应用身份 im API、不经 gateway，不违反对话铁律）；URL/密钥只落 .env
// - 可选：CSV 明细经现有飞书应用（im API，应用身份）发文件到群——webhook
//   本身传不了文件；需应用在目标群且开通 im:file 权限，未配置/失败仅 warn
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
  if (code === 9499) return '请求体格式错误或超过 20KB：周报异常明细过大时已自动截断，仍报错请检查 webhook 地址';
  if (code === 11232) return '触发限流（100 次/分）：周播频率不该命中，检查是否有循环重试';
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
 * 经群自定义机器人 webhook 发送交互卡片（复制 duty-bot 同名函数口径）
 * @param {string} webhookUrl 自定义机器人地址（…/bot/v2/hook/xxx）
 * @param {string} secret 签名密钥（机器人未开启签名校验时传空串）
 * @param {object} cardContent 卡片结构（与 im API 的 interactive content 同构）
 */
async function sendCardToWebhook(webhookUrl, secret, cardContent) {
  if (!webhookUrl) {
    const err = new Error('未配置飞书群机器人 webhook 地址（FEISHU_WEBHOOK_URL）');
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

// 播报通道门控（纯函数，桩测试用）：至少配一个，否则整体 NO_CONFIG
function pickChannels(cfg) {
  const wecom = !!cfg.webhookKey;
  const feishu = !!cfg.feishuWebhookUrl;
  if (!wecom && !feishu) {
    const err = new Error('未配置任何播报通道：WECOM_WEBHOOK_KEY（企微群机器人）与 FEISHU_WEBHOOK_URL（飞书群机器人）至少配一个');
    err.errcode = 'NO_CONFIG';
    throw err;
  }
  return { wecom, feishu };
}

// 周报卡片（经典 1.0 卡片，与 duty-bot 看板卡同款结构；lark_md 不渲染表格 → 逐人一行）
function buildAttendanceCard(win, report, opts = {}) {
  const maxUserLines = opts.maxUserLines || 40;
  const maxDetailLines = opts.maxDetailLines || 30;
  const users = report.users || [];
  const userLines = users.map((u) =>
    `**${u.name}**：打卡 ${u.punchDays} 天 / ${u.punches} 条 · 异常 ${u.exceptions.length || '无'}`);
  const shownUsers = userLines.slice(0, maxUserLines);
  if (userLines.length > shownUsers.length) {
    shownUsers.push(`…其余 ${userLines.length - shownUsers.length} 人见 CSV 明细`);
  }
  const elements = [
    { tag: 'markdown', content: `**打卡 ${report.totals.punches} 条 · 异常 ${report.totals.exceptions} 条 · 涉及 ${report.totals.users} 人（有打卡 ${report.totals.punchUsers} 人）**` },
    { tag: 'hr' },
    { tag: 'markdown', content: report.totals.punches ? shownUsers.join('\n') : '本周无打卡记录（检查名单与打卡规则是否匹配）' },
  ];
  if (report.exceptionLines.length) {
    const exLines = report.exceptionLines.slice(0, maxDetailLines).map((e) =>
      `⚠ ${e.name} ${e.time} **${e.type}**${e.group ? `（${e.group}）` : ''}`);
    if (report.exceptionLines.length > maxDetailLines) {
      exLines.push(`…其余 ${report.exceptionLines.length - maxDetailLines} 条见 CSV 明细`);
    }
    elements.push(
      { tag: 'hr' },
      { tag: 'markdown', content: ['**⚠ 异常明细**', ...exLines].join('\n') },
    );
  }
  elements.push(
    { tag: 'hr' },
    { tag: 'markdown', content: '> 数据来自企业微信打卡接口（考勤机已同步企微）· 到点未收到会自动补发' },
  );
  return {
    config: { wide_screen_mode: true },
    header: {
      template: report.totals.exceptions ? 'orange' : 'green',
      title: { content: `📋 考勤周报（${win.label}）`, tag: 'plain_text' },
    },
    elements,
  };
}

// ---------- 可选：CSV 经现有飞书应用（im API）发文件到群 ----------
let tenantCache = { token: '', expiresAt: 0 };

async function getTenantToken() {
  if (!config.feishuAppId || !config.feishuAppSecret) {
    const err = new Error('未配置 FEISHU_APP_ID / FEISHU_APP_SECRET（走现有应用发 CSV 需要）');
    err.errcode = 'NO_CONFIG';
    throw err;
  }
  if (tenantCache.token && Date.now() < tenantCache.expiresAt - 5 * 60 * 1000) return tenantCache.token;
  const res = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
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
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const j = await res.json();
  if (j.code !== 0) throw feishuError(j.code, j.msg);
  return j;
}

/** 上传 CSV 并以应用身份发文件消息到群（webhook 传不了文件的补位方案） */
async function sendCsvViaApp(buffer, filename, chatId) {
  if (!chatId) {
    const err = new Error('未配置 FEISHU_CSV_CHAT_ID（群 chat_id，应用需在目标群）');
    err.errcode = 'NO_CONFIG';
    throw err;
  }
  const token = await getTenantToken();
  const fd = new FormData();
  fd.append('file_type', 'stream');
  fd.append('file_name', filename);
  fd.append('file', new Blob([buffer]), filename);
  const up = await fetch('https://open.feishu.cn/open-apis/im/v1/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
    signal: AbortSignal.timeout(30000),
  });
  const uj = await up.json();
  if (uj.code !== 0 || !uj.data || !uj.data.file_id) throw feishuError(uj.code, uj.msg);
  return feishuApi('im/v1/messages?receive_id_type=chat_id', {
    receive_id: chatId,
    msg_type: 'file',
    content: JSON.stringify({ file_id: uj.data.file_id }),
  });
}

module.exports = { signFor, sendCardToWebhook, pickChannels, buildAttendanceCard, sendCsvViaApp, getTenantToken, describeErrcode };
