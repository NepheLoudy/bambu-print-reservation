// ============================================================
// 周播调度 + 补发（watchdog）
//
// - 定时：node-cron 按 ATTENDANCE_BROADCAST_CRON（默认周一 09:30 上海时间）播上一周；
// - 补发：每小时整点对表——若已过本周发送时刻而水位(lastSentWeekKey)没跟上，
//   说明发送时段进程不在线（重启/宕机），立即补发该周。补发同时天然承担
//   失败重试（拉数/发送失败不改水位，下个整点自动再试），无需独立重试队列。
// - 静默口径：周播 cron 默认发送时刻 09:30 在晚间静默窗口（02:00–09:00）之外；
//   补发看门狗与失败告警属自动播报，命中静默窗口整轮跳过（utils/quietHours），
//   窗口后下一个整点 tick 按最新状态重查补发/告警——本任务是可重扫型，无需积压落盘。
// - 首启保护：水位为空（从未成功播报过）不补发，避免部署即广播；
//   可用 POST /api/attendance/test-broadcast 手动触发验证。
// ============================================================
const cron = require('node-cron');
const config = require('./config');
const report = require('./report');
const store = require('./store');
const wecom = require('./wecom');
const feishu = require('./feishu');
const quietHours = require('./utils/quietHours');
const importService = require('./importService');

let cronTask = null;
let watchdogTask = null;
let running = false;

function sendDowOrDefault() {
  return config.cronParts.dow == null ? 1 : config.cronParts.dow;
}

async function runWeekly({ offset = 0, dryRun = false, trigger = 'cron' } = {}) {
  // 通道门控（v2 飞书通道扩展）：企微群机器人 / 飞书群机器人至少配一个
  const channels = feishu.pickChannels(config);
  let members = store.loadMembers();
  const win = report.weekWindow(offset, Date.now(), sendDowOrDefault());
  let records;
  if (config.dataSource === 'import') {
    // 方案4（2026-09-16）：数据源=企微后台导出的打卡明细（可信IP门槛不可行，API 弃用）
    const st = store.loadState();
    const imported = (st.imported && st.imported.records) || [];
    if (!imported.length) {
      throw new Error('导入模式：尚无导入数据——企微后台导出打卡明细后 POST /api/attendance/import 上传');
    }
    records = importService.filterByWindow(imported, win);
    if (!records.length) {
      throw new Error(`导入模式：已导入数据不覆盖本播报窗口 ${win.label}（导入于 ${(st.imported.importedAt || '').slice(0, 10)}，覆盖 ${st.imported.days || '?'}）`);
    }
    members = importService.mergeMembers(members, importService.deriveMembers(records));
  } else {
    if (!members.length) {
      throw new Error('成员名单为空（config/members.json）：先用 POST /api/attendance/members 添加，或放好种子文件重启');
    }
    records = await wecom.getCheckinData(win.start / 1000, win.end / 1000, members.map((m) => m.userid));
  }
  const aggregated = report.aggregate(records, members);
  const markdown = report.renderMarkdownV2(win, aggregated);
  const csv = report.renderCsv(win, aggregated);
  const filename = `考勤明细_${win.label.replace(/ ~ /g, '_')}.csv`;

  if (dryRun) {
    return { window: win, markdown, csv, filename, sent: false, totals: aggregated.totals };
  }

  // 每通道独立水位（duty「重试只补失败群」模式）：重试只补未送达通道，不重复轰炸已收到的群
  const state = store.loadState();
  const done = state.delivery && state.delivery.weekKey === win.key ? state.delivery : { weekKey: win.key };
  const failed = [];

  // ---- CSV 附件：尽力而为（独立水位，失败不阻断周报完成；完整 CSV 始终落盘 exports）----
  if (channels.wecom && !done.wecomCsv) {
    try {
      await wecom.sendFile(Buffer.from(csv, 'utf8'), filename);
      done.wecomCsv = true;
    } catch (e) {
      console.warn('[考勤] 企微 CSV 附件发送失败（不影响周报）:', e.message, e.hint || '');
    }
  }
  if (channels.feishu && !done.feishuCsv) {
    // 飞书 webhook 传不了文件：走现有应用 im API 发文件（需凭据 + 群 chat_id），没配只落盘
    if (config.feishuAppId && config.feishuAppSecret && config.feishuCsvChatId) {
      try {
        await feishu.sendCsvViaApp(Buffer.from(csv, 'utf8'), filename, config.feishuCsvChatId);
        done.feishuCsv = true;
      } catch (e) {
        console.warn('[考勤] 飞书 CSV（应用身份）发送失败（不影响周报）:', e.message, e.hint || '');
      }
    } else {
      console.warn('[考勤] CSV 未发飞书群（未配 FEISHU_APP_ID/SECRET + FEISHU_CSV_CHAT_ID），仅落盘 exports 目录');
    }
  }

  // ---- 周报卡：真实水位通道（企微 markdown_v2 / 飞书卡片）----
  if (channels.wecom && !done.wecom) {
    try {
      await wecom.sendMarkdownV2(markdown);
      done.wecom = true;
    } catch (e) {
      failed.push(`企微: ${e.message}${e.hint ? `（${e.hint}）` : ''}`);
    }
  }
  if (channels.feishu && !done.feishu) {
    try {
      await feishu.sendCardToWebhook(config.feishuWebhookUrl, config.feishuWebhookSecret, feishu.buildAttendanceCard(win, aggregated));
      done.feishu = true;
    } catch (e) {
      failed.push(`飞书: ${e.message}${e.hint ? `（${e.hint}）` : ''}`);
    }
  }

  const pending = (channels.wecom && !done.wecom) || (channels.feishu && !done.feishu);
  if (pending) {
    state.delivery = done;
    state.lastError = { weekKey: win.key, at: new Date().toISOString(), message: failed.join('；') };
    store.saveState(state);
    throw new Error(`部分通道发送失败: ${failed.join('；')}`);
  }

  state.lastSentWeekKey = win.key;
  state.lastSentAt = new Date().toISOString();
  state.lastError = null;
  state.delivery = done; // 保留本周期投递快照（下周期自动被新 weekKey 覆盖）
  store.saveState(state);
  console.log(`[${trigger}] 周报已播报: ${win.label}（${aggregated.totals.punches} 条记录 / ${aggregated.totals.exceptions} 条异常；通道 ${[channels.wecom && '企微', channels.feishu && '飞书'].filter(Boolean).join('+')}）`);
  return { window: win, markdown, csv, filename, sent: true, totals: aggregated.totals };
}

