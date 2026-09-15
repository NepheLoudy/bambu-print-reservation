const express = require('express');
const { spawn, execFileSync } = require('child_process');
const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');
const registry = require('./registry');

// ============================================================
// qianli 本地运维台（仅 127.0.0.1，不部署 NAS）
// - 可视化：各机器人端口职能/权限/指令/监听 + 本地 git 更新状态 + NAS pm2 状态
// - 总览仪表台：服务状态矩阵 / 1h 状态时间线 / 24h 可用率 / 掉线事件 / 近 7 天提交活跃（/api/stats）
// - 本地测试进程：start/stop/log（自动 QUIET_HOURS_DISABLED=1，手动触发不受静默限制）
// - 快捷指令：npm push / install / stub 测试（注册表 quickActions）
// - NAS：pm2 状态 / 日志 tail / 重启（走 SSH，凭据直读 approval-bot/.env）
// ============================================================

const ROOT = path.join(__dirname, '..');
const PORT = process.env.PORT || 3100;
const LOG_CAP = 600;

const app = express();
app.use(express.json());
// DNS rebinding 防护（2026-09-15 审查批）：本服务只服务本机浏览器，
// 校验 Host 头为回环——恶意网页把域名解析到 127.0.0.1 时 Host 会带原域名，直接拒绝，
// 防「网页→本机运维台→SSH 代理」跨站打穿链
app.use((req, res, next) => {
  const host = String(req.headers.host || '');
  if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(host)) {
    return res.status(403).json({ error: '仅限本机访问（Host 校验失败）' });
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

// ---------- NAS 连接配置：直读 approval-bot/.env（单一来源，不复制凭据） ----------
function readNasConfig() {
  try {
    const text = fs.readFileSync(path.join(ROOT, 'approval-bot', '.env'), 'utf-8');
    const get = (k) => (text.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1] || '';
    return { host: get('NAS_HOST').trim(), port: Number(get('NAS_PORT').trim() || 22), username: get('NAS_USER').trim(), password: get('NAS_PASSWORD').trim(), apiToken: (get('API_TOKEN') || get('QIANLI_API_TOKEN') || '').trim() };
  } catch (err) {
    return null;
  }
}

function sshExec(cmd, timeoutMs = 15000) {
  const cfg = readNasConfig();
  if (!cfg || !cfg.host || !cfg.password) return Promise.reject(new Error('未读到部署目标配置（approval-bot/.env 的 NAS_* 键,历史命名）'));
  return new Promise((resolve, reject) => {
    const conn = new Client();
    const timer = setTimeout(() => { conn.end(); reject(new Error('SSH 超时')); }, timeoutMs);
    let out = '';
    conn.on('ready', () => {
      conn.exec(cmd, (err, stream) => {
        if (err) { clearTimeout(timer); conn.end(); return reject(err); }
        stream.on('data', (d) => { out += d.toString(); });
        stream.stderr.on('data', (d) => { out += d.toString(); });
        stream.on('close', () => { clearTimeout(timer); conn.end(); resolve(out); });
      });
    });
    conn.on('error', (err) => { clearTimeout(timer); reject(err); });
    conn.connect(cfg);
  });
}

// ---------- 本地测试进程管理 ----------
const localProcs = new Map(); // id -> { child, log: string[], startedAt }

function pushLog(id, line) {
  const p = localProcs.get(id);
  if (!p) return;
  p.log.push(line);
  if (p.log.length > LOG_CAP) p.log.splice(0, p.log.length - LOG_CAP);
}

function startLocal(id) {
  const proj = registry.projects.find((p) => p.id === id);
  if (!proj || !proj.localRun) return { ok: false, error: '该项目不支持本地运行' };
  if (localProcs.has(id) && localProcs.get(id).child.exitCode === null) return { ok: false, error: '本地进程已在运行' };

  const cwd = path.join(ROOT, proj.dir, proj.localRun.cwd || '');
  const child = spawn(process.execPath, [path.join(cwd, proj.localRun.script)], {
    cwd,
    env: { ...process.env, QUIET_HOURS_DISABLED: '1', ...proj.localRun.env },
    shell: false,
  });
  const entry = { child, log: [`[本地启动] ${new Date().toLocaleString('zh-CN')} pid=${child.pid}`], startedAt: Date.now() };
  localProcs.set(id, entry);
  child.stdout.on('data', (d) => d.toString().split(/\r?\n/).forEach((l) => l && pushLog(id, l)));
  child.stderr.on('data', (d) => d.toString().split(/\r?\n/).forEach((l) => l && pushLog(id, `[err] ${l}`)));
  child.on('exit', (code) => pushLog(id, `[退出] code=${code}`));
  child.on('error', (err) => { pushLog(id, `[spawn错误] ${err.message}`); });
  return { ok: true, pid: child.pid };
}

function stopLocal(id) {
  const p = localProcs.get(id);
  if (!p || p.child.exitCode !== null) return { ok: false, error: '本地进程未在运行' };
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(p.child.pid), '/T', '/F'], { shell: false });
  } else {
    p.child.kill('SIGINT');
  }
  return { ok: true };
}

// ---------- 一次性动作执行（快捷指令：push/install/test…） ----------
const actionProcs = new Map(); // id -> { log, running, cmd, exitCode, startedAt }

