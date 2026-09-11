const express = require('express');
const { spawn } = require('child_process');
const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');
const registry = require('./registry');

// ============================================================
// qianli 本地运维台（仅 127.0.0.1，不部署 NAS）
// - 可视化：各机器人端口职能/权限/指令/监听 + 本地 git 更新状态 + NAS pm2 状态
// - 本地测试进程：start/stop/log（自动 QUIET_HOURS_DISABLED=1，手动触发不受静默限制）
// - 快捷指令：npm push / install / stub 测试（注册表 quickActions）
// - NAS：pm2 状态 / 日志 tail / 重启（走 SSH，凭据直读 approval-bot/.env）
// ============================================================

const ROOT = path.join(__dirname, '..');
const PORT = process.env.PORT || 3100;
const LOG_CAP = 600;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- NAS 连接配置：直读 approval-bot/.env（单一来源，不复制凭据） ----------
function readNasConfig() {
  try {
    const text = fs.readFileSync(path.join(ROOT, 'approval-bot', '.env'), 'utf-8');
    const get = (k) => (text.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1] || '';
    return { host: get('NAS_HOST').trim(), port: Number(get('NAS_PORT').trim() || 22), username: get('NAS_USER').trim(), password: get('NAS_PASSWORD').trim() };
  } catch (err) {
    return null;
  }
}

function sshExec(cmd, timeoutMs = 15000) {
  const cfg = readNasConfig();
  if (!cfg || !cfg.host || !cfg.password) return Promise.reject(new Error('未读到 NAS 配置（approval-bot/.env 的 NAS_*）'));
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
  const child = spawn(useShell ? `${cmd} ${args.map((a) => `"${a}"`).join(' ')}` : cmd, args.length && !useShell ? args : [], {
    cwd, shell: useShell, env: { ...process.env },
  });
  child.stdout.on('data', (d) => { entry.log.push(...d.toString().split(/\r?\n/).filter(Boolean)); if (entry.log.length > LOG_CAP * 4) entry.log.splice(0, entry.log.length - LOG_CAP * 4); });
  child.stderr.on('data', (d) => { entry.log.push(...d.toString().split(/\r?\n/).filter(Boolean).map((l) => `[err] ${l}`)); if (entry.log.length > LOG_CAP * 4) entry.log.splice(0, entry.log.length - LOG_CAP * 4); });
  child.on('error', (err) => { entry.running = false; entry.exitCode = -1; entry.log.push(`[spawn错误] ${err.message}（cwd: ${cwd}）`); });
  child.on('exit', (code) => { entry.running = false; entry.exitCode = code; entry.log.push(`[结束] code=${code}`); });
  return { ok: true };
}

// ---------- 概览 ----------
const gitCache = new Map(); // dir -> { t, data }

function gitInfo(dir) {
  const abs = path.join(ROOT, dir);
  const cached = gitCache.get(abs);
  if (cached && Date.now() - cached.t < 30 * 1000) return cached.data;
  const run = (args) => {
    try {
      return require('child_process').execSync(`git ${args}`, { cwd: abs, encoding: 'utf-8', timeout: 8000 }).trim();
    } catch (err) { return ''; }
  };
  const data = {
    inRepo: !!run('rev-parse --is-inside-work-tree'),
    branch: run('rev-parse --abbrev-ref HEAD') || '-',
    lastCommit: (() => { const l = run('log -1 --format=%h|%s|%ci'); const [h, s, d] = l.split('|'); return { hash: h || '-', subject: s || '-', date: d || '' }; })(),
    dirty: run('status --porcelain').split('\n').filter(Boolean).length,
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
  res.json({ time: new Date().toISOString(), nas, projects });
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
  } else if (cmd) {
    entry = { cmd, args, cwd };
  }
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
  let cmd = `curl -s -m 12 -X ${method} -H 'Content-Type: application/json'`;
  if (method === 'POST') cmd += ` -d ${shQuote(JSON.stringify(req.body?.body ?? {}))}`;
  cmd += ` http://localhost:${port}${apiPath}`;
  try {
    const out = await sshExec(cmd, 20000);
    try { res.json(JSON.parse(out)); } catch { res.json({ raw: out.slice(0, 2000) }); }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`🖥️  qianli 运维台: http://127.0.0.1:${PORT}（仅本机可访问）`);
  console.log(`📁 工作区根: ${ROOT}`);
  console.log(`📡 注册项目: ${registry.projects.map((p) => `${p.name}:${p.port}`).join(', ')}`);
});
