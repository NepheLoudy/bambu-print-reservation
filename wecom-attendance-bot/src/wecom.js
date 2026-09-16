// ============================================================
// 企业微信 API 客户端（原生 fetch，Node 22 自带 FormData/Blob）
//
// 两条通道，权限口径完全不同：
//   ① 拉数（gettoken + checkin/getcheckindata）：走自建应用，受「可信 IP」限制——
//      部署目标出口公网 IP 变动后报 60020，需到管理后台更新可信 IP；
//   ② 播报（webhook/send + webhook/upload_media）：群机器人 key 即凭证，
//      不校验可信 IP、不需要 access_token——所以拉数挂了仍能用它发告警。
// 接口约束（官方文档 94205/91770）：拉数跨度 ≤30 天、单批 userid ≤100、600 次/分；
// webhook 20 条/分；upload_media 的 media_id 3 天有效且仅限本机器人使用（发完即弃，正合适）。
// ============================================================
const config = require('./config');

const QYAPI = 'https://qyapi.weixin.qq.com/cgi-bin';
const USER_BATCH = 100;
const FETCH_TIMEOUT_MS = 15000; // 所有出站请求统一 15s 超时（挂死不占住播报链路）

let tokenCache = { token: '', expiresAt: 0 };

function wecomError(errcode, errmsg) {
  const err = new Error(`企微接口错误 ${errcode}: ${errmsg || ''}`);
  err.errcode = errcode;
  err.hint = describeErrcode(errcode);
  return err;
}

function describeErrcode(errcode) {
  if (errcode === 60020) return 'IP 不在自建应用「可信IP」列表：部署目标出口公网 IP 变动后需到管理后台→应用详情→开发者接口→可信IP 更新（webhook 播报不受影响）';
  if (errcode === 40014 || errcode === 42001) return 'access_token 无效或过期（自动重取一次，仍失败检查 corpid/secret）';
  if (errcode === 60011) return '自建应用无打卡数据权限：管理后台「打卡」应用→可调用接口的应用→勾选本应用';
  if (errcode === 81013) return 'userid 非法或不在应用可见范围：检查 config/members.json 与应用可见范围';
  return '';
}

async function callQyapi(pathName, body, { tokenRetry = true } = {}) {
  const token = await getToken();
  const res = await fetch(`${QYAPI}/${pathName}?access_token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const j = await res.json();
  if (j.errcode && j.errcode !== 0) {
    // token 失效自动重取再试一次（仅一次，防循环）
    if (tokenRetry && (j.errcode === 40014 || j.errcode === 42001)) {
      tokenCache = { token: '', expiresAt: 0 };
      return callQyapi(pathName, body, { tokenRetry: false });
    }
    throw wecomError(j.errcode, j.errmsg);
  }
  return j;
}

async function getToken() {
  if (!config.corpId || !config.secret) {
    const err = new Error('未配置 WECOM_CORP_ID / WECOM_ATTENDANCE_SECRET（.env）');
    err.errcode = 'NO_CONFIG';
    throw err;
  }
  if (tokenCache.token && Date.now() < tokenCache.expiresAt - 5 * 60 * 1000) return tokenCache.token;
  const res = await fetch(`${QYAPI}/gettoken?corpid=${encodeURIComponent(config.corpId)}&corpsecret=${encodeURIComponent(config.secret)}`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const j = await res.json();
  if (!j.access_token) throw wecomError(j.errcode || 'NO_TOKEN', j.errmsg);
  tokenCache = { token: j.access_token, expiresAt: Date.now() + (j.expires_in || 7200) * 1000 };
  return tokenCache.token;
}

// 拉打卡记录：opencheckindatatype=3 全部打卡（上下班+外出）；userid 分批 ≤100
async function getCheckinData(startSec, endSec, userids) {
  const ids = [...new Set(userids)].filter(Boolean);
  if (!ids.length) return [];
  const all = [];
  for (let i = 0; i < ids.length; i += USER_BATCH) {
    const batch = ids.slice(i, i + USER_BATCH);
    const j = await callQyapi('checkin/getcheckindata', {
      opencheckindatatype: 3,
      starttime: Math.floor(startSec),
      endtime: Math.floor(endSec),
      useridlist: batch,
    });
    all.push(...(j.checkindata || []));
  }
  return all;
}

async function sendWebhook(payload) {
  if (!config.webhookKey) {
    const err = new Error('未配置 WECOM_WEBHOOK_KEY（.env）');
    err.errcode = 'NO_CONFIG';
    throw err;
  }
  const res = await fetch(`${QYAPI}/webhook/send?key=${encodeURIComponent(config.webhookKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const j = await res.json();
  if (j.errcode && j.errcode !== 0) throw wecomError(j.errcode, j.errmsg);
  return j;
}

async function sendMarkdownV2(content) {
  return sendWebhook({ msgtype: 'markdown_v2', markdown_v2: { content } });
}

// 上传文件并随 file 消息发出（media_id 3 天有效，即时用即弃）
async function sendFile(buffer, filename) {
  if (!config.webhookKey) {
    const err = new Error('未配置 WECOM_WEBHOOK_KEY（.env）');
    err.errcode = 'NO_CONFIG';
    throw err;
  }
  const fd = new FormData();
  fd.append('media', new Blob([buffer]), filename);
  const res = await fetch(`${QYAPI}/webhook/upload_media?key=${encodeURIComponent(config.webhookKey)}&type=file`, {
    method: 'POST',
    body: fd,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const j = await res.json();
  if (!j.media_id) throw wecomError(j.errcode || 'NO_MEDIA', j.errmsg);
  return sendWebhook({ msgtype: 'file', file: { media_id: j.media_id } });
}

// 纯函数：把名单拆成 ≤100 的批（桩测试用）
function partitionUserids(userids, size = USER_BATCH) {
  const ids = [...new Set(userids)].filter(Boolean);
  const out = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

module.exports = { getToken, getCheckinData, sendWebhook, sendMarkdownV2, sendFile, partitionUserids, describeErrcode };
