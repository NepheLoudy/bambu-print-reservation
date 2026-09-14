// ============================================================
// 周播调度 + 补发（watchdog）
//
// - 定时：node-cron 按 ATTENDANCE_BROADCAST_CRON（默认周一 09:30 上海时间）播上一周；
// - 补发：每小时整点对表——若已过本周发送时刻而水位(lastSentWeekKey)没跟上，
//   说明发送时段进程不在线（重启/宕机），立即补发该周。补发同时天然承担
//   失败重试（拉数/发送失败不改水位，下个整点自动再试），无需独立重试队列。
// - 静默口径：本服务是单次周播，默认发送时刻 09:30 落在晚间静默窗口
//   （02:00–09:00）之外，不引入积压机制；改 cron 时请保持白天发送（README 有说明）。
// - 首启保护：水位为空（从未成功播报过）不补发，避免部署即广播；
//   可用 POST /api/attendance/test-broadcast 手动触发验证。
// ============================================================
const cron = require('node-cron');
const config = require('./config');
const report = require('./report');
const store = require('./store');
const wecom = require('./wecom');

let cronTask = null;
let watchdogTask = null;
let running = false;

async function runWeekly({ offset = 0, dryRun = false, trigger = 'cron' } = {}) {
  const members = store.loadMembers();
  if (!members.length) {
    throw new Error('成员名单为空（config/members.json）：先用 POST /api/attendance/members 添加，或放好种子文件重启');
  }
  const win = report.weekWindow(offset, Date.now(), config.cronParts.dow == null ? 1 : config.cronParts.dow);
  const records = await wecom.getCheckinData(win.start / 1000, win.end / 1000, members.map((m) => m.userid));
  const aggregated = report.aggregate(records, members);
  const markdown = report.renderMarkdownV2(win, aggregated);
  const csv = report.renderCsv(win, aggregated);
  const filename = `考勤明细_${win.label.replace(/ ~ /g, '_')}.csv`;

  if (dryRun) {
    return { window: win, markdown, csv, filename, sent: false, totals: aggregated.totals };
  }

  // 先发 CSV 附件再发正文，群里附件紧跟在卡片上方，阅读顺序自然
  await wecom.sendFile(Buffer.from(csv, 'utf8'), filename);
  await wecom.sendMarkdownV2(markdown);

  const state = store.loadState();
  state.lastSentWeekKey = win.key;
  state.lastSentAt = new Date().toISOString();
  state.lastError = null;
  store.saveState(state);
  console.log(`[${trigger}] 周报已播报: ${win.label}（${aggregated.totals.punches} 条记录 / ${aggregated.totals.exceptions} 条异常）`);
  return { window: win, markdown, csv, filename, sent: true, totals: aggregated.totals };
}

// 失败告警：拉数挂了 webhook 仍可用（它不走可信 IP），把原因喊到同一个负责人群
async function alertFailure(err, win) {
  const state = store.loadState();
  if (state.lastError && state.lastError.weekKey === win.key) return; // 同一周只喊一次，watchdog 会静默重试
  store.saveState({ ...state, lastError: { weekKey: win.key, at: new Date().toISOString(), message: String(err.message), errcode: err.errcode == null ? null : String(err.errcode) } });
  const hint = err.hint ? `\n> 处理提示：${err.hint}` : '';
  const content = `## ⚠ 考勤周报发送失败\n> 窗口：${win.label}\n> 原因：${err.message}${hint}\n> 每小时自动重试，成功后补发本周报`;
  try {
    await wecom.sendMarkdownV2(content);
  } catch (e) {
    console.error('失败告警也发不出去（webhook 配置检查）:', e.message);
  }
}

async function guardedRun(opts) {
  if (running) return { skipped: true, reason: '上一轮还在跑' };
  running = true;
  try {
    return await runWeekly(opts);
  } catch (err) {
    console.error(`[考勤] 播报失败:`, err.message, err.hint || '');
    const win = report.weekWindow(opts.offset || 0, Date.now(), config.cronParts.dow == null ? 1 : config.cronParts.dow);
    if (!opts.dryRun) await alertFailure(err, win);
    throw err;
  } finally {
    running = false;
  }
}

// 补发判定：已过发送时刻 && 水位落后 && 水位非空（首启保护）
function catchupNeeded(nowMs = Date.now()) {
  const state = store.loadState();
  if (!state.lastSentWeekKey) return null; // 首启：等下一个 cron 周期
  const { dow } = config.cronParts;
  const sendDow = dow == null ? 1 : dow;
  if (!report.isPastSendTime(nowMs, sendDow, config.cronParts.hour, config.cronParts.minute)) return null;
  const win = report.weekWindow(0, nowMs, sendDow);
  if (state.lastSentWeekKey === win.key) return null;
  return win;
}

function nextRunLabel(task) {
  try {
    const nd = task.nextDates();
    const d = typeof nd.toJSDate === 'function' ? nd.toJSDate() : new Date(nd);
    return d.toISOString();
  } catch {
    return '(见 cron 表达式)';
  }
}

function start(onRun) {
  if (!cron.validate(config.cron)) {
    throw new Error(`ATTENDANCE_BROADCAST_CRON 非法: ${config.cron}`);
  }
  cronTask = cron.schedule(config.cron, () => {
    onRun({ trigger: 'cron' }).catch(() => {}); // 失败已在 guardedRun 内告警
  }, { timezone: config.timezone });

  watchdogTask = cron.schedule('5 * * * *', () => {
    const win = catchupNeeded();
    if (win) {
      console.log(`[watchdog] 发现漏播（水位落后于 ${win.key}），补发`);
      onRun({ trigger: 'watchdog' }).catch(() => {});
    }
  }, { timezone: config.timezone });

  console.log(`[考勤] 定时播报已排：cron="${config.cron}" tz=${config.timezone} 下次≈${nextRunLabel(cronTask)}`);
  console.log(`[考勤] 补发看门狗：每小时 5 分对表，漏播/失败自动补`);
}

function stop() {
  if (cronTask) cronTask.stop();
  if (watchdogTask) watchdogTask.stop();
}

module.exports = { start, stop, runWeekly, guardedRun, catchupNeeded };
