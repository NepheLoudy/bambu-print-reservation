// ============================================================
// 晚间静默（各仓通用闸门的本仓实现，口径见顶层 AGENTS「晚间静默」）
//
// 02:00–09:00（Asia/Shanghai，[START, END) 可配 QUIET_HOURS_START/END，
// QUIET_HOURS_DISABLED=1 关闭）窗口内不直接向群内发送：
// - 周播 cron 本体（默认周一 09:30）在窗外，不受影响；
// - 补发看门狗/失败告警是自动播报，命中窗口整轮跳过，窗口后的下一个
//   整点 tick 天然按最新状态重查补发（本任务是可重扫型，无需积压落盘）。
//
// 时区口径与 report.js 一致：上海时间 = UTC+8 恒定偏移。
// ============================================================

const SHANGHAI_OFFSET_MS = 8 * 3600 * 1000;

function parseHHmm(v, dflt) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v || '').trim());
  if (!m) return dflt;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return dflt;
  return h * 60 + min;
}

const enabled = process.env.QUIET_HOURS_DISABLED !== '1';
const startMin = parseHHmm(process.env.QUIET_HOURS_START, 2 * 60);   // 02:00
const endMin = parseHHmm(process.env.QUIET_HOURS_END, 9 * 60);       // 09:00

function windowLabel() {
  const p = (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
  return `${p(startMin)}–${p(endMin)}`;
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
