// ============================================================
// wecom-attendance-bot 入口
// 企业微信考勤周报机器人：每周定时拉打卡数据 → 聚合 → 群机器人 webhook 播报
// （markdown_v2 周报卡 + CSV 明细附件）。不消费任何消息事件，不接飞书网关。
// ============================================================
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const path = require('path');
const express = require('express');
const cors = require('cors');
const config = require('./config');
const { requireApiToken } = require('./auth');
const store = require('./store');
const wecom = require('./wecom');
const report = require('./report');
const scheduler = require('./scheduler');

const app = express();
app.use(cors());
// 网关 413 教训：默认 100kb 不够，统一放宽到 2mb（虽然本服务入参都很小）
app.use(express.json({ limit: '2mb' }));

const startedAt = Date.now();

// ---- 健康检查（不受鉴权限制，运维台巡检用） ----
// 名册/状态文件损坏时健康检查要仍可用（巡检端点不能被配置错误打挂），错误进 membersError/stateError
app.get('/api/health', (req, res) => {
  let state = {};
  let stateError = null;
  let members = [];
  let membersError = null;
  try {
    state = store.loadState();
  } catch (e) {
    stateError = e.message;
  }
  try {
    members = store.loadMembers();
  } catch (e) {
    membersError = e.message;
  }
  res.json({
    ok: true,
    uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
    config: {
      corpId: !!config.corpId,
      secret: !!config.secret,
      webhook: !!config.webhookKey,
      apiToken: !!config.apiToken,
      members: membersError ? null : members.length,
      membersError,
      stateError,
    },
    cron: config.cron,
    timezone: config.timezone,
    lastSentWeekKey: state.lastSentWeekKey || null,
    lastSentAt: state.lastSentAt || null,
    lastError: state.lastError || null,
  });
});

// ---- 定制窗口：政策全景只读（顶层 AGENTS「机器人后端定制窗口」） ----
app.get('/api/attendance/policy', (req, res) => {
  const members = store.loadMembers();
  const win = report.weekWindow(0, Date.now(), config.cronParts.dow == null ? 1 : config.cronParts.dow);
  res.json({
    domain: '企业微信考勤周报',
    broadcast: { cron: config.cron, timezone: config.timezone, windowLabel: win.label, windowKey: win.key },
    wecom: {
      corpId: config.corpId || '（未配置）',
      secretConfigured: !!config.secret,
      webhookConfigured: !!config.webhookKey,
      apiDocs: '拉数需自建应用+打卡授权+可信IP；播报走群机器人 webhook（不受可信 IP 限制）',
    },
    members: { file: config.membersFile, count: members.length, list: members },
    state: store.loadState(),
    apiTokenLocked: !config.apiToken,
  });
});

// ---- 写窗口：成员增删（X-API-Token） ----
app.post('/api/attendance/members', requireApiToken, (req, res) => {
  const { action, userid, name } = req.body || {};
  const { list, error } = store.applyMembersChange({ action, userid, name });
  if (error) return res.status(400).json({ error });
  res.json({ ok: true, count: list.length, list });
});

// ---- 预览：只拉数渲染不发送（只读，未配置企微凭据时明确报错） ----
app.get('/api/attendance/preview', async (req, res) => {
  const offset = Number(req.query.weekOffset || 0) || 0;
  try {
    const r = await scheduler.runWeekly({ offset, dryRun: true });
    res.json({ ok: true, window: r.window.label, totals: r.totals, markdown: r.markdown, csvPreview: r.csv.split('\r\n').slice(0, 6) });
  } catch (err) {
    res.status(err.errcode === 'NO_CONFIG' ? 503 : 502).json({ error: err.message, hint: err.hint || null });
  }
});

// ---- 测试播报：真实发送（X-API-Token），支持 dryRun 与周偏移 ----
app.post('/api/attendance/test-broadcast', requireApiToken, async (req, res) => {
  const { weekOffset = 0, dryRun = false } = req.body || {};
  try {
    const r = await scheduler.guardedRun({ offset: Number(weekOffset) || 0, dryRun: !!dryRun, trigger: 'manual' });
    res.json({ ok: true, sent: r.sent, window: r.window.label, totals: r.totals, markdown: r.markdown });
  } catch (err) {
    res.status(err.errcode === 'NO_CONFIG' ? 503 : 502).json({ error: err.message, hint: err.hint || null });
  }
});

app.listen(config.port, '127.0.0.1', () => {
  console.log(`[考勤] wecom-attendance-bot 已启动: http://127.0.0.1:${config.port}（数据目录 ${config.stateFile}）`);
});

scheduler.start((opts) => scheduler.guardedRun(opts));

process.on('SIGINT', () => { scheduler.stop(); process.exit(0); });
process.on('SIGTERM', () => { scheduler.stop(); process.exit(0); });
