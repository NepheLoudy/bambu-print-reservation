const fs = require('fs');
const path = require('path');

// ============================================================
// 晚间静默（播报时段限制）
//
// 窗口 [QUIET_HOURS_START, QUIET_HOURS_END)（Asia/Shanghai，默认 02:00–09:00）
// 内，群播/私聊通知不直接发送，统一积压到 end 整点按入队顺序原样补发。
// 积压形态：payload（gatePayload）——一次性事件通知（排队/开始/完成/失败卡、
// 缺料提醒、预约审批提醒、审批结果通知）在积压时已构建完毕，落盘的是事件
// 发生时刻的快照，补发原样发出（「挤压要为挤压之后的事情负责」：打印机
// 控制、写表、队列匹配照常进行，只有消息延后；补发内容为事发快照，队列
// 实况以 /print 指令查询为准）。
//
// 不受限：对话/指令回复（chatService 回复 /print-* 指令）——交互回路。
//
// 积压持久化到项目根 .quiet-backlog.json：重启不丢。启动时已过 end 整点则
// 立即补冲刷，否则调度到 end 整点。冲刷失败的单条保留重试（至多 3 次尝试），
// 超限丢弃并打错误日志。
// ============================================================

const BACKLOG_FILE = path.join(__dirname, '..', '..', '.quiet-backlog.json');
const TZ_OFFSET_MS = 8 * 60 * 60 * 1000; // Asia/Shanghai 无夏令时，固定 UTC+8
const MAX_ATTEMPTS = 3;
const FLUSH_ROUNDS = 10;
const RETRY_DELAY_MS = 60 * 1000;

const settings = {
  enabled: process.env.QUIET_HOURS_DISABLED !== '1',
  start: clampHour(process.env.QUIET_HOURS_START, 2),
  end: clampHour(process.env.QUIET_HOURS_END, 9),
};

function clampHour(raw, fallback) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(23, Math.max(0, Math.trunc(n)));
}

