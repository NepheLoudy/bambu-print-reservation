/**
 * qianli-netlog · 实验室网络日志探针（v1 · 2026-09-27）
 *
 * 背景：全家流量骑在主路由 superqianli（192.168.31.1）的学生账号校园网认证会话上，
 * 会话被踢/路由器异常 = 全家断网 = 生产机六机器人全掉线，且此时任何内网手段都看不到
 * 现场动机与恢复时刻（qianli-lab-network skill §四「被踢是常态」）。本服务跑在
 * 生产机（小电脑 DESKTOP-FE1MIGI）上持续探测并落盘，断网期间日志照记，恢复后把
 * 积压事件汇总成一张飞书卡片补发（通知通道与被监控网络同生死，实时通知物理上
 * 不可能，「落盘 + 恢复补报」是唯一正确语义）。
 *
 * 探测项：
 *   lan — 主路由 TCP 可达性（路由器/内网活着没）
 *   wan — 公网 TCP 可达性，多目标任一通即通（校园网认证会话活着没；不用域名，排除 DNS 因素）
 *   egress IP — wan 恢复时 / 每 30 分钟心跳时查出口 IP，变化即记事件（飞书 IP 白名单风险信号）
 *
 * 防抖：连续 NETLOG_FAIL_THRESHOLD 次失败才记 down（单次抖动不刷屏）；一次成功即记 up。
 * 日志：状态变化必记 + 无变化每 15 分钟心跳记一行（JSONL，量级 ~100 行/天，不做轮转）。
 * 端点（只读 GET，无鉴权项；本服务无任何写端点）：/api/health、/api/netlog/summary。
 *
 * 结构：createEngine(deps) 纯状态机（依赖注入，stub 可测）；本文件尾部组装真实依赖。
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { URL } = require('url');

// ============================================================
// 配置（env 均可覆盖；.env 由本文件顶部 dotenv 手工加载——零依赖，不引 dotenv 包）
// ============================================================
function loadDotEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadDotEnv();

const CONFIG = {
  port: Number(process.env.NETLOG_PORT || 3016),
  intervalMs: Number(process.env.NETLOG_INTERVAL_MS || 60 * 1000),
  timeoutMs: Number(process.env.NETLOG_TIMEOUT_MS || 2500),
  failThreshold: Number(process.env.NETLOG_FAIL_THRESHOLD || 2),
  lanHost: process.env.NETLOG_LAN_HOST || '192.168.31.1',
  lanPort: Number(process.env.NETLOG_LAN_PORT || 80),
  wanTargets: (process.env.NETLOG_WAN_TARGETS || '223.5.5.5:443,119.29.29.29:443')
    .split(',').map((s) => s.trim()).filter(Boolean)
    .map((s) => { const [host, port] = s.split(':'); return { host, port: Number(port || 443) }; }),
  heartbeatMs: Number(process.env.NETLOG_HEARTBEAT_MS || 15 * 60 * 1000),
  egressIntervalMs: Number(process.env.NETLOG_EGRESS_INTERVAL_MS || 30 * 60 * 1000),
  egressUrls: (process.env.NETLOG_EGRESS_URLS || 'http://members.3322.org/dyndns/getip,http://ip.3322.net,https://api.ipify.org')
    .split(',').map((s) => s.trim()).filter(Boolean),
  webhookUrl: process.env.NETLOG_WEBHOOK_URL || '',
  dataDir: process.env.NETLOG_DATA_DIR || path.join(os.homedir(), 'qianli-data', 'netlog'),
  // ---- 复活引擎（v2）：账号池 + Dr.COM eportal 认证 + 慢速降级 ----
  accountPool: process.env.NETLOG_ACCOUNT_POOL || path.join(os.homedir(), 'qianli-data', 'netlog', 'campus-accounts.local.json'),
  apiToken: process.env.NETLOG_API_TOKEN || '', // 手动复活端点鉴权（管理端点必须鉴权；未配置=端点锁定）
  reviveEnabled: process.env.NETLOG_REVIVE_ENABLED !== 'false', // 默认开；false 退化回纯日志探针
};

// ============================================================
// 状态机引擎（依赖注入，纯逻辑）
// ============================================================
function createEngine(deps) {
  const {
    probeLan, probeWan, fetchEgressIp, sendWebhook,
    appendLog, readBacklog, writeBacklog,
    now = () => Date.now(),
    failThreshold = CONFIG.failThreshold,
    heartbeatMs = CONFIG.heartbeatMs,
    egressIntervalMs = CONFIG.egressIntervalMs,
    onTick = null, // 钩子：每轮探测完成后调用 (wanOk, lanOk)；wanGuard 复活引擎挂这里
  } = deps;

  const state = {
    lan: null, wan: null, // null=未探测，true=up，false=down
    failLan: 0, failWan: 0,
    lanDownSince: 0, wanDownSince: 0,
    egressIp: '', lastEgressCheck: 0,
    lastLogAt: 0, startedAt: now(),
    events: [], // 内存 ring（最近 50 条事件，summary 直接吐）
  };

  function fmtTs(ts) {
    // 全仓 Asia/Shanghai 口径：epoch → +08:00 ISO 文本
    return new Date(ts + 8 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ') + '+08:00';
  }

  function record(type, row) {
    const line = { ts: now(), type, ...row };
    appendLog(line);
    if (type === 'event') {
      state.events.unshift({ ...line, tsText: fmtTs(line.ts) });
      if (state.events.length > 50) state.events.length = 50;
    }
    return line;
  }

  const BACKLOG_MAX = 50; // 积压上限：一直不配置 webhook 时防无限增长（丢最旧）

  // 事件分级（2026-09-28 刷屏事故整改）：只有关键状态变化才尝试即时推送；
  // 复活过程细节（start/success/no_candidates/throttled）只落盘+进积压（恢复汇总卡可见），
  // 绝不即时外发——否则误判/循环触发时会对通知群每分钟刷屏。
  const NOTIFY_IMMEDIATE = new Set([
    'lan_down', 'lan_up', 'wan_down', 'wan_up', 'egress_ip_changed', 'revive_exhausted',
  ]);

  async function notify(event, detail) {
    const text = `[netlog] ${event}${detail ? `\n${detail}` : ''}`;
    if (!NOTIFY_IMMEDIATE.has(event)) {
      // 过程事件：直接进积压（断网恢复后由汇总卡带上，平时不打扰通知群）
      pushBacklog(event, detail, 'process-event');
      return;
    }
    if (!CONFIG.webhookUrl) {
      // 未配置 webhook：事件仍入积压——配置补上并重启后由启动补发送达
      pushBacklog(event, detail, 'webhook 未配置');
      return;
    }
    try {
      await sendWebhook(text);
    } catch (err) {
      // 推送失败（断网时必然失败）→ 积压，恢复后汇总补发
      pushBacklog(event, detail, err.message);
      console.warn(`[netlog] 通知发送失败已积压: ${err.message}`);
    }
  }

  function pushBacklog(event, detail, error) {
    const backlog = readBacklog();
    backlog.push({ id: `${now()}-${Math.random().toString(36).slice(2, 8)}`, ts: now(), event, detail, error });
    while (backlog.length > BACKLOG_MAX) backlog.shift();
    writeBacklog(backlog);
  }

  function emit(event, detail) {
    record('event', { event, detail });
    console.log(`[netlog] 事件 ${event}${detail ? `: ${detail}` : ''}`);
    return notify(event, detail);
  }

  /** 断/恢复通用翻转：防抖记 down（连续 threshold 次失败），一次成功记 up */
  async function flip(key, ok, meta) {
    const isDown = state[key] === false;
    if (!ok) {
      state[`fail${key.charAt(0).toUpperCase()}${key.slice(1)}`] += 1;
      const fails = state[`fail${key.charAt(0).toUpperCase()}${key.slice(1)}`];
      if (!isDown && fails >= failThreshold) {
        state[key] = false;
        state[`${key}DownSince`] = now();
        await emit(`${key}_down`, `${meta} 连续 ${fails} 次探测失败，判定断开 @ ${fmtTs(now())}`);
      }
      return;
    }
    state[`fail${key.charAt(0).toUpperCase()}${key.slice(1)}`] = 0;
    if (isDown) {
      const dur = now() - state[`${key}DownSince`];
      state[key] = true;
      await emit(`${key}_up`, `${meta} 恢复，断开历时 ${Math.round(dur / 1000)}s（${fmtTs(state[`${key}DownSince`])} → ${fmtTs(now())}）`);
    } else if (state[key] === null) {
      state[key] = true; // 首轮探测直接成功：只落状态不报事件
    }
  }

  async function flushBacklog() {
    const backlog = readBacklog();
    if (!backlog.length) return;
    const lines = backlog.map((b) => `· ${fmtTs(b.ts)} ${b.event}${b.detail ? `：${b.detail}` : ''}`);
    const text = `[netlog] 断网期间事件汇总（${backlog.length} 条，现已恢复）\n${lines.join('\n')}`;
    try {
      await sendWebhook(text);
    } catch (err) {
      console.warn(`[netlog] 积压补发仍失败（保留待下轮）: ${err.message}`);
      return;
    }
    // 按 id 剔除已发条目后写回——冲刷期间新落盘的积压不被覆盖丢失（quiet-flush v87 同款教训）
    const sentIds = new Set(backlog.map((b) => b.id));
    writeBacklog(readBacklog().filter((b) => !sentIds.has(b.id)));
    console.log(`[netlog] 积压已补发 ${backlog.length} 条`);
  }

  async function checkEgress(reason) {
    state.lastEgressCheck = now();
    let ip = null;
    try { ip = await fetchEgressIp(); } catch { /* 查不到不阻塞主流程 */ }
    if (!ip) return;
    const prev = state.egressIp;
    state.egressIp = ip;
    if (prev && prev !== ip) {
      await emit('egress_ip_changed', `出口 IP ${prev} → ${ip}（${reason}）——校园网会话可能重连过，若开 IP 白名单需比对（/api/egress-ip 参照）`);
    }
  }

  async function tick() {
    let lanOk = false;
    let wanOk = false;
    try { lanOk = await probeLan(); } catch { /* 探测异常按失败计 */ }
    try { wanOk = await probeWan(); } catch { /* 同上 */ }

    const prevWanUp = state.wan === true;
    await flip('lan', lanOk, `主路由 ${CONFIG.lanHost}:${CONFIG.lanPort}`);
    await flip('wan', wanOk, '公网出口');
    record('state', { lan: lanOk, wan: wanOk, egressIp: state.egressIp });

    // 出口 IP：wan 刚恢复 或 到达心跳间隔才查（限频，防探测目标限流）
    if (wanOk && (state.wan !== prevWanUp || now() - state.lastEgressCheck >= egressIntervalMs || !state.lastEgressCheck)) {
      await checkEgress(state.wan !== prevWanUp ? '断网恢复' : '定期心跳');
    }
    // wan 恢复后补发断网期间积压的通知（通知通道与被监控网络同生死，这是主通知路径）
    if (wanOk && !prevWanUp) await flushBacklog();
    // 复活引擎钩子（防抖后语义：探测即时结果的组合）
    if (onTick) await onTick(wanOk, lanOk);
    state.lastLogAt = now();
  }

  function summary() {
    return {
      now: fmtTs(now()),
      lan: state.lan, wan: state.wan,
      lanDownSince: state.lanDownSince ? fmtTs(state.lanDownSince) : null,
      wanDownSince: state.wanDownSince ? fmtTs(state.wanDownSince) : null,
      egressIp: state.egressIp || null,
      lastEgressCheck: state.lastEgressCheck ? fmtTs(state.lastEgressCheck) : null,
      startedAt: fmtTs(state.startedAt),
      recentEvents: state.events,
    };
  }

  return { state, tick, summary, flushBacklog, emit, fmtTs };
}

