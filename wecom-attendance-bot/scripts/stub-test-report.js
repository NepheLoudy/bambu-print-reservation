// 聚合与渲染桩测试：多人/多日/异常拆分/名单外 userid/零打卡成员/表格与 CSV
// 运行：npm run test:report
const assert = require('assert');
const { aggregate, renderMarkdownV2, renderCsv } = require('../src/report');

const S = (iso) => Math.floor(Date.parse(iso) / 1000); // 上海时刻 ISO → 秒
const members = [
  { userid: 'u1', name: '张三' },
  { userid: 'u2', name: '李四' },
  { userid: 'u4', name: 'A|B' }, // 名字带竖线，验证表格转义
];

const records = [
  { userid: 'u1', checkin_time: S('2026-09-07T08:55:00+08:00'), checkin_type: '上班打卡', exception_type: '', location_title: '实验室', wifiname: 'lab', groupname: '默认规则' },
  { userid: 'u1', checkin_time: S('2026-09-07T18:02:00+08:00'), checkin_type: '下班打卡', exception_type: '', location_title: '实验室', wifiname: 'lab', groupname: '默认规则' },
  // 周二两条异常类型（中文分号分隔）
  { userid: 'u1', checkin_time: S('2026-09-08T09:41:00+08:00'), checkin_type: '上班打卡', exception_type: '时间异常', location_title: '实验室', wifiname: 'lab', groupname: '默认规则' },
  { userid: 'u1', checkin_time: S('2026-09-08T18:00:00+08:00'), checkin_type: '下班打卡', exception_type: '地点异常;WIFI异常', location_title: '外地', wifiname: '', groupname: '默认规则' },
  { userid: 'u2', checkin_time: S('2026-09-09T09:00:00+08:00'), checkin_type: '上班打卡', exception_type: '', location_title: '实验室', wifiname: 'lab', groupname: '默认规则' },
  { userid: 'u3', checkin_time: S('2026-09-09T21:10:00+08:00'), checkin_type: '外出打卡', exception_type: '', location_title: '客户现场', wifiname: '', groupname: '外出规则' },
];

const win = { label: '2026-09-07 ~ 2026-09-13', key: '2026-09-07', start: 0, end: 0, startWall: 0, endWall: 0 };
const rep = aggregate(records, members);

// 1) 总量
assert.strictEqual(rep.recordCount, 6, '记录总数');
assert.strictEqual(rep.totals.punches, 6, '打卡总量');
assert.strictEqual(rep.totals.users, 4, '涉及人数（含名单外 u3 与零打卡 u4）');
assert.strictEqual(rep.totals.punchUsers, 3, '有打卡人数');

// 2) 人员维度
const zhang = rep.users.find((u) => u.userid === 'u1');
assert.strictEqual(zhang.name, '张三');
assert.strictEqual(zhang.punchDays, 2, '张三打卡天数=2 天');
assert.strictEqual(zhang.exceptions.length, 3, '张三异常=1+2（中文/英文分号都拆开）');
assert.deepStrictEqual(zhang.exceptions.map((e) => e.type), ['时间异常', '地点异常', 'WIFI异常'], '异常类型拆分');
assert.strictEqual(zhang.exceptions[0].time, '09-08 09:41', '异常时间格式 MM-DD HH:mm');

const unknown = rep.users.find((u) => u.userid === 'u3');
assert.strictEqual(unknown.known, false, '名单外 userid 标记 unknown');
assert.strictEqual(unknown.name, 'u3', '名单外用原始 userid 展示');

const idle = rep.users.find((u) => u.userid === 'u4');
assert.strictEqual(idle.punchDays, 0, '零打卡成员也入列（缺勤一眼可见）');

// 3) 异常明细索引
assert.strictEqual(rep.exceptionLines.length, 3, '异常明细行数');

// 4) markdown_v2 渲染
const md = renderMarkdownV2(win, rep);
assert.ok(md.includes('## 📋 考勤周报（2026-09-07 ~ 2026-09-13）'), '标题含窗口');
assert.ok(md.includes('打卡 **6** 条 · 异常 **3** 条'), '摘要行');
assert.ok(md.includes('| 成员 | 打卡天数 | 记录数 | 异常 |'), '表格表头');
assert.ok(md.includes('| 张三 | 2 | 4 | 3 |'), '张三行');
assert.ok(md.includes('A\\|B'), '竖线已转义');
assert.ok(md.includes('### ⚠ 异常明细'), '异常明细段');
assert.ok(md.includes('**时间异常**'), '异常类型加粗');

// 4.5) markdown esc 加固（2026-09-27）：换行折叠 + 控制字符剔除（防伪造姓名破表格行）
{
  const evilRep = aggregate(records.slice(0, 1), [
    { userid: 'u1', name: '坏\n名字' },
    { userid: 'u9', name: 'X\r\nY|Z\u0007' },
  ]);
  const evilMd = renderMarkdownV2(win, evilRep);
  const evilRow = evilMd.split('\n').find((l) => l.startsWith('| 坏 名字 |'));
  assert.strictEqual(evilRow, '| 坏 名字 | 1 | 1 | - |', '折叠后行内容与列数正确');
  assert.ok(evilMd.includes('X Y\\|Z'), '回车换行折叠 + 竖线转义 + 控制字符剔除');
  assert.ok(!/[\u0000-\u001f\u007f]/.test(evilMd.replace(/\n/g, '')), '表格区不含残留控制字符');
}