function runAction(id, cmd, cwdRel, args = []) {
  if (actionProcs.get(id)?.running) return { ok: false, error: '该项目有动作正在执行' };
  const cwd = path.join(ROOT, cwdRel || '');
  const entry = { log: [`[${new Date().toLocaleString('zh-CN')}] ${cmd} ${args.join(' ')}（cwd: ${path.relative(ROOT, cwd) || '.'}）`], running: true, cmd: `${cmd} ${args.join(' ')}`.trim(), exitCode: null, startedAt: Date.now() };
  actionProcs.set(id, entry);

  const useShell = process.platform === 'win32';
  // win32 走 shell 拼接：参数内引号剥除，防 `"` 逃逸引号边界执行任意命令
  const shellSafe = (a) => String(a).replace(/["`%\r\n]/g, ''); // % 剥除：cmd.exe 引号内 %VAR% 仍展开
  const child = spawn(useShell ? `${cmd} ${args.map((a) => `"${shellSafe(a)}"`).join(' ')}` : cmd, args.length && !useShell ? args : [], {
    cwd, shell: useShell, env: { ...process.env },
  });
  actionStats.total += 1;
  actionStats.last = { id, cmd: entry.cmd, at: entry.startedAt };
  child.stdout.on('data', (d) => { entry.log.push(...d.toString().split(/\r?\n/).filter(Boolean)); if (entry.log.length > LOG_CAP * 4) entry.log.splice(0, entry.log.length - LOG_CAP * 4); });
  child.stderr.on('data', (d) => { entry.log.push(...d.toString().split(/\r?\n/).filter(Boolean).map((l) => `[err] ${l}`)); if (entry.log.length > LOG_CAP * 4) entry.log.splice(0, entry.log.length - LOG_CAP * 4); });
  child.on('error', (err) => { entry.running = false; entry.exitCode = -1; entry.log.push(`[spawn错误] ${err.message}（cwd: ${cwd}）`); });
  child.on('exit', (code) => { entry.running = false; entry.exitCode = code; entry.log.push(`[结束] code=${code}`); });
  return { ok: true };
}

// ---------- 概览 ----------
const gitCache = new Map(); // dir -> { t, data }

// git 命令统一走 execFileSync 数组传参：cmd.exe 会把 %h|%s|%ci 的 | 当管道、撕碎带空格的引号参数
function gitRun(cwd, args) {
  try { return execFileSync('git', args, { cwd, encoding: 'utf-8', timeout: 8000, windowsHide: true }).trim(); }
  catch (err) { return ''; }
}

function gitInfo(dir) {
  const abs = path.join(ROOT, dir);
  const cached = gitCache.get(abs);
  if (cached && Date.now() - cached.t < 30 * 1000) return cached.data;
  const data = {
    inRepo: !!gitRun(abs, ['rev-parse', '--is-inside-work-tree']),
    branch: gitRun(abs, ['rev-parse', '--abbrev-ref', 'HEAD']) || '-',
    lastCommit: (() => {
      const l = gitRun(abs, ['log', '-1', '--format=%h|%s|%ci']);
      const [h, s, d] = l.split('|');
      return { hash: h || '-', subject: s || '-', date: d || '' };
    })(),
    dirty: gitRun(abs, ['status', '--porcelain']).split('\n').filter(Boolean).length,
  };
  gitCache.set(abs, { t: Date.now(), data });
  return data;
}

async function nasStatus() {
  const cached = nasStatus.cache;
  if (cached && Date.now() - cached.t < 20 * 1000) return cached.data;
  try {
    const out = await sshExec('pm2 jlist', 20000);
    const start = out.indexOf('[');
    const list = JSON.parse(out.slice(start)) || [];
    const data = {
      online: true,
      procs: list.map((p) => ({
        name: p.name, status: p.pm2_env?.status, restarts: p.pm2_env?.restart_time,
        uptimeMs: p.pm2_env?.status === 'online' ? Date.now() - (p.pm2_env?.pm_uptime || 0) : 0,
        memMb: p.monit ? Math.round(p.monit.memory / 1048576) : null,
      })),
    };
    nasStatus.cache = { t: Date.now(), data };
    return data;
  } catch (err) {
    return { online: false, error: err.message, procs: [] };
  }
}

async function localHealth(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch (err) { return false; }
}

// ---------- 总览仪表台：状态采样史（随 /api/overview 轮询采样，同态并段省空间，落盘可续） ----------
const HISTORY_FILE = path.join(__dirname, '.status-history.json');
const SAMPLE_MIN_GAP = 25 * 1000;          // 采样最小间隔（前端 4s 轮询，实际约 25~30s 一针）
const SAME_STATE_MERGE_MS = 10 * 60 * 1000; // 状态未变化时原地推进时间点，超过该时长才落新针（兜底）
const HISTORY_KEEP_MS = 3 * 24 * 3600 * 1000;
// s：2=NAS 在线 1=仅本地测试进程在跑 0=离线 3=未知（NAS 不可达，不计入可用率分母）
// 段结构 {t0 段起点, t 末次确认}：同态并段只推进 t，t0 保留状态起始时刻（持续时长/时间线/事件都靠它）
const history = { samples: {}, dirty: false };
try {
  const raw = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
  for (const [id, arr] of Object.entries(raw.samples || {})) {
    history.samples[id] = (arr || [])
      .filter((s) => s && Date.now() - s.t < HISTORY_KEEP_MS)
      .map((s) => ({ t0: s.t0 ?? s.t, t: s.t, s: s.s }));
  }
} catch (err) { /* 首次运行空表起步 */ }

setInterval(() => {
  if (!history.dirty) return;
  history.dirty = false;
  fs.writeFile(HISTORY_FILE, JSON.stringify({ v: 1, samples: history.samples }), () => {});
}, 60 * 1000);

function recordSamples(projects, nas) {
  const now = Date.now();
  for (const p of projects) {
    const arr = history.samples[p.id] || (history.samples[p.id] = []);
    const last = arr[arr.length - 1];
    if (last && now - last.t < SAMPLE_MIN_GAP) continue;
    const s = p.id === 'dashboard' ? 2
      : !nas.online ? 3
      : p.pm2Name ? (p.nas && p.nas.status === 'online' ? 2 : (p.localRunning ? 1 : 0))
      : (p.localRunning ? 1 : 3);
    if (last && last.s === s && now - last.t < SAME_STATE_MERGE_MS) last.t = now;
    else arr.push({ t0: now, t: now, s });
    while (arr.length && now - arr[0].t0 > HISTORY_KEEP_MS) arr.shift();
    history.dirty = true;
  }
}

function stateSpans(id) {
  const arr = history.samples[id] || [];
  const spans = [];
  for (let i = 0; i < arr.length; i++) {
    spans.push({ s: arr[i].s, from: arr[i].t0, to: i + 1 < arr.length ? arr[i + 1].t0 : Infinity });
  }
  return spans;
}

function availability(id, winMs) {
  const now = Date.now(); const cutoff = now - winMs;
  let total = 0, ok = 0;
  for (const sp of stateSpans(id)) {
    const from = Math.max(sp.from, cutoff), to = Math.min(sp.to, now);
    if (to <= from || sp.s === 3) continue;
    total += to - from;
    if (sp.s > 0) ok += to - from;
  }
  return total > 0 ? Math.round((ok / total) * 1000) / 10 : null;
}

function currentState(id) {
  const arr = history.samples[id] || [];
  if (!arr.length) return null;
  const s = arr[arr.length - 1].s;
  let i = arr.length - 1;
  while (i > 0 && arr[i - 1].s === s) i--;
  return { s, sinceMs: Date.now() - arr[i].t0 };
}

function offlineEpisodes(id, winMs) {
  const cutoff = Date.now() - winMs;
  const eps = []; let cur = null;
  for (const sp of stateSpans(id)) {
    if (sp.to <= cutoff) continue;
    if (sp.s === 0) { if (!cur) cur = { id, start: Math.max(sp.from, cutoff), end: null }; }
    else if (cur) { cur.end = sp.from; eps.push(cur); cur = null; }
  }
  if (cur) eps.push(cur);
  return eps;
}

function timeline(id, winMs = 60 * 60 * 1000, n = 30) {
  const now = Date.now(); const step = winMs / n;
  // 仍在确认中的段（t 新）即使 t0 在窗口外也要参与：ongoing 状态覆盖窗口尾部
  const arr = (history.samples[id] || []).filter((s) => s.t > now - winMs - step);
  if (!arr.length) return null;
  const cells = [];
  for (let i = 0; i < n; i++) {
    const mid = now - winMs + i * step + step / 2;
    let s = -1;
    for (const sample of arr) { if (sample.t0 <= mid) s = sample.s; else break; }
    cells.push(s);
  }
  return cells;
}

// ---------- 总览仪表台：NAS 批量 HTTP 深度健康（一次 SSH 探全部 /api/health，pm2 online 但接口僵死可现形） ----------
async function nasHttpHealth() {
  if (nasHttpHealth.cache && Date.now() - nasHttpHealth.cache.t < 60 * 1000) return nasHttpHealth.cache.map;
  const targets = registry.projects.filter((p) => p.pm2Name && p.port);
  const cmd = targets.map((p) => `printf '${p.port} '; curl -s -o /dev/null -w '%{http_code}' -m 4 http://127.0.0.1:${p.port}/api/health; echo`).join('\n');
  try {
    const out = await sshExec(cmd, 35000);
    const map = {};
    out.split('\n').forEach((line) => { const m = line.match(/^(\d+)\s+(\d+)$/); if (m) map[m[1]] = m[2] === '200'; });
    if (targets.some((p) => map[p.port] !== undefined)) nasHttpHealth.cache = { t: Date.now(), map };
    return map;
  } catch (err) {
    return nasHttpHealth.cache ? nasHttpHealth.cache.map : {};
  }
}

// ---------- 活跃看板：一次 SSH 批量拉网关使用统计 + 各域 policy/回答表/名册（60s 缓存） ----------
let activityCache = null;

async function fetchActivity() {
  if (activityCache && Date.now() - activityCache.t < 60 * 1000) return activityCache.data;
  const probes = [
    ['usage1', `curl -s -m 6 'http://127.0.0.1:3010/api/usage?days=1'`],
    ['usage7', `curl -s -m 6 'http://127.0.0.1:3010/api/usage?days=7'`],
    ['gwHealth', `curl -s -m 6 http://127.0.0.1:3010/api/health`],
    ['hubPolicy', `curl -s -m 6 http://127.0.0.1:3000/api/hub/policy`],
    ['dutyPolicy', `curl -s -m 6 http://127.0.0.1:3006/api/duty/policy`],
    ['dutyRoster', `curl -s -m 10 http://127.0.0.1:3006/api/duty/roster`],
    ['dutyWl', `curl -s -m 6 http://127.0.0.1:3006/api/duty/whitelist`],
    ['appPolicy', `curl -s -m 6 http://127.0.0.1:3002/api/approval/policy`],
    ['ticketPolicy', `curl -s -m 6 http://127.0.0.1:3003/api/tickets/policy`],
    ['printPolicy', `curl -s -m 6 http://127.0.0.1:3001/api/print/policy`],
    ['rulesGroup', `curl -s -m 6 'http://127.0.0.1:3000/api/autoreplies/rules?table=group'`],
    ['rulesMention', `curl -s -m 6 'http://127.0.0.1:3000/api/autoreplies/rules?table=mention'`],
  ];
  const cmd = probes.map(([k, c]) => `printf '@@${k}@@'; ${c}; echo`).join('\n');
  try {
    const out = await sshExec(cmd, 40000);
    const data = {};
    const re = /@@(\w+)@@/g;
    const marks = [];
    let m;
    while ((m = re.exec(out))) marks.push({ key: m[1], jsonStart: re.lastIndex, markAt: m.index });
    for (let i = 0; i < marks.length; i++) {
      const chunk = out.slice(marks[i].jsonStart, i + 1 < marks.length ? marks[i + 1].markAt : undefined).trim();
      try { data[marks[i].key] = JSON.parse(chunk); } catch (err) { data[marks[i].key] = null; }
    }
    activityCache = { t: Date.now(), data };
    return data;
  } catch (err) {
    return activityCache ? activityCache.data : {};
  }
}

app.get('/api/activity', async (req, res) => {
  const data = await fetchActivity();
  res.json({ time: new Date().toISOString(), data });
});

const actionStats = { total: 0, last: null }; // 本次运维台开机以来的一次性动作执行计数

app.get('/api/overview', async (req, res) => {
  const nas = await nasStatus();
  const projects = [];
  for (const p of registry.projects) {
    const local = localProcs.get(p.id);
    const action = actionProcs.get(p.id);
    projects.push({
      ...p,
      git: p.repo ? gitInfo(p.repo === 'own' ? p.dir : '.') : null,
      nas: p.pm2Name ? nas.procs.find((x) => x.name === p.pm2Name) || null : null,
      localRunning: Boolean(local && local.child.exitCode === null),
      localHealth: local && local.child.exitCode === null ? await localHealth(p.port) : false,
      actionRunning: Boolean(action?.running),
      hasActionLog: Boolean(action),
    });
  }
  recordSamples(projects, nas);
  res.json({ time: new Date().toISOString(), nas, projects });
});

// 总览仪表台数据：状态矩阵 / 可用率 / 掉线事件 / 提交活跃 / 汇总指标
app.get('/api/stats', async (req, res) => {
  const nas = await nasStatus();
  const httpMap = await nasHttpHealth();
  const now = Date.now();
  const DAY = 24 * 3600 * 1000;

  const services = registry.projects.map((p) => {
    const nasProc = p.pm2Name ? nas.procs.find((x) => x.name === p.pm2Name) || null : null;
    const local = localProcs.get(p.id);
    const cur = currentState(p.id);
    return {
      id: p.id, name: p.name, label: p.label, port: p.port,
      hasPm2: Boolean(p.pm2Name),
      nasStatus: nasProc ? nasProc.status : null,
      localRunning: Boolean(local && local.child.exitCode === null),
      httpOk: p.pm2Name && nas.online ? (httpMap[p.port] ?? null) : null,
      memMb: nasProc ? nasProc.memMb : null,
      uptimeMs: nasProc ? nasProc.uptimeMs : 0,
      restarts: nasProc ? nasProc.restarts : null,
      avail24h: availability(p.id, DAY),
      current: cur,
      timeline: timeline(p.id),
    };
  });

  const nameOf = (id) => (registry.projects.find((p) => p.id === id) || {}).name || id;
  const events = registry.projects
    .flatMap((p) => offlineEpisodes(p.id, DAY))
    .map((e) => ({ ...e, name: nameOf(e.id) }))
    .sort((a, b) => b.start - a.start)
    .slice(0, 10);

  const avails = services.map((s) => s.avail24h).filter((v) => v != null);
  // 未提交改动按仓库去重：gateway/bambu/dashboard 同属顶层仓，逐项目累加会把同一仓的改动数三遍
  const seenRepos = new Set();
  let dirtyTotal = 0;
  for (const p of registry.projects) {
    if (!p.repo) continue;
    const cwdAbs = p.repo === 'own' ? path.join(ROOT, p.dir) : ROOT;
    if (seenRepos.has(cwdAbs)) continue;
    seenRepos.add(cwdAbs);
    const gi = gitInfo(p.repo === 'own' ? p.dir : '.');
    if (gi.inRepo) dirtyTotal += gi.dirty;
  }
  const summary = {
    nasOnline: nas.online,
    pm2Total: services.filter((s) => s.hasPm2).length,
    pm2Online: services.filter((s) => s.hasPm2 && s.nasStatus === 'online').length,
    httpProbed: services.filter((s) => s.httpOk != null).length,
    httpOkCount: services.filter((s) => s.httpOk === true).length,
    localRunning: services.filter((s) => s.localRunning).length,
    localRunnable: services.filter((s) => registry.projects.find((p) => p.id === s.id)?.localRun).length,
    avail24h: avails.length ? Math.round((avails.reduce((a, b) => a + b, 0) / avails.length) * 10) / 10 : null,
    dirtyTotal,
    actions: actionStats,
    samplingNote: '状态采样随运维台页面打开进行（约 25~30s 一针），历史落盘 .status-history.json 保留 3 天',
  };

  res.json({ time: new Date().toISOString(), summary, services, events });
});

app.get('/api/local/:id/log', (req, res) => {
  const p = localProcs.get(req.params.id);
  res.json({ log: p ? p.log.join('\n') : '(本地进程未启动)' });
});

app.post('/api/local/:id/start', (req, res) => res.json(startLocal(req.params.id)));
app.post('/api/local/:id/stop', (req, res) => res.json(stopLocal(req.params.id)));

// 快捷指令：{ actionId } 或 { cmd, args }
app.post('/api/action/:id', (req, res) => {
  const proj = registry.projects.find((p) => p.id === req.params.id);
  if (!proj) return res.status(404).json({ error: '未知项目' });
  const { actionId, cmd, args = [], cwd = '' } = req.body || {};
  let entry;
  if (actionId) {
    entry = (proj.quickActions || []).find((a) => a.id === actionId);
    if (actionId === 'push') entry = { cmd: 'npm', args: ['run', 'push'], cwd: proj.dir };
  } else if (cmd === 'push') {
    // push 快捷指令：npm run push "<提交说明>"（cwd 相对 proj.dir，默认项目根）
    entry = { cmd: 'npm', args: ['run', 'push', ...(req.body.message ? [String(req.body.message)] : [])], cwd: cwd || '' };
  }
  // 安全（2026-09-15 审查批）：不再接受客户端裸 {cmd,args} 直接 spawn——
  // 前端只用 actionId 与 cmd:'push'，裸执行面配合 DNS rebinding/CSRF 即成网页→本机 RCE 链
  if (!entry) return res.status(400).json({ error: '未知动作' });
  const cwdRel = path.join(proj.dir, entry.cwd || '');
  res.json(runAction(proj.id, entry.cmd, cwdRel, entry.args || []));
});

app.get('/api/action/:id/log', (req, res) => {
  const a = actionProcs.get(req.params.id);
  res.json({ running: Boolean(a?.running), cmd: a?.cmd || '', exitCode: a?.exitCode ?? null, log: a ? a.log.join('\n') : '(无动作记录)' });
});

// NAS：pm2 日志 / 重启
app.get('/api/nas/log/:name', async (req, res) => {
  const lines = Math.min(400, Number(req.query.lines) || 120);
  const name = String(req.params.name).replace(/[^a-zA-Z0-9_-]/g, '');
  try {
    const out = await sshExec(`tail -n ${lines} ~/.pm2/logs/${name}-out.log 2>/dev/null; echo '--- error ---'; tail -n 40 ~/.pm2/logs/${name}-error.log 2>/dev/null`);
    res.json({ log: out || '(无日志)' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/nas/restart/:name', async (req, res) => {
  const name = String(req.params.name).replace(/[^a-zA-Z0-9_-]/g, '');
  try {
    const out = await sshExec(`pm2 restart ${name} --update-env && pm2 save`, 30000);
    nasStatus.cache = null;
    res.json({ ok: true, out: out.slice(-400) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- 定制中心：窗口清单 + NAS 本机服务 HTTP 代理（SSH curl，仅本机可用） ----------

// 各项目已登记的定制窗口（registry.js 的 windows 字段）
app.get('/api/windows', (req, res) => {
  res.json(registry.projects
    .filter((p) => (p.windows || []).length)
    .map((p) => ({ id: p.id, name: p.name, label: p.label, port: p.port, windows: p.windows })));
});

// 代理到 NAS 本机端口的窗口接口：{ port, method:'GET'|'POST', path, body? }
app.post('/api/nas/api', async (req, res) => {
  const port = Number(req.body?.port);
  const method = String(req.body?.method || 'GET').toUpperCase();
  const apiPath = String(req.body?.path || '/');
  if (!Number.isInteger(port) || port < 1 || port > 65535) return res.status(400).json({ error: '端口非法' });
  if (!['GET', 'POST'].includes(method)) return res.status(400).json({ error: '仅支持 GET/POST' });
  if (!apiPath.startsWith('/') || /[\s'"`\\]/.test(apiPath)) return res.status(400).json({ error: '路径非法' });
  const shQuote = (s) => `'` + String(s).replace(/'/g, `'\\''`) + `'`;
  // 名册通讯录同步等慢窗口需要较长超时（实测 ~6s，放宽到 30s）
  let cmd = `curl -s -m 30 -X ${method} -H 'Content-Type: application/json'`;
  if (method === 'POST') {
    cmd += ` -d ${shQuote(JSON.stringify(req.body?.body ?? {}))}`;
    // 管理端点鉴权（2026-09-13）：POST 自动附共享 X-API-Token（凭据直读 approval-bot/.env）
    const apiToken = (readNasConfig() || {}).apiToken || '';
    if (apiToken) cmd += ` -H ` + shQuote(`X-API-Token: ${apiToken}`);
  }
  cmd += ` ` + shQuote(`http://localhost:${port}${apiPath}`);
  try {
    const out = await sshExec(cmd, 45000);
    try { res.json(JSON.parse(out)); } catch { res.json({ raw: out.slice(0, 2000) }); }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- 网络拓扑看板：全网连通性探测（本机视角，只读） ----------

const net = require('net');
const os = require('os');

// 拓扑节点定义：kind = cloud(云端依赖) / net(网关) / host(本地设备)
const NET_TARGETS = [
  { id: 'internet', name: '互联网', kind: 'cloud', host: '223.5.5.5', ports: [443] },
  { id: 'feishu', name: '飞书云(API/长连接)', kind: 'cloud', host: 'open.feishu.cn', ports: [443] },
  { id: 'router', name: '主路由', kind: 'net', host: '192.168.31.1', ports: [80] },
  { id: 'pc', name: '小电脑(生产)', kind: 'host', host: '192.168.31.57', ports: [22, 3010, 3000, 3001, 3002, 3003, 3006] }, // 3007 回环专用，LAN 探测恒 ✗ 不列
  { id: 'oldnas', name: '旧NAS(备件存储)', kind: 'host', host: '192.168.31.151', ports: [2222, 3923] },
];

function tcpProbe(host, port, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const s = net.connect({ host, port, timeout: timeoutMs });
    const done = (ok) => { s.removeAllListeners(); s.destroy(); resolve(ok ? Date.now() - t0 : null); };
    s.on('connect', () => done(true));
    s.on('timeout', () => done(false));
    s.on('error', () => done(false));
  });
}

let egressCache = { ip: null, at: 0 };
async function getEgressIp() {
  if (egressCache.ip && Date.now() - egressCache.at < 300000) return egressCache.ip;
  for (const url of ['https://api.ipify.org?format=json', 'https://myip.ipip.net']) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      const text = await res.text();
      const m = text.match(/(\d+\.\d+\.\d+\.\d+)/);
      if (m) { egressCache = { ip: m[1], at: Date.now() }; return m[1]; }
    } catch (err) { /* 换下一个源 */ }
  }
  return null;
}

// 出口 IP（应用安全设置里的 IP 白名单排查用的就是它）
app.get('/api/egress-ip', async (req, res) => {
  res.json({ ip: await getEgressIp() });
});

// 全网拓扑探测：所有节点并行 TCP 探测，单连接 2.5s 超时封顶
// ---------- LAN 设备发现（2026-09-16）：路由器实际在线设备 ----------
// 原理：ping 扫本机所在 /24 填充 ARP 缓存 → 解析 `arp -a` → 已知设备(拓扑定义)合并标注。
// 无需路由器凭据；本机不在家庭网段时返回 offsite（前端显示提示而非空列表）。
const LAN_SCAN = { cache: null, at: 0, running: null };
const LAN_KNOWN = {
  '192.168.31.1': '主路由',
  '192.168.31.57': '小电脑(生产)',
  '192.168.31.151': '旧NAS(备件)',
};
const LAN_OUI = [
  ['f0:b4:29', 'TP-Link'], ['64:09:80', '小米'], ['28:6c:07', '小米'], ['78:11:dc', '小米'],
  ['3c:22:fb', 'Apple'], ['f0:18:98', 'Apple'], ['ac:de:48', 'Apple'], ['a4:83:e7', 'Apple'],
  ['34:6b:d3', '华为'], ['00:46:4b', '华为'], ['84:3a:4b', 'Intel'], ['a0:36:9f', 'Intel'],
  ['24:0a:c4', 'ESP32/IoT'], ['5c:cf:7f', 'ESP32/IoT'],
];
function lanLocalIp() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal && ni.address.startsWith('192.168.31.')) return ni.address;
    }
  }
  return null;
}
function lanPingOne(ip) {
  return new Promise((resolve) => {
    const p = spawn('ping', ['-n', '1', '-w', '400', ip], { windowsHide: true });
    const t = setTimeout(() => { try { p.kill(); } catch {} resolve(); }, 700);
    p.on('close', () => { clearTimeout(t); resolve(); });
    p.on('error', () => { clearTimeout(t); resolve(); });
  });
}
async function lanScan() {
  const me = lanLocalIp();
  if (!me) {
    return { offsite: true, subnet: null, devices: [], scannedAt: new Date().toISOString() };
  }
  const base = me.split('.').slice(0, 3).join('.');
  const ips = [];
  for (let i = 1; i <= 254; i++) ips.push(base + '.' + i);
  for (let i = 0; i < ips.length; i += 64) {
    await Promise.all(ips.slice(i, i + 64).map(lanPingOne));
  }
  const arp = execFileSync('arp', ['-a'], { encoding: 'utf8', windowsHide: true });
  const re = new RegExp('^\\s*(' + base + '\\.(\\d{1,3}))\\s+([0-9a-fA-F:-]{17})\\s', 'm');
  const seen = new Map();
  for (const line of arp.split(/\r?\n/)) {
    const m = re.exec(line);
    if (!m) continue;
    const ip = m[1], last = Number(m[2]);
    const mac = m[3].toLowerCase().replace(/-/g, ':');
    if (last === 0 || last === 255 || (last >= 224 && last < 240)) continue;
    if (seen.has(ip)) continue;
    let vendor = '';
    for (const [pfx, name] of LAN_OUI) {
      if (mac.startsWith(pfx)) { vendor = name; break; }
    }
    const known = LAN_KNOWN[ip] || null;
    seen.set(ip, {
      ip, mac, vendor,
      name: known || (vendor ? vendor + ' 设备' : '未识别设备'),
      known: Boolean(known), me: ip === me,
    });
  }
  const devices = [...seen.values()].sort((a, b) => Number(a.ip.split('.')[3]) - Number(b.ip.split('.')[3]));
  return { offsite: false, subnet: base + '.0/24', devices, scannedAt: new Date().toISOString() };
}
app.get('/api/network/lan', async (req, res) => {
  if (LAN_SCAN.cache && Date.now() - LAN_SCAN.at < 60000) return res.json(LAN_SCAN.cache);
  if (!LAN_SCAN.running) {
    LAN_SCAN.running = lanScan()
      .then((r) => { LAN_SCAN.cache = r; LAN_SCAN.at = Date.now(); })
      .catch((e) => { LAN_SCAN.cache = { offsite: false, error: e.message, devices: [], scannedAt: new Date().toISOString() }; LAN_SCAN.at = Date.now(); })
      .finally(() => { LAN_SCAN.running = null; });
  }
  await LAN_SCAN.running;
  res.json(LAN_SCAN.cache);
});

app.get('/api/network', async (req, res) => {
  const t0 = Date.now();
  const probes = [];
  for (const t of NET_TARGETS) {
    for (const p of t.ports) {
      probes.push(tcpProbe(t.host, p).then((latency) => ({ id: t.id, port: p, ok: latency !== null, latency })));
    }
  }
  const results = await Promise.all(probes);
  const nodes = NET_TARGETS.map((t) => {
    const ports = results.filter((r) => r.id === t.id).map((r) => ({ port: r.port, ok: r.ok, latencyMs: r.latency }));
    const okPorts = ports.filter((x) => x.ok);
    return {
      id: t.id, name: t.name, kind: t.kind, host: t.host,
      up: okPorts.length > 0,
      latencyMs: okPorts.length ? Math.min(...okPorts.map((x) => x.latencyMs)) : null,
      ports,
    };
  });
  const egressIp = await getEgressIp();
  res.json({ time: new Date().toISOString(), egressIp, nodes, probeMs: Date.now() - t0 });
});

// 运维台是常驻本机工具：未捕获异常只记日志不退出（避免静默挂掉）
process.on('uncaughtException', (err) => console.error('[未捕获异常]', err));
process.on('unhandledRejection', (err) => console.error('[未处理Promise拒绝]', err));

app.listen(PORT, '127.0.0.1', () => {
  console.log(`🌊 曼波大模型（本地运维台）: http://127.0.0.1:${PORT}（仅本机可访问）`);
  console.log(`📁 工作区根: ${ROOT}`);
  console.log(`📡 注册项目: ${registry.projects.map((p) => `${p.name}:${p.port}`).join(', ')}`);
  console.log(`📊 总览仪表台: /api/stats（状态采样史落盘 ${path.basename(HISTORY_FILE)}，保留 3 天）`);
});

// ---------- R14 服务看门狗（2026-09-15）：逐时巡检生产机各服务 health，异常/恢复推群 webhook ----------
// - 巡检对象=registry.js 全部 pm2 项目（单一事实来源），SSH 到目标机逐端口 curl /api/health；
// - 连续 2 轮异常才告警（校园网会话被踢秒级自愈是常态，单轮抖动不值得吵人）；恢复也通告；
// - 告警通道=duty-bot 群机器人 webhook（.env 可用 WATCHDOG_WEBHOOK_URL 覆盖）；
// - 告警过晚间静默闸门（02:00–09:00 静默，窗口后首个巡检点补发）；持续异常 12h 重提醒一次。
const WATCHDOG = {
  timer: null,
  state: new Map(),     // key -> { degraded, since, lastAlertAt, pending }
  lastRun: null,
  results: [],
};
const WATCH_REALERT_MS = 12 * 3600 * 1000;
function watchdogWebhook() {
  try {
    const override = (process.env.WATCHDOG_WEBHOOK_URL || '').trim();
    if (override) return override;
    const text = fs.readFileSync(path.join(ROOT, 'duty-bot', '.env'), 'utf-8');
    return ((text.match(/^DUTY_BOARD_WEBHOOK_URL=(.*)$/m) || [])[1] || '').trim();
  } catch { return ''; }
}
function watchdogInQuietHours(now = Date.now()) {
  // 上海时间 = UTC+8 恒定偏移；默认窗口 [23:00, 09:00)（跨午夜；比播报静默更宽——
  // 2026-09-16 00:41 教训：运维告警不该在成员群里半夜响）
  const parse = (v, dflt) => {
    const m = new RegExp('^(\\d{1,2}):(\\d{2})$').exec(String(v || ''));
    if (!m) return dflt;
    return Number(m[1]) * 60 + Number(m[2]);
  };
  const start = parse(process.env.WATCHDOG_QUIET_START, 23 * 60);
  const end = parse(process.env.WATCHDOG_QUIET_END, 9 * 60);
  const d = new Date(now + 8 * 3600 * 1000);
  const m = d.getUTCHours() * 60 + d.getUTCMinutes();
  if (start <= end) return m >= start && m < end;
  return m >= start || m < end;
}
async function watchdogSend(text) {
  const url = watchdogWebhook();
  if (!url) { console.warn('[看门狗] 未配置告警 webhook（duty-bot/.env 的 DUTY_BOARD_WEBHOOK_URL 或 WATCHDOG_WEBHOOK_URL），仅记录'); return false; }
  try {
    const res = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg_type: 'text', content: { text } }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json().catch(() => null);
    return !!(data && (data.code === 0 || data.StatusCode === 0));
  } catch (err) { console.error('[看门狗] 告警发送失败:', err.message); return false; }
}
async function watchdogCheck() {
  WATCHDOG.lastRun = new Date().toISOString();
  // 分层探测（2026-09-16 误报修正）：先探家庭网关——本机离站（连路由器都不通）时
  // SSH 必然失败，那不是「目标机挂了」而是「我看不见」，登记 offsite 不告警；
  // 路由器可达而目标不可达才是真故障，正常走 2 连击告警
  const routerUp = await tcpProbe('192.168.31.1', 80, 3000);
  if (!routerUp) {
    WATCHDOG.results = [{ key: 'host', name: '部署目标(SSH)', ok: false, detail: '本机不在家庭网络（离站），巡检挂起不告警', offsite: true }];
    return;
  }
  let out = '';
  try {
    const ports = registry.projects.filter((p) => p.pm2Name).map((p) => p.port);
    const list = ports.join(' ');
    out = await sshExec(`for p in ${list}; do printf "%s:" "$p"; curl -s -m 5 -o /dev/null -w "%{http_code}" http://localhost:$p/api/health 2>/dev/null; echo; done`, 30000);
  } catch (err) {
    // SSH 不可达：整机视角处理（部署目标失联/网络被踢）
    WATCHDOG.results = [{ key: 'host', name: '部署目标(SSH)', ok: false, detail: err.message }];
    watchdogEvaluate('host', '部署目标(SSH)', false, `SSH 不可达：${err.message}`);
    return;
  }
  const rows = [];
  for (const p of registry.projects.filter((x) => x.pm2Name)) {
    const m = new RegExp(`^${p.port}:(.*)$`, 'm').exec(out || '');
    const code = m ? m[1].trim() : '';
    const ok = code === '200';
    rows.push({ key: String(p.port), name: `${p.name}(:${p.port})`, ok, detail: code || '无响应' });
    watchdogEvaluate(String(p.port), `${p.name}(:${p.port})`, ok, code || 'curl 无响应');
  }
  WATCHDOG.results = rows;
}
function watchdogEvaluate(key, name, ok, detail) {
  const now = Date.now();
  const prev = WATCHDOG.state.get(key);
  if (ok) {
    if (prev && prev.degraded && !watchdogInQuietHours(now)) {
      watchdogSend(`✅ qianli 服务恢复：${name} 已恢复正常（${WATCHDOG.lastRun}）`);
    }
    WATCHDOG.state.set(key, { degraded: false, since: now, lastAlertAt: 0, pending: false });
    return;
  }
  if (!prev || !prev.degraded) {
    // 第 1 轮异常：只登记不告警——校园网会话被踢秒级自愈是常态，连续 2 轮（约 2h）才算真异常
    WATCHDOG.state.set(key, { degraded: true, since: now, lastAlertAt: 0, pending: false });
    return;
  }
  // 持续异常（第 2 轮起）：过静默闸门；12h 重提醒；静默窗口内标记 pending 窗口后补发
  const due = !prev.lastAlertAt || (now - prev.lastAlertAt >= WATCH_REALERT_MS);
  if (watchdogInQuietHours(now)) {
    WATCHDOG.state.set(key, { ...prev, pending: true });
    return;
  }
  if (due || prev.pending) {
    // 无论发送成败都记尝试时间：失败若不更新，due 恒真会每小时重复轰炸
    WATCHDOG.state.set(key, { ...prev, lastAlertAt: Date.now(), pending: false });
    watchdogSend(`⚠️ qianli 服务异常：${name} health 连续巡检失败（${detail}；自 ${new Date(prev.since).toLocaleString('zh-CN')} 起）。排查/重启走本地运维台或 pm2`).then((sent) => {
      if (sent) WATCHDOG.state.set(key, { ...prev, lastAlertAt: Date.now(), pending: false });
    });
  }
}
app.get('/api/watchdog', (req, res) => {
  res.json({
    lastRun: WATCHDOG.lastRun,
    intervalMin: 60,
    results: WATCHDOG.results,
    services: [...WATCHDOG.state.entries()].map(([k, v]) => ({ key: k, ...v })),
  });
});
WATCHDOG.timer = setInterval(() => { watchdogCheck().catch((e) => console.error('[看门狗] 巡检异常:', e.message)); }, 60 * 60 * 1000);
WATCHDOG.timer.unref();
setTimeout(() => { watchdogCheck().catch((e) => console.error('[看门狗] 首轮巡检异常:', e.message)); }, 90 * 1000); // 启动 90s 后首轮
