// 留档桩测试：本地落盘 / docx 块序列 / wiki 节点换算与回退（mock fetch，不出网）
// 运行：node scripts/stub-test-archiver.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zk-arch-'));
process.env.ZK_ATT_DATA_DIR = tmp;
process.env.FEISHU_APP_ID = 'cli_test';
process.env.FEISHU_APP_SECRET = 'sec_test';
process.env.ARCHIVE_DOC_TOKEN = 'WIKITOKEN123';

const archiver = require('../src/archiver');
const feishu = require('../src/feishu');
const report = require('../src/report');
const config = require('../src/config');

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.error(`  ✗ ${name} — ${extra}`); }
}

const win = report.weekWindow(0, Date.parse('2026-09-21T09:30:00+08:00'), 1);
const sec = (s) => Math.floor(Date.parse(s) / 1000);
const records = [
  { userid: 'zhangsan', _name: '张三', checkin_time: sec('2026-09-14T08:55:00+08:00'), checkin_type: '上班', exception_type: '', groupname: '实验室考勤组' },
  { userid: 'zhangsan', _name: '张三', checkin_time: sec('2026-09-14T18:02:00+08:00'), checkin_type: '下班', exception_type: '', groupname: '实验室考勤组' },
  { userid: 'zhangsan', _name: '张三', checkin_time: sec('2026-09-15T09:00:00+08:00'), checkin_type: '', exception_type: '', groupname: '实验室考勤组' },
];
const agg = report.aggregateDuration(records, [{ userid: 'zhangsan', name: '张三' }]);

(async () => {
  console.log('\n== 1. 本地留档（JSON 全量 + CSV 日明细） ==');
  const local = archiver.archiveLocal(win, agg, records, { dataSource: 'import' });
  check('落盘两个文件', local.files.length === 2 && local.files.every((f) => fs.existsSync(f)), JSON.stringify(local));
  const [jsonPath, csvPath] = local.files;
  const doc = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  check('JSON 含窗口键/记录/聚合', doc.window.key === '2026-09-14' && doc.records.length === 3 && doc.totals.punches === 3, JSON.stringify(doc.window));
  check('JSON 记数据源', doc.dataSource === 'import');
  check('CSV BOM + 日明细行', fs.readFileSync(csvPath, 'utf8').charCodeAt(0) === 0xFEFF && fs.readFileSync(csvPath, 'utf8').includes('张三,zhangsan,2026-09-14'));

  console.log('\n== 2. docx 块序列 ==');
  const blocks = archiver.buildDocBlocks(win, agg, records, { dataSource: 'import', groupLabel: '实验室考勤组' });
  check('首块=heading2 周标题', blocks[0].block_type === 4 && blocks[0].heading2.elements[0].text_run.content.includes('2026-09-14 ~ 2026-09-20'), JSON.stringify(blocks[0]).slice(0, 120));
  check('含口径说明', blocks.some((b) => b.text && b.text.elements[0].text_run.content.includes('末卡 − 首卡')));
  check('汇总行含总时长', blocks.some((b) => b.text && b.text.elements[0].text_run.content.includes('9小时7分钟')));
  check('每人汇总行', blocks.some((b) => b.text && b.text.elements[0].text_run.content.includes('张三（zhangsan）：2 天')));
  const detailIdx = blocks.findIndex((b) => b.block_type === 5 && b.heading3.elements[0].text_run.content.includes('打卡明细'));
  check('明细段=heading3', detailIdx > 0 && blocks[detailIdx].heading3.elements[0].text_run.content.includes('全部 3 条记录'), JSON.stringify(blocks[detailIdx] || {}).slice(0, 120));
  check('逐条记录块=3', blocks.filter((b, i) => i > detailIdx && b.text && b.text.elements[0].text_run.content.includes('张三（zhangsan）')).length === 3);

  console.log('\n== 3. 空记录 → 占位行 ==');
  const emptyBlocks = archiver.buildDocBlocks(win, report.aggregateDuration([], []), []);
  check('空记录占位', emptyBlocks.some((b) => b.text && b.text.elements[0].text_run.content.includes('本窗口无打卡记录')));

  console.log('\n== 4. wiki 节点换算（mock fetch） ==');
  const wikiCalls = [];
  global.fetch = async (url) => {
    const u = String(url);
    wikiCalls.push(u);
    if (u.includes('tenant_access_token')) return { json: async () => ({ code: 0, tenant_access_token: 't-1', expire: 7200 }) };
    if (u.includes('wiki/v2/spaces/get_node')) {
      return { json: async () => ({ code: 0, data: { node: { obj_token: 'DOCXYZ789', obj_type: 'docx' } } }) };
    }
    return { json: async () => ({ code: 0, data: {} }) };
  };
  let resolved = await archiver.resolveDocToken('WIKITOKEN123');
  check('wiki token 换算出 docx token', resolved.objToken === 'DOCXYZ789' && resolved.objType === 'docx', JSON.stringify(resolved));
  check('get_node 请求带 wiki token', wikiCalls.some((u) => u.includes('token=WIKITOKEN123')));
  const callCount = wikiCalls.length;
  resolved = await archiver.resolveDocToken('WIKITOKEN123');
  check('同 token 二次调用走缓存（无新请求）', wikiCalls.length === callCount);

  console.log('\n== 5. 换算失败回退：原样按 docx token 用 ==');
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('tenant_access_token')) return { json: async () => ({ code: 0, tenant_access_token: 't-2', expire: 7200 }) };
    return { json: async () => ({ code: 99991663, msg: 'no wiki perm' }) };
  };
  resolved = await archiver.resolveDocToken('PLAINDOCTOK');
  check('回退 objToken=原 token', resolved.objToken === 'PLAINDOCTOK' && resolved.objType === 'docx', JSON.stringify(resolved));

  console.log('\n== 6. archiveToDoc 端到端（mock：wiki 换算 + docx 追加） ==');
  global.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes('tenant_access_token')) return { json: async () => ({ code: 0, tenant_access_token: 't-3', expire: 7200 }) };
    if (u.includes('wiki/v2/spaces/get_node')) return { json: async () => ({ code: 0, data: { node: { obj_token: 'DOCXYZ789', obj_type: 'docx' } } }) };
    if (u.includes('/documents/DOCXYZ789/blocks/')) return { json: async () => ({ code: 0, data: {} }) };
    return { json: async () => ({ code: 1, msg: `unexpected ${u}` }) };
  };
  const docResult = await archiver.archiveToDoc(win, agg, records, {});
  check('追加块数=blocks.length', docResult.appended === blocks.length, `${docResult.appended} vs ${blocks.length}`);
  check('换算 objType=docx', docResult.objType === 'docx');

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