// ============================================================
// 真实依赖组装 + HTTP 端点
// ============================================================
function probeTcp(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const net = require('net');
    const socket = net.connect({ host, port });
    const done = (ok) => { socket.destroy(); resolve(ok); };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

function httpRequestText(url, { timeoutMs = 5000, method = 'GET', body = null, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(u, { method, headers, timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(data);
        else reject(new Error(`HTTP ${res.statusCode}`));
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const DATA_FILE = path.join(CONFIG.dataDir, 'net-log.jsonl');
const BACKLOG_FILE = path.join(CONFIG.dataDir, 'backlog.json');

function ensureDataDir() {
  fs.mkdirSync(CONFIG.dataDir, { recursive: true });
}
function appendLog(line) {
  try {
    ensureDataDir();
    fs.appendFileSync(DATA_FILE, JSON.stringify(line) + '\n');
  } catch (err) {
    console.error(`[netlog] 日志落盘失败: ${err.message}`);
  }
}
function readBacklog() {
  try {
    const raw = fs.readFileSync(BACKLOG_FILE, 'utf8');
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
function writeBacklog(list) {
  try {
    ensureDataDir();
    fs.writeFileSync(BACKLOG_FILE, JSON.stringify(list, null, 2));
  } catch (err) {
    console.error(`[netlog] 积压写盘失败: ${err.message}`);
  }
}

async function fetchEgressIp() {
  for (const url of CONFIG.egressUrls) {
    try {
      const text = (await httpRequestText(url, { timeoutMs: 5000 })).trim();
      const ip = text.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
      if (ip) return ip[1];
    } catch { /* 换下一个候选源 */ }
  }
  return null;
}

async function sendWebhook(text) {
  if (!CONFIG.webhookUrl) throw new Error('webhook 未配置');
  const res = await httpRequestText(CONFIG.webhookUrl, {
    timeoutMs: 15000,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ msg_type: 'text', content: { text } }),
  });
  // 飞书 webhook 成功返回 {"StatusCode":0,...} / {"code":0}，非 0 视为失败进积压
  try {
    const data = JSON.parse(res);
    if ((data.code !== undefined && data.code !== 0) || (data.StatusCode !== undefined && data.StatusCode !== 0)) {
      throw new Error(`webhook 返回失败: ${res.slice(0, 200)}`);
    }
  } catch (err) {
    if (err.message.startsWith('webhook 返回失败')) throw err;
    // 非 JSON 响应（网关拦截页等）也按失败处理
    throw new Error(`webhook 响应异常: ${res.slice(0, 120)}`);
  }
}

// ============================================================
// wanGuard 复活引擎组装（v2）：账号池 × Dr.COM eportal × 慢速降级
// guard 与 engine 相互需要（guard.emit → engine.emit），用后绑定解环：
// guard 先建（emit 走占位），engine 建好后回填 emitRef。
// ============================================================
let guard = null;
let emitRef = (event, detail) => console.log(`[netlog] (emit 未就绪) ${event} ${detail || ''}`);
try {
  const { createAccountPool } = require('./accountPool');
  const campusAuth = require('./campusAuth');
  const { createWanGuard } = require('./wanGuard');

  const pool = createAccountPool(CONFIG.accountPool);

  /** 单次 wan 探测延迟（取 wanTargets 中最先成功者，失败 null） */
  async function probeLatency() {
    for (const t of CONFIG.wanTargets) {
      const start = Date.now();
      const ok = await probeTcp(t.host, t.port, CONFIG.timeoutMs);
      if (ok) return Date.now() - start;
    }
    return null;
  }

  guard = createWanGuard({
    candidates: () => pool.listCandidates(),
    authIp: () => campusAuth.fetchAuthIp(),
    login: (acct) => campusAuth.login(acct),
    probeLatency,
    ban: (user, reason) => pool.banThisMonth(user, reason),
    emit: (event, detail) => emitRef(event, detail),
  });

  var guardOnTick = (wanOk, lanOk) => guard.onTick(wanOk, lanOk);
} catch (err) {
  console.error(`[netlog] 复活引擎初始化失败（退化为纯日志探针）: ${err.message}`);
  var guardOnTick = null;
}

const engine = createEngine({
  probeLan: () => probeTcp(CONFIG.lanHost, CONFIG.lanPort, CONFIG.timeoutMs),
  probeWan: async () => {
    for (const t of CONFIG.wanTargets) {
      if (await probeTcp(t.host, t.port, CONFIG.timeoutMs)) return true;
    }
    return false;
  },
  fetchEgressIp,
  sendWebhook,
  appendLog,
  readBacklog,
  writeBacklog,
  onTick: async (wanOk, lanOk) => {
    if (!CONFIG.reviveEnabled || !guardOnTick) return;
    try {
      await guardOnTick(wanOk, lanOk);
      if (wanOk && guard) await guard.sampleBaseline();
    } catch (err) {
      console.error(`[netlog] wanGuard tick 异常: ${err.message}`);
    }
  },
});
emitRef = (event, detail) => engine.emit(event, detail); // 回填：guard 事件进引擎的记录+通知链路

function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/netlog/revive') {
      // 管理端点必须鉴权（全局工程规则）：X-API-Token，timingSafeEqual + fail-closed——未配置 token = 端点整体锁定
      const token = req.headers['x-api-token'] || '';
      const expected = CONFIG.apiToken;
      let authed = false;
      if (expected && token.length === expected.length) {
        authed = require('crypto').timingSafeEqual(Buffer.from(token), Buffer.from(expected));
      }
      if (req.method !== 'POST') {
        res.writeHead(405).end();
        return;
      }
      if (!authed) {
        console.warn(`[netlog] /api/netlog/revive 鉴权失败（token 未配置或不匹配），拒绝`);
        res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'forbidden' }));
        return;
      }
      if (!guard) {
        res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'guard 未初始化' }));
        return;
      }
      console.log('[netlog] 手动触发复活流程（API）');
      guard.forceRevive().then(() => {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, note: 'revive 流程已启动，结果看 /api/netlog/summary 与事件通知' }));
      }).catch((err) => {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: String(err.message) }));
      });
      return;
    }
    if (req.method !== 'GET') {
      res.writeHead(405).end();
      return;
    }
    if (url.pathname === '/api/health') {
      const s = engine.summary();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, lan: s.lan, wan: s.wan, egressIp: s.egressIp, uptime: Math.round((Date.now() - engine.state.startedAt) / 1000) + 's' }));
      return;
    }
    if (url.pathname === '/api/netlog/summary') {
      const s = engine.summary();
      s.guard = guard ? guard.summary() : null;
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(s, null, 2));
      return;
    }
    res.writeHead(404).end();
  });
  server.listen(CONFIG.port, () => {
    console.log(`[netlog] HTTP 端点已启动 :${CONFIG.port}（GET /api/health、/api/netlog/summary；POST /api/netlog/revive ${CONFIG.apiToken ? '已鉴权启用' : '未配置 NETLOG_API_TOKEN，已锁定'}）`);
  });
}