/** 上海墙上时钟 parts（用加 8 小时后的 UTC 取值读） */
function shanghaiParts(now = new Date()) {
  const shifted = new Date(now.getTime() + TZ_OFFSET_MS);
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth(),
    d: shifted.getUTCDate(),
    minutesOfDay: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

function inQuietHours(now = new Date()) {
  if (!settings.enabled || settings.start === settings.end) return false;
  const m = shanghaiParts(now).minutesOfDay;
  const s = settings.start * 60;
  const e = settings.end * 60;
  // 支持跨午夜写法（start > end，如 23→6）
  return s < e ? (m >= s && m < e) : (m >= s || m < e);
}

/** 下一个 end 整点（上海）的绝对时间 */
function nextQuietEnd(now = new Date()) {
  const p = shanghaiParts(now);
  let target = Date.UTC(p.y, p.m, p.d, settings.end, 0, 0) - TZ_OFFSET_MS;
  if (target <= now.getTime()) target += 24 * 60 * 60 * 1000;
  return new Date(target);
}

function quietWindowDesc() {
  const fmt = (h) => `${String(h).padStart(2, '0')}:00`;
  return `${fmt(settings.start)}–${fmt(settings.end)}`;
}

/** 上海时区的 "YYYY-MM-DD HH:mm" 戳（cron 同槽位去重键用） */
function shanghaiStamp(now = new Date()) {
  const p = shanghaiParts(now);
  const shifted = new Date(now.getTime() + TZ_OFFSET_MS);
  const mm = String(shifted.getUTCMinutes()).padStart(2, '0');
  const hh = String(shifted.getUTCHours()).padStart(2, '0');
  return `${p.y}-${String(p.m + 1).padStart(2, '0')}-${String(p.d).padStart(2, '0')} ${hh}:${mm}`;
}

// ---------- 积压队列（持久化） ----------

const runners = new Map(); // task 名 -> async 执行器（冲刷时重跑整个任务函数）
const payloadHandlers = {
  // 群播卡片（排队/开始/完成/失败/缺料/预约通知等，发群机器人 webhook）
  'webhook-card': (card) => require('../feishu/bot').sendMessage(card),
  // 私聊文本（预约审批提醒、审批结果通知）
  'dm-text': (p) => require('../feishu/bot').sendTextToUser(p.openId, p.text),
};

let flushTimer = null;
let nextFlushAt = null;
let flushing = false;

function loadBacklog() {
  try {
    if (fs.existsSync(BACKLOG_FILE)) {
      const data = JSON.parse(fs.readFileSync(BACKLOG_FILE, 'utf-8'));
      return Array.isArray(data.items) ? data.items : [];
    }
  } catch (err) {
    console.warn('[晚间静默] 读取积压文件失败（按空处理）:', err.message);
  }
  return [];
}

function saveBacklog(items) {
  try {
    if (items.length === 0) {
      if (fs.existsSync(BACKLOG_FILE)) fs.unlinkSync(BACKLOG_FILE);
    } else {
      fs.writeFileSync(BACKLOG_FILE, JSON.stringify({ items }, null, 2));
    }
  } catch (err) {
    console.warn('[晚间静默] 写积压文件失败（仅影响重启恢复）:', err.message);
  }
}

function registerTask(name, fn) {
  runners.set(name, fn);
}

/**
 * 定时任务静默闸门：非静默直接执行；静默窗口内登记积压，冲刷时重跑整个 run。
 * @returns {Promise<{deferred: boolean}>} 实际结果或积压登记信息
 */
async function gateTask(name, fireKey, run, label = name) {
  if (!inQuietHours()) return run();

  const items = loadBacklog();
  if (items.some((it) => it.type === 'task' && it.name === name && it.fireKey === fireKey)) {
    console.log(`[晚间静默] ${label} 该槽位已积压，跳过重复登记`);
    return { deferred: true, note: '已积压' };
  }
  items.push({ type: 'task', name, fireKey, queuedAt: new Date().toISOString() });
  saveBacklog(items);
  scheduleFlushFromGate();
  console.log(`[晚间静默] ${label} 落入积压（共 ${items.length} 条），${nextQuietEnd().toLocaleString('zh-CN')} 统一补跑`);
  return { deferred: true };
}

/**
 * 一次性通知载荷闸门：非静默返回 false（调用方照常直接发送）；
 * 静默窗口内载荷落盘积压并返回 true（调用方跳过发送）。
 */
function gatePayload(name, payload, label = name) {
  if (!inQuietHours()) return false;
  const items = loadBacklog();
  items.push({ type: 'payload', name, payload, queuedAt: new Date().toISOString() });
  saveBacklog(items);
  scheduleFlushFromGate();
  console.log(`[晚间静默] ${label} 载荷落盘积压（共 ${items.length} 条），${nextQuietEnd().toLocaleString('zh-CN')} 统一补发`);
  return true;
}

async function runItem(item) {
  if (item.type === 'task') {
    const fn = runners.get(item.name);
    if (!fn) throw new Error(`任务「${item.name}」未注册冲刷执行器`);
    return fn();
  }
  const handler = payloadHandlers[item.name];
  if (!handler) throw new Error(`载荷「${item.name}」未注册补发处理器`);
  return handler(item.payload);
}

function describeItem(item) {
  if (item.type === 'task') return `${item.name}@${item.fireKey}`;
  return `${item.name}（${item.queuedAt}）`;
}

function scheduleFlush(delayMs) {
  if (flushTimer) clearTimeout(flushTimer);
  nextFlushAt = new Date(Date.now() + delayMs).toISOString();
  flushTimer = setTimeout(() => {
    flushTimer = null;
    nextFlushAt = null;
    runFlush().catch((err) => console.error('[晚间静默] 冲刷异常:', err.message));
  }, delayMs);
  if (flushTimer.unref) flushTimer.unref();
}

function scheduleFlushFromGate() {
  if (flushTimer) return; // 已有调度在等待，沿用
  scheduleFlush(Math.max(nextQuietEnd().getTime() - Date.now(), 1000));
}

async function runFlush() {
  if (flushing) return;
  flushing = true;
  try {
    for (let round = 0; round < FLUSH_ROUNDS; round++) {
      const items = loadBacklog();
      if (items.length === 0) return;

      console.log(`[晚间静默] 开始冲刷积压 ${items.length} 条...`);
      const remaining = [];
      for (const item of items) {
        try {
          await runItem(item);
          console.log(`[晚间静默] 积压补跑完成: ${describeItem(item)}`);
        } catch (err) {
          item.attempts = (item.attempts || 0) + 1;
          if (item.attempts >= MAX_ATTEMPTS) {
            console.error(`[晚间静默] 积压补跑连续 ${item.attempts} 次失败，放弃: ${describeItem(item)} — ${err.message}`);
          } else {
            remaining.push(item);
            console.error(`[晚间静默] 积压补跑失败（第 ${item.attempts} 次，保留重试）: ${describeItem(item)} — ${err.message}`);
          }
        }
      }
      saveBacklog(remaining);

      if (remaining.length > 0) {
        scheduleFlush(RETRY_DELAY_MS);
        return;
      }
      // 全部成功；冲刷期间新落进的积压由下一轮立刻处理
    }
    console.warn('[晚间静默] 冲刷轮次达上限，剩余积压留待下次调度');
  } finally {
    flushing = false;
  }
}

/** 启动时调用：有积压则按当前时点调度补冲刷（过点立即、未过点等到 end 整点） */
function initQuietHoursFlush() {
  const items = loadBacklog();
  if (!settings.enabled) {
    console.log('[晚间静默] 已通过 QUIET_HOURS_DISABLED=1 关闭');
    return;
  }
  if (items.length === 0) {
    console.log(`[晚间静默] 播报静默窗口 ${quietWindowDesc()}（Asia/Shanghai），当前无积压`);
    return;
  }
  if (inQuietHours() || shanghaiParts().minutesOfDay < settings.end * 60) {
    const end = nextQuietEnd();
    console.log(`[晚间静默] 启动时存在 ${items.length} 条积压，调度到 ${end.toLocaleString('zh-CN')} 补跑`);
    scheduleFlush(Math.max(end.getTime() - Date.now(), 1000));
  } else {
    console.log(`[晚间静默] 启动时存在 ${items.length} 条积压且已过补发时点，5 秒后立即补跑`);
    scheduleFlush(5000);
  }
}

function getStatus() {
  return {
    enabled: settings.enabled,
    window: quietWindowDesc(),
    inQuietHours: inQuietHours(),
    backlog: loadBacklog().length,
    nextFlushAt: nextFlushAt,
  };
}

module.exports = {
  inQuietHours,
  nextQuietEnd,
  quietWindowDesc,
  shanghaiStamp,
  gateTask,
  gatePayload,
  registerTask,
  initQuietHoursFlush,
  getStatus,
};
