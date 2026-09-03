/**
 * 分发引擎匹配逻辑单测（不连打印机/飞书，纯逻辑验证）
 * 用法：node test/dispatcher-test.js
 */
const assert = require('assert');

// 隔离：让 manager 保持 0 台打印机、不触发外部调用
process.env.PRINTER_HOSTS = '';

const { colorDistance, materialMatch } = require('../src/services/dispatcher');
const dispatcher = require('../src/services/dispatcher');
const config = require('../src/config');

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

// ---------- 色彩距离 ----------
check('白色 vs 米白 视为同色', () => {
  assert.ok(colorDistance('#FFFFFF', '#F2EFE9') < config.dispatch.colorDistanceThreshold);
});
check('白色 vs 黑色 距离极大', () => {
  assert.ok(colorDistance('#FFFFFF', '#000000') > config.dispatch.colorDistanceThreshold);
});
check('红色 vs 标准红 接近', () => {
  assert.ok(colorDistance('#E8261C', '#FF0000') < config.dispatch.colorDistanceThreshold);
});
check('红色 vs 橙色 不匹配', () => {
  assert.ok(colorDistance('#E8261C', '#FFA500') > config.dispatch.colorDistanceThreshold);
});
check('蓝色 vs 紫色 不匹配', () => {
  assert.ok(colorDistance('#0070C0', '#7030A0') > config.dispatch.colorDistanceThreshold);
});
check('非法 hex 返回 Infinity', () => {
  assert.ok(colorDistance('', '#FFFFFF') === Infinity);
});

// ---------- 材料匹配 ----------
check('PLA = PLA 精确匹配', () => {
  assert.equal(materialMatch('PLA', 'PLA'), 'exact');
});
check('PLA-CF 与 PLA 家族匹配', () => {
  assert.equal(materialMatch('PLA-CF', 'PLA'), 'family');
});
check('PETG 与 PLA 不匹配', () => {
  assert.ok(!materialMatch('PETG', 'PLA'));
});
check('大小写与空格归一', () => {
  assert.equal(materialMatch(' petg ', 'PETG-HF'), 'family');
});

// ---------- 选机逻辑 ----------
function fakePrinter(id, name, model, trays) {
  return {
    id, name, model,
    autoDispatch: true,
    status: '空闲',
    ams: trays.map((t, i) => ({
      slot: `AMS ${i + 1}`,
      type: t[0],
      colorHex: t[1],
      active: false,
      external: false,
    })),
  };
}

const X1C1 = fakePrinter(1, 'X1C-01', 'X1C', [['PLA', '#FFFFFF'], ['PETG', '#FF0000']]);
const X1C2 = fakePrinter(2, 'X1C-02', 'X1C', [['PLA', '#E8261C'], ['PLA', '#000000']]);
const H2D = fakePrinter(3, 'H2D', 'H2D', [['PETG', '#0070C0']]);

check('PLA×白色 → 匹配装白 PLA 的 X1C-01', () => {
  const task = { materialType: 'PLA', color: '白色' };
  assert.equal(dispatcher.matchPrinter(task, [X1C1, X1C2, H2D]).name, 'X1C-01');
});
check('PLA×红色 → 匹配装红 PLA 的 X1C-02', () => {
  const task = { materialType: 'PLA', color: '红色' };
  assert.equal(dispatcher.matchPrinter(task, [X1C1, X1C2, H2D]).name, 'X1C-02');
});
check('PETG×蓝色 → 匹配 H2D', () => {
  const task = { materialType: 'PETG', '颜色': '蓝色', color: '蓝色' };
  assert.equal(dispatcher.matchPrinter(task, [X1C1, X1C2, H2D]).name, 'H2D');
});
check('ABS 无机装载 → 匹配不到', () => {
  const task = { materialType: 'ABS', color: '白色' };
  assert.equal(dispatcher.matchPrinter(task, [X1C1, X1C2, H2D]), null);
});
check('未填材料 → 任意有料打印机', () => {
  const task = { materialType: '', color: '' };
  assert.equal(dispatcher.matchPrinter(task, [X1C1]).name, 'X1C-01');
});
check('指定打印机优先', () => {
  const task = { materialType: 'PLA', color: '白色', assignedPrinter: 'H2D' };
  assert.equal(dispatcher.matchPrinter(task, [X1C1, H2D]).name, 'H2D');
});
check('占用中的打印机不在候选（快照只传空闲）', () => {
  const printingX1C1 = { ...X1C1, status: '打印中' };
  const task = { materialType: 'PLA', color: '白色' };
  // 模拟 getAvailablePrinters 已过滤打印中的机器
  assert.equal(dispatcher.matchPrinter(task, [printingX1C1, H2D]), null);
});

// ---------- 队列排序 ----------
check('加急任务排在普通任务前', () => {
  dispatcher.queue = [
    { recordId: 'a', isUrgent: false, enqueuedAt: 100 },
    { recordId: 'b', isUrgent: true, enqueuedAt: 200 },
  ];
  dispatcher.sortQueue();
  assert.equal(dispatcher.queue[0].recordId, 'b');
  dispatcher.queue = [];
});

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
