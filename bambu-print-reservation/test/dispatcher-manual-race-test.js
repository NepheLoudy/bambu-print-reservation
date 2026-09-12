/**
 * 分发互斥闸门测试（2026-09-13 竞态修复回归）：
 *   人工指定与自动匹配的分钟级 TOCTOU——dispatch 是下载/上传/下发的 await 链，
 *   printing 占用登记在链尾；无闸门时两路会对同一台打印机双双下发。
 *   验证：①分发中打印机对自动匹配不可见 ②并发 dispatch 第二路立即拒绝
 *        ③manualDispatch 分发中判定 ④链路完成后闸门释放、排队任务可继续分发。
 * 用法：node test/dispatcher-manual-race-test.js（全通过退出码 0）
 */
process.env.PLAZA_BITABLE_TABLE_ID = '';
process.env.PRINTER_HOSTS = '';
process.env.QUIET_HOURS_DISABLED = '1';

const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..');

// ---- 桩：外部依赖全部走桩，下载用可控 deferred 模拟分钟级 await 链 ----
const calls = { uploads: [], starts: [] };
let downloadGate = null; // { promise, resolve }
const PRINTER = { id: 1, name: 'P1', autoDispatch: true, status: '空闲', ams: [{ type: 'PLA', colorHex: '#FF0000' }] };
let availablePrinters = [PRINTER];

const stubs = {
  [path.join(ROOT, 'src/feishu/bitable.js')]: {
    updateRecord: async () => ({}),
    getAllRecords: async () => [],
  },
  [path.join(ROOT, 'src/feishu/client.js')]: {
    downloadFile: async () => Buffer.from('x'),
    downloadApprovalAttachment: () => downloadGate.promise,
  },
  [path.join(ROOT, 'src/feishu/bot.js')]: {
    sendMessage: async () => ({}),
    buildJobStartCard: () => ({}),
    buildJobFailedCard: () => ({}),
    buildQueueCard: () => ({}),
    buildMaterialMissingCard: () => ({}),
  },
  [path.join(ROOT, 'src/utils/quietHours.js')]: {
    gatePayload: () => false,
    gateTask: () => false,
  },
  [path.join(ROOT, 'src/printer/manager.js')]: {
    getAvailablePrinters: () => availablePrinters,
    getAllPrinterStates: () => availablePrinters,
    getPrinterState: () => PRINTER,
    uploadFileToPrinter: async (id, buffer, remoteName) => { calls.uploads.push({ id, remoteName }); },
    startProjectOnPrinter: async (id, remoteName) => { calls.starts.push({ id, remoteName }); },
    updateState: () => {},
    stopPrintOnPrinter: async () => ({}),
    on: () => {},
  },
  [path.join(ROOT, 'src/services/plaza.js')]: { append: () => {} },
};

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request.startsWith('.') && parent?.filename) {
    const abs = path.resolve(path.dirname(parent.filename), request);
    for (const key of Object.keys(stubs)) {
      if (abs === key || abs === key.replace(/\.js$/, '')) return key;
    }
  }
  return origResolve.call(this, request, parent, ...rest);
};
for (const [key, value] of Object.entries(stubs)) {
  require.cache[key] = new Module(key, null);
  require.cache[key].exports = value;
  require.cache[key].loaded = true;
}

const dispatcher = require(path.join(ROOT, 'src/services/dispatcher.js'));

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
}

function taskOf(rid, appNo) {
  return { recordId: rid, applicationNo: appNo, materialType: 'PLA', color: '红', fileSource: 'approval', fileToken: `tok_${rid}` };
}

(async () => {
  console.log('\n== 1. 分发中的打印机：闸门关闭 + 自动匹配不可见 ==');
  downloadGate = (() => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; })();
  const taskA = taskOf('rA', '2026A');
  const inFlight = dispatcher.dispatch(taskA, PRINTER);
  check('闸门已关闭（dispatching 含打印机）', dispatcher.dispatching.has(1));

  const taskB = taskOf('rB', '2026B');
  dispatcher.queue.push(taskB);
  await dispatcher.match('race-test');
  check('自动匹配跳过分发中打印机（任务仍在队，无第二次上传）',
    dispatcher.queue.some((t) => t.recordId === 'rB') && calls.uploads.length === 0,
    JSON.stringify({ queue: dispatcher.queue.map((t) => t.recordId), uploads: calls.uploads.length }));

  console.log('\n== 2. 并发 dispatch 第二路立即拒绝（不排队不上传） ==');
  let secondErr = '';
  try {
    await dispatcher.dispatch(taskOf('rC', '2026C'), PRINTER);
  } catch (err) { secondErr = err.message; }
  check('第二路 dispatch 抛「正在有任务分发中」', secondErr.includes('正在有任务分发中'), secondErr);
  check('被拒任务未离开队列（重试由后续触发）', !dispatcher.queue.some((t) => t.recordId === 'rC'));

  console.log('\n== 3. manualDispatch 分发中判定 ==');
  let manualErr = '';
  try {
    await dispatcher.manualDispatch('rB', 'P1');
  } catch (err) { manualErr = err.message; }
  check('manualDispatch 抛「正在有任务分发中」', manualErr.includes('正在有任务分发中'), manualErr);

  console.log('\n== 4. 链路完成：闸门释放，排队任务继续分发 ==');
  downloadGate.resolve(Buffer.from('file'));
  await inFlight;
  check('首任务完成占用登记', dispatcher.printing.get(1)?.recordId === 'rA');
  // 释放打印机（完成事件模拟）后 match 应把 rB 分发出去
  dispatcher.printing.delete(1);
  await dispatcher.match('race-test-after');
  check('闸门释放后排队任务正常分发（rB 上传）',
    calls.uploads.some((u) => u.remoteName === 'print_rB.3mf') && !dispatcher.queue.some((t) => t.recordId === 'rB'),
    JSON.stringify({ uploads: calls.uploads, queue: dispatcher.queue.map((t) => t.recordId) }));
  check('闸门最终清空', dispatcher.dispatching.size === 0);

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((err) => {
  console.error('测试执行异常:', err);
  process.exit(1);
});
