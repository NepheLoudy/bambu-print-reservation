// 打卡报表导入桩测试（方案4）：xlsx 内存造表 → 列识别/时区/名单合并/窗口过滤/缺列报错
// 运行：node scripts/stub-test-import.js
const assert = require('assert');
const XLSX = require('xlsx');
const { parseWorkbook, mergeMembers, filterByWindow, deriveMembers } = require('../src/importService');
const report = require('../src/report');

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.error(`  ✗ ${name} — ${extra}`); }
}

// ---------- 1. 构造 xlsx（混合 Date / 字符串时间单元格） ----------
const SH = (s) => new Date(s); // 字符串按本地(+08:00 标注)解析
const rows = [
  ['姓名', '账号', '打卡时间', '打卡类型', '异常', '打卡地点', '打卡规则'],
  ['张三', 'zhangsan', '2026/9/8 8:55', '上班打卡', '', '实验室', '默认规则'],
  ['张三', 'zhangsan', '2026/9/8 18:02', '下班打卡', '时间异常', '实验室', '默认规则'],
  ['李四', 'lisi', new Date(Date.UTC(2026, 8, 9, 9, 58, 0)), '上班打卡', '', '', ''], // Date 单元格：UTC 分量=上海挂钟
  ['王五', '', '2026-09-16 09:00:00', '上班打卡', '', '客户现场', '外出规则'], // 无账号 → 姓名兜底 userid
];
const ws = XLSX.utils.aoa_to_sheet(rows);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, '打卡明细');
const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

console.log('\n== 1. 解析与列识别 ==');
const parsed = parseWorkbook(buf);
check('记录数=4', parsed.records.length === 4, String(parsed.records.length));
check('列识别含 姓名/账号/打卡时间', parsed.matched.some((m) => m.startsWith('name')) && parsed.matched.some((m) => m.startsWith('userid')) && parsed.matched.some((m) => m.startsWith('time')), JSON.stringify(parsed.matched));
const r1 = parsed.records[0];
check('userid 取自「账号」列', r1.userid === 'zhangsan', r1.userid);
check('字符串时间按上海时区换算（2026/9/8 8:55 → 08:55+08:00）', new Date(r1.checkin_time * 1000).toISOString() === '2026-09-08T00:55:00.000Z', new Date(r1.checkin_time * 1000).toISOString());
check('Date 单元格按 UTC 分量=上海挂钟（09:58+08:00）', new Date(parsed.records[2].checkin_time * 1000).toISOString() === '2026-09-09T01:58:00.000Z', new Date(parsed.records[2].checkin_time * 1000).toISOString());
check('异常列透传', parsed.records[1].exception_type === '时间异常');

console.log('\n== 2. 名单派生与合并 ==');
const derived = deriveMembers(parsed.records);
check('名单去重=3 人', derived.length === 3, JSON.stringify(derived));
check('无账号者 userid 兜底为姓名', derived.some((m) => m.userid === '王五'), JSON.stringify(derived));
const merged = mergeMembers([{ userid: 'old1', name: '老人' }], derived);
check('既有名册保留 + 新成员追加', merged.length === 4 && merged.some((m) => m.userid === 'old1'), JSON.stringify(merged.map((m) => m.userid)));

console.log('\n== 3. 播报窗口过滤 ==');
// 发送日=周一 2026-09-21 看，窗口=09-14 00:00 ~ 09-21 00:00（上海）
const look = Date.parse('2026-09-16T12:00:00+08:00');
const win = report.weekWindow(0, look, 1);
check('窗口标签正确', win.label === '2026-09-07 ~ 2026-09-13', win.label);
const inWin = filterByWindow(parsed.records, win);
check('只保留窗口内记录（09-16 的王五被滤掉）', inWin.length === 3, String(inWin.length));
const win2 = report.weekWindow(0, Date.parse('2026-09-30T12:00:00+08:00'), 1);
check('下一窗口无数据时过滤为空', filterByWindow(parsed.records, win2).length === 0);

console.log('\n== 4. 缺关键列 → 明确报错 ==');
const ws2 = XLSX.utils.aoa_to_sheet([['foo', 'bar'], [1, 2]]);
const wb2 = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb2, ws2, 's');
const buf2 = XLSX.write(wb2, { type: 'buffer', bookType: 'xlsx' });
let msg = '';
try { parseWorkbook(buf2); } catch (e) { msg = e.message; }
check('缺姓名/时间列报错并列出全部表头', msg.includes('报表缺关键列') && msg.includes('foo'), msg);

// ---------- 5. 聚合链路兼容（records 直接进 report.aggregate） ----------
const agg = report.aggregate(filterByWindow(parsed.records, win), mergeMembers([], derived));
check('聚合 totals.users=3（张三/李四/王五，王五窗口外不计数）', agg.totals.users === 3, JSON.stringify(agg.totals));
check('张三异常 1 条进入明细', agg.exceptionLines.some((e) => e.name === '张三' && e.type === '时间异常'));

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
