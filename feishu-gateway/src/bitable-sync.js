const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const usage = require('./usage');
const bitable = require('./bitable');

// ============================================================
// 网关活跃 → 「机器人项目看板」多维表格同步（动态广场看板数据源）
// - 口径=机器人交互（显式路由命中/私聊/@机器人，见 dispatch.recordUsage）；
//   每 30 分钟把有变化的日桶 upsert 到「网关日活跃」单表
//   （日期签名去重：桶数据没变不写；签名状态落 GATEWAY_DATA_DIR，重启不重写）
// - 「网关功能使用/网关队员活跃」两表已下线（2026-09-13 用户拍板：监听只留
//   机器人交互强相关，分功能/分队员明细不再落表；建表脚本同步移除）
// - upsert 匹配为内存全量比对：records/search 的过滤对 Date 字段不可用
//   （实测所有 operator 均 InvalidFilter），故整表拉回后按字段值匹配
// - 只观察不影响转发：任何失败 console.warn 后保留签名待下轮重试
// ============================================================

const APP_TOKEN = process.env.PLAZA_BITABLE_APP_TOKEN || '';
const TABLES = {
  daily: process.env.PLAZA_BITABLE_DAILY_TABLE || '',
};
const SYNC_INTERVAL_MS = 30 * 60 * 1000;

const dataDir = process.env.GATEWAY_DATA_DIR || '/home/qianli/feishu-gateway-data';
const STATE_FILE = path.join(dataDir, 'usage-sync-state.json');
let state = { sigs: {} };
try { state = Object.assign(state, JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'))); } catch (err) { /* 首次空表 */ }
let stateDirty = false;
setInterval(() => {
  if (!stateDirty) return;
  stateDirty = false;
  fs.writeFile(STATE_FILE, JSON.stringify(state), () => {});
}, 60 * 1000).unref();

function signature(day) {
  const userCount = Object.values(day.users || {}).reduce((s, u) => s + (u.c || 0), 0);
  const raw = JSON.stringify({ t: day.total || 0, u: userCount, f: day.feats || {} });
  return crypto.createHash('md5').update(raw).digest('hex').slice(0, 12);
}

/** 「日期」字段是日期类型：YYYY-MM-DD → 当日 0 点（东八区）毫秒时间戳 */
function toMs(dateStr) {
  return new Date(`${dateStr}T00:00:00+08:00`).getTime();
}

/** 内存 upsert：rows 为整表现有记录（{record_id, fields}），命中更新并原位合并，未命中创建并追加 */
async function upsertIn(rows, tableId, matchFn, fields) {
  const hit = rows.find((r) => matchFn(r.fields));
  if (hit) {
    await bitable.updateRecord(APP_TOKEN, tableId, hit.record_id, fields);
    Object.assign(hit.fields, fields);
    return 'update';
  }
  const rec = await bitable.createRecord(APP_TOKEN, tableId, fields);
  rows.push({ record_id: rec.record_id, fields });
  return 'create';
}

async function syncDay(date, day, tables) {
  const dateMs = toMs(date);
  const byDate = (f) => Number(f['日期']) === dateMs;

  // 列名沿用历史（总消息数=机器人交互次数），仪表盘图表无需重建
  await upsertIn(tables.daily.rows, TABLES.daily, byDate, {
    '日期': dateMs,
    '总消息数': day.total || 0,
    '活跃人数': Object.keys(day.users || {}).length,
    '功能数': Object.keys(day.feats || {}).length,
  });
}

let running = false;
/** 全量同步：跳过签名未变化的日期；返回 {synced, skipped, errors} */
async function runSync({ force = false } = {}) {
  if (!APP_TOKEN || !TABLES.daily) {
    return { skipped: true, reason: 'plaza daily table not configured' };
  }
  if (running) return { skipped: true, reason: 'sync already running' };
  running = true;
  const result = { synced: [], skipped: 0, errors: [] };
  try {
    const days = usage.getAllDays();
    const pending = Object.keys(days).filter((d) => force || state.sigs[d] !== signature(days[d]));
    result.skipped = Object.keys(days).length - pending.length;
    if (pending.length === 0) return result;

    // 整表拉回一次（30 天 × 1 行/天），本轮所有 upsert 走内存比对
    const tables = { daily: { rows: await bitable.listAllRecords(APP_TOKEN, TABLES.daily) } };
    for (const date of pending.sort()) {
      try {
        await syncDay(date, days[date], tables);
        state.sigs[date] = signature(days[date]);
        stateDirty = true;
        result.synced.push(date);
      } catch (err) {
        result.errors.push(`${date}: ${err.message}`);
        console.warn('[使用统计同步] 写表失败（下轮重试）:', date, err.message);
      }
    }
    // 只保留最近 35 天的签名（usage 本身保留 30 天）
    for (const d of Object.keys(state.sigs)) {
      if (!days[d]) delete state.sigs[d];
    }
    stateDirty = true;
  } finally {
    running = false;
  }
  return result;
}

let started = false;
function start() {
  if (started) return;
  started = true;
  if (!APP_TOKEN || !TABLES.daily) {
    console.log('[使用统计同步] 未配置 PLAZA_BITABLE_APP_TOKEN/DAILY_TABLE，活跃数据不落多维表格');
    return;
  }
  console.log(`[使用统计同步] 已启用：每 ${SYNC_INTERVAL_MS / 60000} 分钟 upsert 网关日活跃（机器人交互口径）到机器人项目看板`);
  setTimeout(() => runSync().catch((err) => console.warn('[使用统计同步] 首轮失败:', err.message)), 8000).unref();
  setInterval(() => runSync().catch((err) => console.warn('[使用统计同步] 同步失败:', err.message)), SYNC_INTERVAL_MS).unref();
}

module.exports = { start, runSync };