// 失败告警：向所有配置通道喊话（哪个通就发哪个，全挂则只落 lastError 供巡检）。
// 静默窗口内自动链路不喊（不记 lastError，窗口后重试自然再告警）；
// 人工当下主动触发（manual）不受静默限制。同一周只喊一次，watchdog 会静默重试。
async function alertFailure(err, win, { manual = false } = {}) {
  if (!manual && quietHours.inQuietHours()) {
    console.log('[考勤] 静默窗口内，失败告警顺延（窗口后自动重试再告警）');
    return;
  }
  const state = store.loadState();
  if (state.lastError && state.lastError.weekKey === win.key && state.alertedWeekKey === win.key) return;
  store.saveState({ ...state, alertedWeekKey: win.key });
  const hint = err.hint ? `\n> 处理提示：${err.hint}` : '';
  if (config.webhookKey) {
    try {
      await wecom.sendMarkdownV2(`## ⚠ 考勤周报发送失败\n> 窗口：${win.label}\n> 原因：${err.message}${hint}\n> 每小时自动重试，成功后补发本周报`);
    } catch (e) {
      console.error('企微告警也发不出去:', e.message, e.hint || '');
    }
  }
  if (config.feishuWebhookUrl) {
    try {
      await feishu.sendCardToWebhook(config.feishuWebhookUrl, config.feishuWebhookSecret, {
        config: { wide_screen_mode: true },
        header: { template: 'red', title: { content: '⚠ 考勤周报发送失败', tag: 'plain_text' } },
        elements: [{ tag: 'markdown', content: `**窗口：**${win.label}\n**原因：**${err.message}${err.hint ? `\n**处理提示：**${err.hint}` : ''}\n每小时自动重试，成功后补发本周报` }],
      });
    } catch (e) {
      console.error('飞书告警也发不出去:', e.message, e.hint || '');
    }
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
    if (!opts.dryRun) await alertFailure(err, win, { manual: opts.trigger === 'manual' });
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

function start(onRun) {
  if (!cron.validate(config.cron)) {
    throw new Error(`ATTENDANCE_BROADCAST_CRON 非法: ${config.cron}`);
  }
  cronTask = cron.schedule(config.cron, () => {
    onRun({ trigger: 'cron' }).catch(() => {}); // 失败已在 guardedRun 内告警
  }, { timezone: config.timezone });

  watchdogTask = cron.schedule('5 * * * *', () => {
    // 晚间静默（02:00–0900 窗口见 utils/quietHours）：整轮跳过，窗口后首个 tick 按最新状态补
    if (quietHours.inQuietHours()) {
      console.log('[watchdog] 静默窗口内，本轮对表跳过');
      return;
    }
    const win = catchupNeeded();
    if (win) {
      console.log(`[watchdog] 发现漏播（水位落后于 ${win.key}），补发`);
      onRun({ trigger: 'watchdog' }).catch(() => {});
    }
  }, { timezone: config.timezone });

  // node-cron 3.x 不暴露 nextDates，用自算的下次发送时刻展示（仅标准周播形态可算）
  const { dow, hour, minute, parsed } = config.cronParts;
  const nextLabel = parsed && dow != null
    ? `上海时间 ${report.fmtTime(report.nextSendTime(Date.now(), dow, hour, minute))}`
    : '(非标准周播形态，以 cron 表达式为准)';
  console.log(`[考勤] 定时播报已排：cron="${config.cron}" tz=${config.timezone} 下次=${nextLabel}`);
  console.log(`[考勤] 补发看门狗：每小时 5 分对表，漏播/失败自动补`);
}

function stop() {
  if (cronTask) cronTask.stop();
  if (watchdogTask) watchdogTask.stop();
}

module.exports = { start, stop, runWeekly, guardedRun, catchupNeeded };
