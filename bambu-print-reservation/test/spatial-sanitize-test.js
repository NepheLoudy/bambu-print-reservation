/**
 * spatial 标注净化单测（纯逻辑）：白名单字段/封顶/坏数据丢弃。
 * 用法：node test/spatial-sanitize-test.js
 */
const assert = require('assert');
const { sanitizeSpatial } = require('../src/utils/spatialSanitize');
const { SLICED_EXT_RE, isSlicedFileName, isUnslicedFileName } = require('../src/utils/fileTypes');

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    failures++;
    console.error(`✗ ${name} — ${err.message}`);
  }
}

check('load 标注保留白名单字段', () => {
  const out = sanitizeSpatial([{
    tool: 'load', type: 'load', loadType: 'bending',
    pos: [1.234, 2, 3], dir: [0, 0, -1], loadNature: 'fatigue', loadMagnitude: 'heavy',
    hacker: 'x', extra: { a: 1 },
  }]);
  assert.strictEqual(out.length, 1);
  assert.deepStrictEqual(out[0], {
    tool: 'load', type: 'load', loadType: 'bending',
    pos: [1.23, 2, 3], dir: [0, 0, -1], loadNature: 'fatigue', loadMagnitude: 'heavy',
  });
});

check('load 坏受力类型整条丢弃', () => {
  const out = sanitizeSpatial([{ tool: 'load', type: 'load', loadType: '切她', pos: [1, 2, 3], dir: [0, 0, 1] }]);
  assert.deepStrictEqual(out, []);
});

check('axis/region/circle/point 各形态保留', () => {
  const out = sanitizeSpatial([
    { tool: 'bending_zone', type: 'axis', a: [0, 0, 0], b: [10, 0, 0], dir: [0, 1, 0] },
    { tool: 'support_need', type: 'region', faces: [1, 2, 3], normal: [0, 0, 1] },
    { tool: 'hole_rim', type: 'circle', c: [1, 1, 1], n: [0, 0, 1], r: 2.5 },
    { tool: 'pin', type: 'point', pos: [5, 5, 5], face: 7 },
  ]);
  assert.strictEqual(out.length, 4);
  assert.strictEqual(out[2].r, 2.5);
  assert.deepStrictEqual(out[3].pos, [5, 5, 5]);
});

check('条数封顶 200', () => {
  const many = Array.from({ length: 500 }, (_, i) => ({ tool: 'pin', type: 'point', pos: [i, 0, 0] }));
  assert.strictEqual(sanitizeSpatial(many).length, 200);
});

check('faces 负数过滤', () => {
  const out = sanitizeSpatial([{ tool: 'support_need', type: 'region', faces: [1, -2, 3] }]);
  assert.deepStrictEqual(out[0].faces, [1, 3]);
});

check('非数组/无 tool 丢弃', () => {
  assert.deepStrictEqual(sanitizeSpatial('not-array'), []);
  assert.deepStrictEqual(sanitizeSpatial([{ type: 'point', pos: [1, 1, 1] }]), []);
});

// ---------- fileTypes 合一（v56） ----------
check('切片产物口径：3mf + gcode 系', () => {
  for (const f of ['a.3mf', 'b.GCODE', 'c.gx', 'd.g']) assert.ok(isSlicedFileName(f), f);
  for (const f of ['a.stl', 'b.step', 'c.stp', 'd.obj', 'e.3mfx']) assert.ok(isUnslicedFileName(f), f);
  assert.ok(SLICED_EXT_RE.test('x.g'));
});

process.exit(failures ? 1 : 0);
