/**
 * 分发引擎状态持久化往返测试（2026-09-13 口径：重启不丢队列）
 * 覆盖：落盘→重载恢复（队列/打印中/已知/完成计数）、known 截尾、损坏文件按空启动。
 * 用法：node test/dispatcher-persist-test.js（全通过退出码 0）
 */
const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

// 隔离：0 台打印机、禁广场写表；状态文件指向临时目录（必须在 require 前设置）
process.env.PLAZA_BITABLE_TABLE_ID = '';
process.env.PRINTER_HOSTS = '';
const STATE_FILE = path.join(os.tmpdir(), `dispatch-state-test-${Date.now()}.json`);
process.env.DISPATCH_STATE_FILE = STATE_FILE;

const DISPATCHER_PATH = require.resolve('../src/services/dispatcher');
const dispatcher = require('../src/services/dispatcher');

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

/** 模拟重启：清 require 缓存重新加载单例 */
function freshDispatcher() {
  delete require.cache[DISPATCHER_PATH];
  return require('../src/services/dispatcher');
}

// ---------- 1. 构造状态 → 落盘 → 重载恢复 ----------
dispatcher.known = new Set(['r1', 'r2']);
dispatcher.queue = [
  { recordId: 'r1', applicationNo: '2026A', materialType: 'PLA', color: '红', isUrgent: true, applicant: { name: '甲' }, enqueuedAt: 1000 },
  { recordId: 'r2', applicationNo: '2026B', materialType: 'PETG', color: '黑', applicant: { name: '乙' } },
];
dispatcher.printing = new Map([[1, { recordId: 'r3', applicationNo: '2026C', fileName: 'x.3mf', startedAt: 2000 }]]);
dispatcher.completedCount = new Map([[1, 5]]);
dispatcher.flushState();

check('落盘文件已生成', () => assert.ok(fs.existsSync(STATE_FILE)));

const d2 = freshDispatcher();
d2.restoreState();
check('恢复：队列 2 条且加急在前数据一致', () => {
  assert.equal(d2.queue.length, 2);
  assert.equal(d2.queue[0].recordId, 'r1');
  assert.equal(d2.queue[0].isUrgent, true);
});
check('恢复：打印中映射（printerId=1 → r3）', () => {
  const t = d2.printing.get(1);
  assert.ok(t && t.recordId === 'r3' && t.startedAt === 2000);
});
check('恢复：known 含全部 recordId（含打印中）', () => {
  assert.ok(d2.known.has('r1') && d2.known.has('r2') && d2.known.has('r3'));
});
check('恢复：完成计数保留', () => assert.equal(d2.completedCount.get(1), 5));

// ---------- 2. known 截尾（防无限增长） ----------
d2.known = new Set(Array.from({ length: 3000 }, (_, i) => `old_${i}`));
d2.flushState();
const d3 = freshDispatcher();
d3.restoreState();
check('known 超 2000 条截尾保存（保留最新段，活动任务回加）', () => {
  assert.ok(d3.known.size <= 2003); // 保存截尾 2000 + 恢复时队列 2 + 打印中 1 回加
  assert.ok(d3.known.has('old_2999')); // 最新的保留
  assert.ok(!d3.known.has('old_0'));   // 最旧的截掉
  assert.ok(d3.known.has('r1') && d3.known.has('r3')); // 活动任务 id 由恢复逻辑回加
});

// ---------- 3. 损坏文件 → 按空启动不抛 ----------
fs.writeFileSync(STATE_FILE, '{broken json!!');
const d4 = freshDispatcher();
d4.restoreState();
check('损坏状态文件按空队列启动', () => {
  assert.equal(d4.queue.length, 0);
  assert.equal(d4.printing.size, 0);
  assert.equal(d4.known.size, 0);
});

// ---------- 4. 文件缺失 → 静默跳过 ----------
fs.unlinkSync(STATE_FILE);
const d5 = freshDispatcher();
d5.restoreState();
check('状态文件缺失时静默跳过', () => assert.equal(d5.queue.length, 0));

try { fs.unlinkSync(STATE_FILE); } catch { /* 已删 */ }

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
