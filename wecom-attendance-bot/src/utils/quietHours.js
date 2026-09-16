// ============================================================
// 晚间静默（各仓通用闸门的本仓实现，口径见顶层 AGENTS「晚间静默」）
//
// 02:00–09:00（Asia/Shanghai，[START, END) 可配 QUIET_HOURS_START/END，
// QUIET_HOURS_DISABLED=1 关闭）窗口内不直接向群内发送：
// - 周播 cron 本体同样过闸（命中窗口整轮跳过，窗口后的整点 watchdog tick 天然按
//   最新状态补跑；默认发送时刻 09:30 在窗外不受影响）；
// - 补发看门狗/失败告警是自动播报，命中窗口整轮跳过
//   （本任务是可重扫型，无需积压落盘）。
//
// QUIET_HOURS_START/END 写法兼容（duty-bot 同名键认纯小时数字，跨仓同值须同义）：
//   - 纯数字 = 小时整点（"2" = 02:00）；小数小时（"2.5"）floor 到整点；
//   - HH:mm（"22:30"）：分钟 floor 到整点并 console.warn（按 22:00 生效，跨仓口径对齐）；
//   - 解析失败/越界 console.warn 并回退默认。
//
// 时区口径与 report.js 一致：上海时间 = UTC+8 恒定偏移。
// ============================================================

const SHANGHAI_OFFSET_MS = 8 * 3600 * 1000;

function fmtMin(n) {
  return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
}

function parseBoundary(v, dflt, name) {
  const raw = String(v == null ? '' : v).trim();
  if (!raw) return dflt;
  const num = /^\d+(\.\d+)?$/.exec(raw);          // 纯数字 = 小时（duty-bot 口径）
  const hhmm = /^(\d{1,2}):(\d{1,2})$/.exec(raw); // HH:mm
  if (!num && !hhmm) {
    console.warn(`[静默] ${name}="${raw}" 无法解析（应为 HH:mm 或小时数字），回退默认 ${fmtMin(dflt)}`);
    return dflt;
  }
  const h = num ? Math.floor(Number(num[0])) : Number(hhmm[1]);
  const min = hhmm ? Number(hhmm[2]) : 0;
  if (h > 23 || min > 59) {
    console.warn(`[静默] ${name}="${raw}" 越界（小时 0-23、分钟 0-59），回退默认 ${fmtMin(dflt)}`);
    return dflt;
  }
  if ((num && Number(num[0]) % 1 !== 0) || (hhmm && min !== 0)) {
    console.warn(`[静默] ${name}="${raw}" 非整点，按小时粒度取整点 ${fmtMin(h * 60)} 生效（与 duty-bot 同名键口径对齐）`);
  }
  return h * 60;
}

const enabled = process.env.QUIET_HOURS_DISABLED !== '1';
const startMin = parseBoundary(process.env.QUIET_HOURS_START, 2 * 60, 'QUIET_HOURS_START'); // 02:00
const endMin = parseBoundary(process.env.QUIET_HOURS_END, 9 * 60, 'QUIET_HOURS_END');       // 09:00

function windowLabel() {
  return `${fmtMin(startMin)}–${fmtMin(endMin)}`;
}

// 当前（真实毫秒）对应的上海当日分钟数
function shanghaiMinuteOfDay(ms = Date.now()) {
  const wall = ms + SHANGHAI_OFFSET_MS;
  const d = new Date(wall);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

function inQuietHours(ms = Date.now()) {
  if (!enabled) return false;
  const cur = shanghaiMinuteOfDay(ms);
  if (startMin <= endMin) return cur >= startMin && cur < endMin; // 同日窗口 [s, e)
  return cur >= startMin || cur < endMin;                          // 跨午夜窗口
}

function getStatus() {
  return {
    enabled,
    window: windowLabel(),
    inQuietHours: inQuietHours(),
  };
}

module.exports = { inQuietHours, getStatus };
