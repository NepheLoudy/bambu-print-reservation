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
let wsClient = null;          // 当前 WSClient 实例（重试时整体新建）
let wsStatusTimer = null;     // 连接状态巡检（兜底 SDK 静默失败场景）
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

  // 2026-09-13（v21）：SDK 的 WSClient.start() 永不 reject（连接失败的唯一信号是
  // onError 回调与 getConnectionStatus().state==='failed'），promise 链不可依赖——
  // 改为 onError/onReady 回调驱动 + 30s 状态巡检兜底。
  // 每次尝试新建 WSClient：SDK 致命错误会置 terminalError 并停摆，旧实例状态不可信；
  // 新建保证同一时刻至多一条连接。
  wsStarted = false;
  wsConnecting = true;
  wsLastError = null;

  wsClient = new lark.WSClient({
    appId: config.feishu.appId,
    appSecret: config.feishu.appSecret,
    appType: lark.AppType.SelfBuild,
    domain: lark.Domain.FeiShu,
    loggerLevel: lark.LoggerLevel.info,
    onReady: () => {
      const recovered = wsRetryCount > 0;
      wsStarted = true;
      wsConnecting = false;
      wsLastError = null;
      wsRetryCount = 0;
      console.log(recovered ? '📡 长连接已恢复（重试成功）' : `📡 长连接已启动（共用应用本机唯一连接），订阅事件: ${config.eventTypes.join(', ')}`);
    },
    onReconnected: () => {
      wsStarted = true;
      wsConnecting = false;
      wsLastError = null;
    },
    onError: (err) => {
      // SDK 的 autoReconnect 会自行处理瞬时断线；走到这里的 onError 是致命错误
      // （凭证失败 / 重连耗尽，SDK 已置 terminalError 停摆）——必须新建客户端重试
      wsStarted = false;
      wsConnecting = false;
      wsLastError = (err && err.message) || String(err);
      wsRetryCount += 1;
      const delay = Math.min(WS_RETRY_BASE_MS * 2 ** Math.min(wsRetryCount - 1, 10), WS_RETRY_MAX_MS);
      console.error(`[网关] 长连接致命错误（第 ${wsRetryCount} 次），${Math.round(delay / 1000)}s 后新建客户端重试:`, wsLastError);
      scheduleWsRetry(delay);
    },
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

  wsClient.start({ eventDispatcher: dispatcher });
  console.log(`📡 长连接启动中（共用应用本机唯一连接），订阅事件: ${config.eventTypes.join(', ')}`);

  // 状态巡检（30s）：兜底「SDK 未触发 onError 也未连上」的静默失败场景
  if (!wsStatusTimer) {
    wsStatusTimer = setInterval(() => {
      if (!wsClient || wsRetryTimer || wsStarted) return;
      let st = null;
      try { st = wsClient.getConnectionStatus ? wsClient.getConnectionStatus() : null; } catch { st = null; }
      if (st && st.state === 'failed') {
        wsConnecting = false;
        wsLastError = wsLastError || '状态巡检发现长连接 failed';
        console.error('[网关] 状态巡检发现长连接 failed，转入自动重试');
        scheduleWsRetry(WS_RETRY_BASE_MS);
      } else if (st && st.state === 'connected' && !wsStarted) {
        wsStarted = true;
        wsConnecting = false;
        wsLastError = null;
        wsRetryCount = 0;
        console.log('📡 长连接已连接（状态巡检确认）');
      }
    }, 30 * 1000);
  }
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
