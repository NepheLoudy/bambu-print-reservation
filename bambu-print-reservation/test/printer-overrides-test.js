/**
 * 料信息手动覆盖单测（2026-10-17）：纯函数合并 + 文件持久化/清除语义
 * 用法：node test/printer-overrides-test.js
 */
const os = require('os');
const path = require('path');
const fs = require('fs');
process.env.PRINTER_OVERRIDES_FILE = path.join(os.tmpdir(), `bambu-test-overrides-${process.pid}.json`);
fs.existsSync(process.env.PRINTER_OVERRIDES_FILE) && fs.unlinkSync(process.env.PRINTER_OVERRIDES_FILE);
const assert = require('assert');

let pass = 0;
let failures = 0;
function check(name, fn) {
  try {
    fn();
    pass++;
    console.log(`✓ ${name}`);
  } catch (err) {
    failures++;
    console.error(`✗ ${name} — ${err.message}`);
  }
}

const ov = require('../src/services/printerOverrides');

check('纯函数：命中覆盖替换字段并打标（null 字段保留原值）', () => {
  const trays = [
    { slot: 'AMS 0', type: 'PLA', colorHex: 'FF0000' },
    { slot: 'AMS 1', type: 'PETG', colorHex: '00FF00' },
  ];
  const merged = ov.applyOverrides(trays, { 'AMS 0': { type: 'PLA-CF', colorHex: null } });
  assert.strictEqual(merged[0].type, 'PLA-CF');
  assert.strictEqual(merged[0].colorHex, 'FF0000', 'colorHex 为 null 时应保留上报原值');
  assert.strictEqual(merged[0].overridden, true);
  assert.strictEqual(merged[1].overridden, undefined, '未覆盖槽不得打标');
});

check('纯函数：空覆盖/空数组原样返回', () => {
  const trays = [{ slot: '外挂料盘·左', type: '', colorHex: '' }];
  assert.deepStrictEqual(ov.applyOverrides(trays, {}), trays);
  assert.deepStrictEqual(ov.applyOverrides(null, {}), []);
});

check('持久化：写入→读回→清字段→删整槽', () => {
  ov.setFor(2, '外挂料盘·左', { type: 'TPU', colorHex: '112233' });
  let got = ov.getFor(2);
  assert.strictEqual(got['外挂料盘·左'].type, 'TPU');
  assert.strictEqual(got['外挂料盘·左'].colorHex, '112233');
  ov.setFor(2, '外挂料盘·左', { colorHex: null });
  got = ov.getFor(2);
  assert.strictEqual(got['外挂料盘·左'].colorHex, undefined, '单字段 null 应删除该字段');
  assert.strictEqual(got['外挂料盘·左'].type, 'TPU');
  ov.setFor(2, '外挂料盘·左', { type: null });
  assert.deepStrictEqual(ov.getFor(2), {}, '两项清空后整槽覆盖应删除');
  assert.ok(fs.existsSync(process.env.PRINTER_OVERRIDES_FILE), '覆盖应落盘为 JSON 文件');
  fs.unlinkSync(process.env.PRINTER_OVERRIDES_FILE);
});

console.log(`\n料信息覆盖单测: ${pass} 通过 / ${failures} 失败`);
process.exit(failures ? 1 : 0);
