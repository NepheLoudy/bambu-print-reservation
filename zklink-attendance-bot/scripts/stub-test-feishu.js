// 飞书通道桩测试：签名向量/卡片构建/块构造/docx 分批追加（mock fetch，不出网）
// 运行：node scripts/stub-test-feishu.js
const assert = require('assert');
const os = require('os');
const fs = require('fs');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zk-feishu-'));
process.env.FEISHU_APP_ID = 'cli_test';
process.env.FEISHU_APP_SECRET = 'sec_test';
process.env.ARCHIVE_DOC_TOKEN = 'DOCTOK';

const feishu = require('../src/feishu');
const report = require('../src/report');

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.error(`  ✗ ${name} — ${extra}`); }
}

console.log('\n== 1. webhook 签名（硬编码官方算法向量） ==');
check('ts+secret HMAC 向量', feishu.signFor('1700000000', 'test-secret') === 'mbm4Y4oluIPQ00qlBIhX8vAZ0EKv3nw0LuTb91jPL84=', feishu.signFor('1700000000', 'test-secret'));

console.log('\n== 2. 通道门控 ==');
let err = null;
try { feishu.pickChannels({}); } catch (e) { err = e; }
check('无 webhook → NO_CONFIG', err && err.errcode === 'NO_CONFIG', String(err));
check('有 webhook → feishu:true', feishu.pickChannels({ feishuWebhookUrl: 'x' }).feishu === true);

console.log('\n== 3. 周报卡片构建 ==');
// （后续 5-7 节为异步段，文件末尾 async IIFE 内执行）
const win = report.weekWindow(0, Date.parse('2026-09-21T09:30:00+08:00'), 1);
const sec = (s) => Math.floor(Date.parse(s) / 1000);
const records = [
  { userid: 'zhangsan', _name: '张三', checkin_time: sec('2026-09-14T08:55:00+08:00') },
  { userid: 'zhangsan', _name: '张三', checkin_time: sec('2026-09-14T18:02:00+08:00') },
  { userid: 'zhangsan', _name: '张三', checkin_time: sec('2026-09-15T09:00:00+08:00') }, // 孤条 → orange
];
const agg = report.aggregateDuration(records, [{ userid: 'zhangsan', name: '张三' }]);
const cardOrange = feishu.buildWeeklyCard(win, agg);
check('有孤条 → orange 头', cardOrange.header.template === 'orange', cardOrange.header.template);
check('标题含周窗口', cardOrange.header.title.content.includes('2026-09-14 ~ 2026-09-20'), cardOrange.header.title.content);
check('汇总行含总时长', cardOrange.elements[0].content.includes('9小时7分钟'), cardOrange.elements[0].content);
check('孤条入卡片', cardOrange.elements[0].content.includes('孤条 1 天'), cardOrange.elements[0].content);
const aggClean = report.aggregateDuration(records.slice(0, 2), [{ userid: 'zhangsan', name: '张三' }]);
check('全勤 → green 头', feishu.buildWeeklyCard(win, aggClean).header.template === 'green');
const aggEmpty = report.aggregateDuration([], [{ userid: 'zhangsan', name: '张三' }]);
check('空数据 → 提示检查导出', feishu.buildWeeklyCard(win, aggEmpty).elements[2].content.includes('无打卡记录'));

console.log('\n== 4. docx 块构造 ==');
const tb = feishu.textBlock('hello');
check('文本块 block_type=2', tb.block_type === 2 && tb.text.elements[0].text_run.content === 'hello');
const hb = feishu.headingBlock(2, '标题');
check('heading2 块 block_type=4', hb.block_type === 4 && hb.heading2.elements[0].text_run.content === '标题');

(async () => {
  console.log('\n== 5. appendDocBlocks 分批（120 块 → 50/50/20，mock fetch） ==');
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url: String(url), body: init && init.body ? JSON.parse(init.body) : null });
    if (String(url).includes('tenant_access_token')) {
      return { json: async () => ({ code: 0, tenant_access_token: 't-1', expire: 7200 }) };
    }
    return { json: async () => ({ code: 0, data: {} }) };
  };
  const blocks120 = Array.from({ length: 120 }, (_, i) => feishu.textBlock(`line-${i}`));
  const n = await feishu.appendDocBlocks('DOCTOK', blocks120);
  check('追加总数=120', n === 120, String(n));
  const docCalls = calls.filter((c) => c.url.includes('/documents/DOCTOK/blocks/DOCTOK/children'));
  check('分 3 次请求', docCalls.length === 3, String(docCalls.length));
  check('每批 ≤50（50/50/20）', JSON.stringify(docCalls.map((c) => c.body.children.length)) === '[50,50,20]', JSON.stringify(docCalls.map((c) => c.body.children.length)));
  check('追加到末尾 index=-1 + revision=-1', docCalls.every((c) => c.body.index === -1) && docCalls[0].url.includes('document_revision_id=-1'));

  console.log('\n== 6. 未配置 doc token → NO_CONFIG ==');
  err = null;
  try { await feishu.appendDocBlocks('', blocks120); } catch (e) { err = e; }
  check('空 token 报 NO_CONFIG', err && err.errcode === 'NO_CONFIG', String(err));

  console.log('\n== 7. describeErrcode 提示文案 ==');
  check('19021 → 签名提示', feishu.describeErrcode(19021).includes('签名'), feishu.describeErrcode(19021));
  check('1770002 → 文档协作者提示', feishu.describeErrcode(1770002).includes('协作者'), feishu.describeErrcode(1770002));

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
