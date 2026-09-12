const express = require('express');
const lark = require('@larksuiteoapi/node-sdk');
const config = require('./config');
const { dispatchFrame } = require('./dispatch');
const usage = require('./usage');
const bitableSync = require('./bitable-sync');
const { requireApiToken } = require('./auth');

const app = express();
app.use(express.json({ limit: '2mb' }));

let wsStarted = false;
let wsLastError = null;
let wsConnecting = false;
let wsRetryTimer = null;
let wsRetryCount = 0;
const WS_RETRY_BASE_MS = 5 * 1000;      // 首次重试 5s
const WS_RETRY_MAX_MS = 5 * 60 * 1000;  // 封顶 5 分钟
const WS_START_WATCHDOG_MS = 120 * 1000; // start() 无响应看门狗

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    ws: wsLastError ? `error: ${wsLastError}` : wsStarted ? 'running' : wsConnecting ? 'connecting' : 'stopped',
    uptime: process.uptime(),
    defaultTarget: config.defaultTarget,
    consumers: config.consumers,
    routes: config.messageRoutes,
  });
});

// 使用统计（运维台活跃看板数据源）：?days=N 聚合最近 N 天（默认 1，最大 30）
app.get('/api/usage', (req, res) => {
  res.json(usage.aggregate(req.query.days));
});

// 手动触发网关活跃 → 多维表格同步（动态广场看板；?force=1 忽略签名重写全部）
// 鉴权（2026-09-13）：需带 X-API-Token 头（GATEWAY_API_TOKEN，.env 存储）
app.post('/api/usage-sync/run', requireApiToken, async (req, res) => {
  try {
    res.json({ ok: true, result: await bitableSync.runSync({ force: req.query.force === '1' }) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 手动投递测试：POST {type, event} 或 {header:{event_type}, event}，走与长连接相同的分发管线
// 鉴权（2026-09-13）：需带 X-API-Token 头（GATEWAY_API_TOKEN，.env 存储）
app.post('/api/dispatch', requireApiToken, async (req, res) => {
  const { type, header, event } = req.body || {};
  const eventType = (header && header.event_type) || type;
  if (!eventType) {
    return res.status(400).json({ error: '缺少 event_type（header.event_type 或 type）' });
  }
  try {
    const result = await dispatchFrame(eventType, {
      header: Object.assign({ event_type: eventType }, header || {}),
      event,
    });
    res.json(Object.assign({ ok: true }, result || {}));
  } catch (err) {
    console.error('[网关] 手动投递失败:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

function startWs() {
  if (!config.feishu.appId || !config.feishu.appSecret) {
    console.warn('[网关] 未配置 APP_ID/APP_SECRET，长连接未启动（HTTP 服务可用，可通过 /api/dispatch 测试路由）');
    return;
  }

  const wsClient = new lark.WSClient({
    appId: config.feishu.appId,
    appSecret: config.feishu.appSecret,
    appType: lark.AppType.SelfBuild,
    domain: lark.Domain.FeiShu,
    loggerLevel: lark.LoggerLevel.info,
  });

  const dispatcher = new lark.EventDispatcher({});
  for (const eventType of config.eventTypes) {
    dispatcher.register({
      [eventType]: async (data) => {
        try {
          await dispatchFrame(eventType, data);
        } catch (err) {
          console.error(`[网关] 处理事件 ${eventType} 失败:`, err.message);
        }
      },
    });
  }

  // start() 返回 Promise：连接失败（凭证错误/网络故障）若不 catch 会变成 unhandled rejection 直接杀死进程。
  // 2026-09-13 起失败自动重试（指数退避 5s→5min 封顶），每次尝试新建 WSClient——失败的客户端
  // 状态不可信，新建可保证同一时刻至多一条连接；成功后重试计数清零。
  wsStarted = false;
  wsConnecting = true;
  wsLastError = null;
  wsClient
    .start({ eventDispatcher: dispatcher })
    .then(() => {
      const recovered = wsRetryCount > 0;
      wsStarted = true;
      wsConnecting = false;
      wsLastError = null;
      wsRetryCount = 0;
      console.log(recovered ? '📡 长连接已恢复（重试成功）' : `📡 长连接已启动（共用应用本机唯一连接），订阅事件: ${config.eventTypes.join(', ')}`);
    })
    .catch((err) => {
      wsStarted = false;
      wsConnecting = false;
      wsLastError = err.message;
      wsRetryCount += 1;
      const delay = Math.min(WS_RETRY_BASE_MS * 2 ** (wsRetryCount - 1), WS_RETRY_MAX_MS);
      console.error(`[网关] 长连接启动失败（第 ${wsRetryCount} 次），${Math.round(delay / 1000)}s 后自动重试:`, err.message);
      scheduleWsRetry(delay);
    });
  console.log(`📡 长连接启动中（共用应用本机唯一连接），订阅事件: ${config.eventTypes.join(', ')}`);

  // 看门狗：start() 长时间无响应（既不成功也不失败）时兜底重试
  setTimeout(() => {
    if (!wsStarted && !wsRetryTimer && wsConnecting) {
      wsConnecting = false;
      wsLastError = '启动 120s 未完成（无响应），转入自动重试';
      console.error('[网关]', wsLastError);
      scheduleWsRetry(WS_RETRY_BASE_MS);
    }
  }, WS_START_WATCHDOG_MS).unref();
}

function scheduleWsRetry(delay) {
  if (wsRetryTimer) return;
  wsRetryTimer = setTimeout(() => {
    wsRetryTimer = null;
    startWs();
  }, delay);
}

// 兜底：任何未捕获的 Promise 拒绝只记日志，不允许击垮唯一长连接进程
process.on('unhandledRejection', (err) => {
  console.error('[网关] 未处理的 Promise 拒绝:', (err && err.message) || err);
});

// 多维表格记录变更事件的前置条件：订阅对应云文档（幂等，可重复调用）
async function subscribeDocs() {
  if (!config.docSubscribes.length || !config.feishu.appId || !config.feishu.appSecret) return;
  try {
    const tokenRes = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: config.feishu.appId, app_secret: config.feishu.appSecret }),
    });
    const tokenData = await tokenRes.json();
    if (tokenData.code !== 0) {
      throw new Error(tokenData.msg || '获取 tenant_access_token 失败');
    }
    for (const appToken of config.docSubscribes) {
      const res = await fetch(`https://open.feishu.cn/open-apis/drive/v1/files/${appToken}/subscribe?file_type=bitable`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenData.tenant_access_token}` },
      });
      const data = await res.json().catch(() => ({}));
      console.log(`[网关] 订阅云文档 ${appToken}: code=${data.code} ${data.msg || ''}`);
    }
  } catch (err) {
    console.error('[网关] 订阅云文档失败:', err.message);
  }
}

app.listen(config.port, () => {
  console.log(`🚀 feishu-gateway 运行在 http://localhost:${config.port}`);
  console.log(
    `   下游消费者: ${config.consumers.map((c) => `${c.name}${c.legacy ? '(legacy)' : ''}`).join(', ')}`
  );
  console.log(`   默认消息目标: ${config.defaultTarget}`);
  console.log(`   消息路由规则: ${config.messageRoutes.length} 条`);
  subscribeDocs();
  startWs();
  bitableSync.start();
});