// 5) 明细行数截断
const mdCapped = renderMarkdownV2(win, rep, { maxDetailLines: 2 });
assert.ok(mdCapped.includes('其余 1 条见 CSV 附件'), '明细截断提示');

// 6) 空周报兜底
const empty = aggregate([], members);
const mdEmpty = renderMarkdownV2(win, empty);
assert.ok(mdEmpty.includes('本周无打卡记录'), '空周报提示');

// 7) CSV：BOM、表头、行数、逗号转义、零记录行
const csv = renderCsv(win, rep);
assert.ok(csv.startsWith('\uFEFF'), 'UTF-8 BOM');
const lines = csv.replace(/^\uFEFF/, '').split('\r\n');
assert.strictEqual(lines[0], '姓名,userid,日期,星期,时间,打卡类型,异常,打卡地点,WiFi名称,打卡规则', 'CSV 表头');
assert.strictEqual(lines.length, 7, 'CSV 行数=记录数+表头');
assert.ok(lines[3].includes('"地点异常;WIFI异常"') === false, '分号不需引号');
assert.ok(lines[6].includes('u3'), '名单外 userid 进 CSV（按时间排序后 u3 在最后一行）');
const csvEmpty = renderCsv(win, empty);
assert.ok(csvEmpty.includes('（本周无打卡记录）'), '空 CSV 兜底行');

// 逗号字段加引号
const rep2 = aggregate([{ userid: 'u9', checkin_time: S('2026-09-07T08:00:00+08:00'), checkin_type: '上班打卡', exception_type: '', location_title: '实验室,二楼', wifiname: 'lab', groupname: 'g' }], []);
const csv2 = renderCsv(win, rep2);
assert.ok(csv2.includes('"实验室,二楼"'), '含逗号字段加引号');

// 8) markdown 字节熔断：超大名单截断并提示（企微 markdown 消息 4096 字节上限防护）
const bigMembers = Array.from({ length: 200 }, (_, i) => ({ userid: `u${i}`, name: `成员${i}号测试名字` }));
const bigRecords = bigMembers.map((m, i) => ({
  userid: m.userid,
  checkin_time: S(`2026-09-07T0${i % 9}:00:00+08:00`),
  checkin_type: '上班打卡',
  exception_type: '',
  location_title: '',
  wifiname: '',
  groupname: '',
}));
const repBig = aggregate(bigRecords, bigMembers);
const mdBig = renderMarkdownV2(win, repBig);
assert.ok(Buffer.byteLength(mdBig, 'utf8') < 4096, '熔断后不超企微 4096 字节上限');
assert.ok(mdBig.includes('名单过长已截断'), '熔断提示出现');
assert.ok(/（\d+\/200 人）/.test(mdBig), '截断计数（shown/total）');
assert.ok(mdBig.includes('完整数据见 CSV 附件'), '熔断提示指向 CSV 附件');
assert.ok(!md.includes('名单过长已截断'), '小名单不触发熔断');

// 8.5) 异常段字节熔断（回归 2026-09-25）：异常明细此前在预算外，25 人+100 异常实测 5611 字节超限
const manyMembers = Array.from({ length: 25 }, (_, i) => ({ userid: `m${i}`, name: `成员${i}号测试名字` }));
const manyRecords = [];
for (const m of manyMembers) {
  for (let j = 0; j < 4; j++) {
    manyRecords.push({
      userid: m.userid,
      checkin_time: S(`2026-09-0${j < 2 ? 7 : 8}T${String(9 + j).padStart(2, '0')}:00:00+08:00`),
      checkin_type: '上班打卡',
      exception_type: '时间异常',
      location_title: '实验室',
      wifiname: 'lab',
      groupname: '默认规则',
    });
  }
}
const repMany = aggregate(manyRecords, manyMembers); // 25 人 × 4 异常 = 100 条明细
assert.strictEqual(repMany.totals.exceptions, 100, '异常总量 100');
const mdMany = renderMarkdownV2(win, repMany);
assert.ok(Buffer.byteLength(mdMany, 'utf8') < 4096, '异常段纳入预算后整体不超企微 4096 上限');
assert.ok(mdMany.includes('异常过多已截断'), '异常段熔断提示出现');
assert.ok(/（\d+\/100 条），完整明细见 CSV 附件/.test(mdMany), '异常熔断计数并指向 CSV 附件');

// 9) CSV 空兜底行与 10 列表头对齐
const csvEmptyCols = renderCsv(win, empty).replace(/^\uFEFF/, '').split('\r\n');
assert.strictEqual(csvEmptyCols[1].split(',').length, 10, '空记录兜底行与表头列数一致');

// 10) CSV 公式注入防护：= + - @ 开头单元格前置 ' 中和（Excel/WPS 会当公式执行）
const repF = aggregate([
  { userid: 'uf', checkin_time: S('2026-09-07T08:00:00+08:00'), checkin_type: '上班打卡', exception_type: '', location_title: '=HYPERLINK("http://evil","x")', wifiname: '+cmd', groupname: '-减号组' },
], [{ userid: 'uf', name: '@注入人' }]);
const csvF = renderCsv(win, repF);
assert.ok(csvF.includes("'=HYPERLINK"), '公式前缀 = 已中和');
assert.ok(csvF.includes("'+cmd"), '公式前缀 + 已中和');
assert.ok(csvF.includes("'-减号组"), '公式前缀 - 已中和');
assert.ok(csvF.includes("'@注入人"), '公式前缀 @ 已中和（姓名列）');

console.log('✓ stub-test-report 全部通过（聚合/渲染/CSV/字节熔断/公式防护 43 组断言）');
