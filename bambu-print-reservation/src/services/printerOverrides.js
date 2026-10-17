// ============================================================
// 打印机料信息手动覆盖（2026-10-17 曼波令：「观察台里手动修改 AMS 和外挂信息」）
//
// 场景：AMS/外挂料盘上报的料名/颜色不准或空白（无 RFID 的自缠料、闪铸直进料口等），
// 观察台给管理员提供人工修正入口。覆盖按「打印机id + 槽位名」持久化到独立 JSON，
// 状态层与 API 层读取时合并——观察台/预约页/审批对话框/分发匹配同口径生效。
// 字段语义：type/colorHex 单独可留 null=恢复该字段自动；两项皆 null=删除整槽覆盖。
// ============================================================

const fs = require('fs');
const path = require('path');

const FILE = process.env.PRINTER_OVERRIDES_FILE || path.join(__dirname, '..', '..', '.printer-overrides.json');

let cache = null;

function load() {
  if (cache) return cache;
  try {
    if (fs.existsSync(FILE)) {
      const data = JSON.parse(fs.readFileSync(FILE, 'utf-8'));
      cache = data && typeof data.printers === 'object' && data.printers ? data.printers : {};
    } else {
      cache = {};
    }
  } catch (err) {
    console.warn('[料信息覆盖] 加载失败（按空启动）:', err.message);
    cache = {};
  }
  return cache;
}

function save() {
  const tmp = FILE + '.tmp';
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify({ savedAt: new Date().toISOString(), printers: cache }, null, 2));
  fs.renameSync(tmp, FILE);
}

/** 某台打印机的覆盖表：{ "<槽位名>": { type?, colorHex? } } */
function getFor(printerId) {
  return load()[String(printerId)] || {};
}

/** 写入/更新覆盖：patch { type?, colorHex? }（字段 null=删除该字段，两项皆空=删整槽） */
function setFor(printerId, slot, patch) {
  const all = load();
  const key = String(printerId);
  const cur = { ...(all[key] || {}) };
  const next = { ...(cur[slot] || {}) };
  for (const field of ['type', 'colorHex']) {
    if (!patch || !(field in patch)) continue;
    if (patch[field] == null) delete next[field];
    else next[field] = patch[field];
  }
  if (!next.type && !next.colorHex) delete cur[slot];
  else cur[slot] = next;
  if (Object.keys(cur).length) all[key] = cur;
  else delete all[key];
  cache = all;
  save();
  return cur;
}

/** 合并到托盘数组（纯函数，单测覆盖）：命中覆盖的槽替换字段并打 overridden 标记 */
function applyOverrides(trays, ov) {
  const list = Array.isArray(trays) ? trays : [];
  if (!ov || !Object.keys(ov).length) return list;
  return list.map((t) => {
    const o = ov[t.slot];
    if (!o) return t;
    return {
      ...t,
      type: o.type != null ? o.type : t.type,
      colorHex: o.colorHex != null ? o.colorHex : t.colorHex,
      overridden: true,
    };
  });
}

module.exports = { getFor, setFor, applyOverrides };
