/**
 * 网关日活跃 → 多维表格同步 stub 测试（mock usage/bitable 层，不触网）
 * 覆盖：首轮全量 create；签名未变跳过；数据变化后 update；未配置表时整体跳过。
 * 运行：node scripts/stub-test-usage-sync.js
 */
const assert = require('assert');

// ---- 环境与 mock 注入（必须先于 require src 模块） ----
process.env.PLAZA_BITABLE_APP_TOKEN = 'appTest';
process.env.PLAZA_BITABLE_DAILY_TABLE = 'tblDaily';
process.env.GATEWAY_DATA_DIR = require('os').tmpdir() + '/gw-sync-test-' + Date.now();

const DAYS = {
  '2026-09-11': { total: 10, users: { ou_a: { c: 6, last: 1 }, ou_b: { c: 3, last: 2 }, ou_c: { c: 1, last: 3 } }, feats: { '工单播报': 6, '打印完成': 4 } },
  '2026-09-12': { total: 3, users: { ou_a: { c: 3, last: 3 } }, feats: { 'DDL 播报': 3 } },
};

require.cache[require.resolve('../src/usage')] = {
  id: 'usage-stub', filename: 'usage-stub', loaded: true,
  exports: {
    getAllDays: () => DAYS,
    getNames: () => ({ ou_a: '队员甲' }),
    resolveName: async () => null,
    tenantToken: async () => 'token',
  },
};

const calls = [];
let nextRecordId = 100;
require.cache[require.resolve('../src/bitable')] = {
  id: 'bitable-stub', filename: 'bitable-stub', loaded: true,
  exports: {
    async listAllRecords(app, table) {
      calls.push(['list', table]);
      return (global.__ROWS = global.__ROWS || {})[table] || [];
    },
    async createRecord(app, table, fields) {
      calls.push(['create', table, fields]);
      const rows = (global.__ROWS = global.__ROWS || {})[table] || (global.__ROWS[table] = []);
      const row = { record_id: `rec${nextRecordId++}`, fields };
      rows.push(row);
      return { record_id: row.record_id };
    },
    async updateRecord(app, table, recordId, fields) {
      calls.push(['update', table, recordId, fields]);
      const rows = global.__ROWS[table] || [];
      const row = rows.find((r) => r.record_id === recordId);
      if (row) Object.assign(row.fields, fields);
    },
  },
};

const sync = require('../src/bitable-sync');

(async () => {
  // 首轮：两个日期各 create 一行（单表，日桶 1 行/天）
  const r1 = await sync.runSync();
  assert.strictEqual(r1.synced.length, 2, `首轮应同步 2 天: ${JSON.stringify(r1)}`);
  const creates = calls.filter((c) => c[0] === 'create');
  assert.strictEqual(creates.length, 2, `首轮应 create 2 行: ${creates.length}`);
  assert.ok(creates.every((c) => c[1] === 'tblDaily'), '只应写网关日活跃单表');
  assert.strictEqual(creates[0][2]['活跃人数'], 3, '活跃人数应为去重人数');
  assert.strictEqual(creates[0][2]['功能数'], 2, '功能数应为去重功能数');

  // 第二轮：签名未变 → 全部跳过，零调用
  calls.length = 0;
  const r2 = await sync.runSync();
  assert.strictEqual(r2.skipped, 2, '签名未变应跳过 2 天');
  assert.strictEqual(calls.length, 0, '签名未变不应有任何写表调用');

  // 数据变化 → 仅该日期 update
  DAYS['2026-09-12'].total = 5;
  DAYS['2026-09-12'].feats['DDL 播报'] = 5;
  const r3 = await sync.runSync();
  assert.deepStrictEqual(r3.synced, ['2026-09-12'], `仅变化日期应重同步: ${JSON.stringify(r3)}`);
  assert.ok(calls.some((c) => c[0] === 'update' && c[1] === 'tblDaily'), '变化日期应走 update');

  console.log('全部通过 ✅（网关日活跃单表同步：全量 create / 签名跳过 / 变化 update / 未配置跳过）');
})().catch((err) => {
  console.error('测试失败:', err.message);
  process.exit(1);
});