function main() {
  console.log(`[netlog] 启动：lan=${CONFIG.lanHost}:${CONFIG.lanPort} wan=${CONFIG.wanTargets.map((t) => `${t.host}:${t.port}`).join('/')} interval=${CONFIG.intervalMs}ms threshold=${CONFIG.failThreshold}`);
  console.log(`[netlog] 数据目录 ${CONFIG.dataDir}（net-log.jsonl + backlog.json）；webhook ${CONFIG.webhookUrl ? '已配置' : '未配置（只落盘不外发）'}`);
  console.log(`[netlog] 复活引擎 ${CONFIG.reviveEnabled ? '启用' : '停用'}：账号池 ${CONFIG.accountPool}${guard ? `（候选 ${(guard.summary().queueRemaining.length + (guard.summary().currentUser ? 1 : 0)) || '按池文件'}，首选项见 preferred）` : '（未初始化）'}`);
  startServer();
  // 启动即尝试补发历史积压（断网期间积压但 webhook 未配置/仍断的，配置就绪重启后送达）
  engine.flushBacklog().catch((err) => console.warn(`[netlog] 启动补发积压未完成（保留待下轮）: ${err.message}`));
  engine.tick().catch((err) => console.error(`[netlog] 首轮探测异常: ${err.message}`));
  setInterval(() => engine.tick().catch((err) => console.error(`[netlog] 探测轮异常: ${err.message}`)), CONFIG.intervalMs);
}

if (require.main === module) main();

module.exports = { createEngine, CONFIG, fmtShanghai: (ts) => new Date(ts + 8 * 3600 * 1000).toISOString() };
