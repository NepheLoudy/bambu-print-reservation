// ============================================================
// 打卡报表导入（方案 4：企微可信IP门槛不可行，数据源改人肉周导）
//
// 企微管理后台 → 打卡应用 → 报表 → 打卡记录明细 导出 xlsx/csv，
// 经 POST /api/attendance/import 上传，本模块解析为与 getcheckindata
// 同构的记录流（{userid, checkin_time(秒), checkin_type, exception_type,
// location_title, wifiname, groupname}），列名按常见表头模糊匹配，
// 匹配不到的列忽略并在结果里报告（新报表模板出现时一眼看出缺哪列）。
//
// 时区口径与 report.js 一致：上海时间 = UTC+8 恒定偏移。
// ============================================================

const SHANGHAI_OFFSET_MS = 8 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;

// 表头模糊匹配（小写包含）；顺序=优先级，命中即用
const COLUMN_HINTS = {
  name: ['姓名', '名字', 'name', '成员'],
  userid: ['账号', 'userid', 'user_id', '用户id', '工号', '成员账号'],
  time: ['打卡时间', '时间', 'time'],
  checkin_type: ['打卡类型', '打卡方式', '类型', 'type'],
  exception_type: ['异常', 'exception'],
  location_title: ['打卡地点', '地点', '位置', 'location'],
  wifiname: ['wifi', '无线'],
  groupname: ['规则', '分组', 'group'],
};
const REQUIRED = ['name', 'time'];

function matchColumns(headers) {
  const lower = headers.map((h) => String(h || '').trim().toLowerCase());
  const map = {};
  const matched = [];
  for (const [field, hints] of Object.entries(COLUMN_HINTS)) {
    for (const hint of hints) {
      const idx = lower.findIndex((h) => h && h.includes(hint.toLowerCase()));
      if (idx >= 0) { map[field] = idx; matched.push(`${field}←"${headers[idx]}"`); break; }
    }
  }
  return { map, matched };
}

// 把单元格值统一成「上海挂钟毫秒」：Date 对象（xlsx cellDates 视序列号为 UTC）/
// Excel 序列号 / 常见字符串（2026/9/14 8:55、2026-09-14 08:55:00）
function toShanghaiMs(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    const d = v;
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()) - SHANGHAI_OFFSET_MS;
  }
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    // Excel 序列号（1900 纪元，天 为单位；小数=时刻）
    return Math.round((v - 25569) * DAY_MS) - SHANGHAI_OFFSET_MS;
  }
  const m = /(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})[日T\s]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/.exec(String(v).trim());
  if (m) {
    const [, y, mo, d, h, mi, s] = m;
    return Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s || 0)) - SHANGHAI_OFFSET_MS;
  }
  return null;
}

/**
 * 解析打卡明细工作簿（xlsx/csv 字节流）
 * @returns {{records: Array, members: Array, matched: string[], skipped: number, rows: number}}
 */
function parseWorkbook(buf) {
  const XLSX = require('xlsx');
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error('工作簿中没有工作表');
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
  if (!rows.length) throw new Error('工作表为空');
  // 表头行=第一个含「时间」类表头的行（有些导出前几行是标题/筛选说明）
  let headerIdx = rows.findIndex((r) => r.some((c) => /打卡时间|时间|time/i.test(String(c))));
  if (headerIdx === -1) headerIdx = 0;
  const headers = rows[headerIdx].map((c) => String(c));
  const { map, matched } = matchColumns(headers);
  const missing = REQUIRED.filter((f) => map[f] == null);
  if (missing.length) {
    throw new Error(`报表缺关键列：${missing.join('/')}（识别到的列：${matched.join('、') || '无'}；全部表头：${headers.filter(Boolean).join(' | ').slice(0, 200)}）`);
  }

  const records = [];
  let skipped = 0;
  for (const row of rows.slice(headerIdx + 1)) {
    if (!row || !row.some((c) => String(c).trim() !== '')) continue;
    const ms = toShanghaiMs(row[map.time]);
    const name = map.name != null ? String(row[map.name] || '').trim() : '';
    if (!ms || (!name && map.userid == null)) { skipped += 1; continue; }
    const userid = (map.userid != null && String(row[map.userid] || '').trim()) || name;
    const str = (f) => (map[f] != null ? String(row[map[f]] || '').trim() : '');
    records.push({
      userid,
      _name: name || userid,
      checkin_time: Math.floor(ms / 1000),
      checkin_type: str('checkin_type'),
      exception_type: str('exception_type'),
      location_title: str('location_title'),
      wifiname: str('wifiname'),
      groupname: str('groupname'),
    });
  }
  if (!records.length) throw new Error(`解析到 0 条打卡记录（表头识别：${matched.join('、') || '无'}）`);
  return { records, members: deriveMembers(records), matched, skipped, rows: rows.length - headerIdx - 1 };
}

/** 从记录流取名单（去重） */
function deriveMembers(records) {
  const seen = new Map();
  for (const r of records || []) {
    if (!seen.has(r.userid)) seen.set(r.userid, { userid: r.userid, name: r._name || r.userid });
  }
  return [...seen.values()];
}

/** 名单合并：既有名册优先（保留手工维护的 userid↔姓名），导入衍生的新成员追加 */
function mergeMembers(roster, derived) {
  const byId = new Map((roster || []).map((m) => [m.userid, m]));
  for (const m of derived || []) {
    if (!byId.has(m.userid)) byId.set(m.userid, m);
  }
  return [...byId.values()];
}

/** 过滤落在播报窗口 [start, end) 内的记录 */
function filterByWindow(records, win) {
  return (records || []).filter((r) => r.checkin_time * 1000 >= win.start && r.checkin_time * 1000 < win.end);
}

module.exports = { parseWorkbook, deriveMembers, mergeMembers, filterByWindow, toShanghaiMs };
