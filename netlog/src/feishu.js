/**
 * 飞书私聊通知（netlog v6）：用共用应用（对话型「爆米花机-对话型」同款应用）
 * 的 tenant_access_token 给指定 open_id 发文本私聊。
 * 性质=机器人主动播报（同 ticket-bot 私聊结单提醒先例，不消费消息事件，不违反对话铁律）。
 * token 内存缓存，过期前提前刷新；失败 throw（调用方 netlog 的积压机制兜底）。
 */
const https = require('https');

const APP_ID = process.env.NETLOG_FEISHU_APP_ID || '';
const APP_SECRET = process.env.NETLOG_FEISHU_APP_SECRET || '';
const NOTIFY_OPEN_IDS = (process.env.NETLOG_NOTIFY_OPEN_IDS || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

let tokenCache = { token: '', expiresAt: 0 };

function postJson(url, body, headers = {}, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request(url, {
      method: 'POST',
      timeout: timeoutMs,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data), ...headers },
    }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch (e) { reject(new Error(`非 JSON 响应: ${d.slice(0, 120)}`)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.write(data);
    req.end();
  });
}

async function getToken() {
  const now = Date.now();
  if (tokenCache.token && now < tokenCache.expiresAt) return tokenCache.token;
  if (!APP_ID || !APP_SECRET) throw new Error('飞书凭据未配置（NETLOG_FEISHU_APP_ID/SECRET）');
  const r = await postJson('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    app_id: APP_ID, app_secret: APP_SECRET,
  });
  if (!r.tenant_access_token) throw new Error(`获取 tenant_access_token 失败: ${JSON.stringify(r).slice(0, 160)}`);
  tokenCache = { token: r.tenant_access_token, expiresAt: now + ((r.expire || 7200) - 300) * 1000 };
  return tokenCache.token;
}

/** 给单个 open_id 发文本私聊；飞书非 0 code 抛错（调用方决定重试/积压） */
async function sendTextToOpenId(openId, text) {
  const token = await getToken();
  const r = await postJson(
    'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id',
    { receive_id: openId, msg_type: 'text', content: JSON.stringify({ text }) },
    { Authorization: `Bearer ${token}` },
  );
  if (r.code !== 0) throw new Error(`私聊发送失败: ${JSON.stringify(r).slice(0, 160)}`);
  return r;
}

module.exports = { sendTextToOpenId, NOTIFY_OPEN_IDS };
