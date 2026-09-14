// ============================================================
// 周报口径与聚合（纯函数，无 IO，桩测试直接覆盖）
//
// 时区口径：中国无夏令时，上海时间 = UTC+8 恒定偏移。
// 实现手法：把时间戳 +8h 后当 UTC 读，得到"上海挂钟"分量；
// 算完挂钟再 -8h 还原成真实时刻传给企微接口。
//
// 播报窗口：以「发送日」为锚——窗口 = 发送日 00:00 往前整 7 天。
// 默认每周一 09:30 发，窗口即上一周一 00:00 ~ 本周一 00:00（上一完整周）。
// ============================================================

const SHANGHAI_OFFSET_MS = 8 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;
const WEEKDAYS_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function toWall(ms) {
  return ms + SHANGHAI_OFFSET_MS;
}

function fromWall(wallMs) {
  return wallMs - SHANGHAI_OFFSET_MS;
}

// 某时刻（真实毫秒）对应的上海当日 00:00 的真实毫秒
function shanghaiMidnight(ms) {
  const d = new Date(toWall(ms));
  return fromWall(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function shanghaiDayOfWeek(ms) {
  return new Date(toWall(ms)).getUTCDay(); // 0=周日
}

function fmtDay(wallMs) {
  return new Date(wallMs).toISOString().slice(0, 10);
}

function fmtTime(realMs) {
  const d = new Date(toWall(realMs));
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

function weekdayCN(realMs) {
  return WEEKDAYS_CN[shanghaiDayOfWeek(realMs)];
}

// 「发送日 DHH:MM」体系下，now 所在周期最近的发送日 00:00（上海挂钟）
// sendDow: 0~6（0=周日）；now 已过本周发送日则锚=本周发送日，否则=上周发送日
function currentAnchor(nowMs, sendDow) {
  const todayMidnight = shanghaiMidnight(nowMs);
  const daysAgo = (shanghaiDayOfWeek(nowMs) - sendDow + 7) % 7;
  return todayMidnight - daysAgo * DAY_MS;
}

// 周报窗口：offset=0 表示 now 所在周期应播报的那一周（最近一个已结束的发送周期），
// offset 每加 1 往前推一周。返回 {start, end(真实 Date 毫秒), label, key, startWall, endWall}
function weekWindow(offset = 0, nowMs = Date.now(), sendDow = 1) {
  // currentAnchor 返回真实时刻，这里统一转回"上海挂钟"口径参与日期运算
  const anchorWall = toWall(currentAnchor(nowMs, sendDow)) - offset * 7 * DAY_MS;
  const startWall = anchorWall - 7 * DAY_MS;
  const endWall = anchorWall;
  return {
    start: fromWall(startWall),
    end: fromWall(endWall),
    startWall,
    endWall,
    label: `${fmtDay(startWall)} ~ ${fmtDay(endWall - DAY_MS)}`,
    key: fmtDay(startWall), // 周唯一键=该周周一日期，播报去重用
  };
}

// 判断 now 是否已过「发送日 D 的 HH:MM」（用于重启补发判定）
// currentAnchor 已是真实时刻，直接在真实时间轴上加上当日偏移即可
function isPastSendTime(nowMs, sendDow, hour, minute) {
  const anchorReal = currentAnchor(nowMs, sendDow);
  return nowMs >= anchorReal + (hour * 60 + minute) * 60 * 1000;
}

const EXCEPTION_SPLIT = /[;；]/;

// 聚合打卡记录（企微 getcheckindata 返回的 checkindata 数组，checkin_time 为秒级时间戳）
// members: [{userid, name}]；名单外出现的 userid 以原始 userid 展示并标 unknown
function aggregate(records, members) {
  const nameMap = new Map((members || []).map((m) => [m.userid, m.name || m.userid]));
  const byUser = new Map();
  const sorted = [...(records || [])].sort((a, b) => a.checkin_time - b.checkin_time);
  const knownIds = new Set();

  for (const r of sorted) {
    const t = r.checkin_time * 1000;
    const day = new Date(toWall(t)).toISOString().slice(0, 10);
    knownIds.add(r.userid);
    if (!byUser.has(r.userid)) {
      byUser.set(r.userid, { userid: r.userid, name: nameMap.get(r.userid) || r.userid, known: nameMap.has(r.userid), punches: 0, days: new Set(), exceptions: [] });
    }
    const u = byUser.get(r.userid);
    u.punches += 1;
    u.days.add(day);
    if (r.exception_type && String(r.exception_type).trim()) {
      for (const ex of String(r.exception_type).split(EXCEPTION_SPLIT)) {
        const type = ex.trim();
        if (type) u.exceptions.push({ day, time: fmtTime(t), type, group: r.groupname || '' });
      }
    }
  }

  // 名单内整周无记录的人也列出来（打卡天数据 0），便于负责人一眼看到缺勤
  for (const m of members || []) {
    if (!byUser.has(m.userid)) {
      byUser.set(m.userid, { userid: m.userid, name: m.name || m.userid, known: true, punches: 0, days: new Set(), exceptions: [] });
    }
  }

  const users = [...byUser.values()].map((u) => ({
    userid: u.userid,
    name: u.name,
    known: u.known,
    punchDays: u.days.size,
    punches: u.punches,
    exceptions: u.exceptions,
    days: [...u.days].sort(),
  }));
  users.sort((a, b) => (a.name > b.name ? 1 : a.name < b.name ? -1 : 0));

  const totals = {
    punches: users.reduce((s, u) => s + u.punches, 0),
    exceptions: users.reduce((s, u) => s + u.exceptions.length, 0),
    users: users.length,
    punchUsers: users.filter((u) => u.punches > 0).length,
  };
  const exceptionLines = users.flatMap((u) => u.exceptions.map((e) => ({ name: u.name, userid: u.userid, ...e })));

  // rawRecords/userNames 供 CSV 渲染复用，避免调用方重新拼装
  return { users, totals, exceptionLines, recordCount: sorted.length, rawRecords: sorted, userNames: nameMap };
}

// markdown_v2 渲染（企微群机器人 markdown_v2 才支持表格；不支持字体颜色与 @）
function renderMarkdownV2(window, report, opts = {}) {
  const maxDetail = opts.maxDetailLines || 50;
  const esc = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|');
  const lines = [];
  lines.push(`## 📋 考勤周报（${window.label}）`);
  lines.push(`> 打卡 **${report.totals.punches}** 条 · 异常 **${report.totals.exceptions}** 条 · 涉及 ${report.totals.users} 人（有打卡 ${report.totals.punchUsers} 人）`);
  if (!report.totals.punches) {
    lines.push('> 本周无打卡记录（检查名单与打卡规则是否匹配）');
  } else {
    lines.push('');
    lines.push('| 成员 | 打卡天数 | 记录数 | 异常 |');
    lines.push('| --- | --- | --- | --- |');
    for (const u of report.users) {
      lines.push(`| ${esc(u.name)} | ${u.punchDays} | ${u.punches} | ${u.exceptions.length || '-'} |`);
    }
  }
  if (report.exceptionLines.length) {
    lines.push('');
    lines.push('### ⚠ 异常明细');
    const shown = report.exceptionLines.slice(0, maxDetail);
    for (const e of shown) {
      lines.push(`> ${esc(e.name)} ${e.day} ${e.time} **${esc(e.type)}**${e.group ? `（${esc(e.group)}）` : ''}`);
    }
    if (report.exceptionLines.length > shown.length) {
      lines.push(`> …其余 ${report.exceptionLines.length - shown.length} 条见 CSV 附件`);
    }
  }
  lines.push('');
  lines.push(`> 数据来自企业微信打卡接口 · 打卡明细见附件 CSV`);
  return lines.join('\n');
}

function csvEscape(v) {
  const s = String(v == null ? '' : v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// CSV 明细（UTF-8 BOM 头，Excel 直开不乱码）——即"导出链路"的机器替代
function renderCsv(window, report) {
  const head = ['姓名', 'userid', '日期', '星期', '时间', '打卡类型', '异常', '打卡地点', 'WiFi名称', '打卡规则'];
  const rows = [head.join(',')];
  for (const r of report.rawRecords || []) {
    const t = r.checkin_time * 1000;
    rows.push([
      report.userNames.get(r.userid) || r.userid,
      r.userid,
      new Date(toWall(t)).toISOString().slice(0, 10),
      weekdayCN(t),
      fmtTime(t),
      r.checkin_type || '',
      r.exception_type || '',
      r.location_title || '',
      r.wifiname || '',
      r.groupname || '',
    ].map(csvEscape).join(','));
  }
  if (rows.length === 1) rows.push('（本周无打卡记录）,,,');
  return '\uFEFF' + rows.join('\r\n');
}

module.exports = {
  SHANGHAI_OFFSET_MS,
  DAY_MS,
  weekWindow,
  currentAnchor,
  isPastSendTime,
  aggregate,
  renderMarkdownV2,
  renderCsv,
  fmtDay,
  fmtTime,
  weekdayCN,
};
