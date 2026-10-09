/**
 * 离线桩测试 · 生产启动接线（2026-10-10 回归）：
 *   v37 退役 startEventSubscription() 时把 dispatcher.start() 一并弄丢——分发引擎
 *   此后在生产从未启动：队列恢复、jobEvent 完成收尾/失败重排/份数续打、printing
 *   幽灵巡检、退出冲刷全部为死代码；且被「真机未接入 + 十套桩测试直调内部方法、
 *   不经过 start()」双重掩盖。本测试以生产入口 startServer() 为准，断言引擎确实
 *   随启动接线（队列恢复 / 幽灵巡检定时器 / 退出冲刷钩子）。
 * 全程离线：0 台打印机、广场停写、状态/积压/备份文件指向临时目录、PORT=0 临时端口。
 * 用法：node test/bootstrap-test.js
 */
const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

// 隔离（必须在 require 前设置）
process.env.PLAZA_BITABLE_TABLE_ID = '';
process.env.PRINTER_HOSTS = '';
process.env.PORT = '0';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bambu-bootstrap-'));
const STATE_FILE = path.join(TMP, 'dispatch-state.json');
process.env.DISPATCH_STATE_FILE = STATE_FILE;
process.env.QUIET_BACKLOG_FILE = path.join(TMP, 'quiet-backlog.json');
process.env.BACKUP_DIR = path.join(TMP, 'backup');

// 预置一份分发状态：验证 startServer → dispatcher.start() → restoreState 链路真实生效
fs.writeFileSync(STATE_FILE, JSON.stringify({
  savedAt: new Date().toISOString(),
  queue: [{ recordId: 'r1', applicationNo: '2026A', materialType: 'PLA', color: '红', isUrgent: true, applicant: { name: '甲' }, enqueuedAt: 1000 }],
  inFlight: [],
  printing: [],
  completedCount: [],
  known: ['r1'],
  givenUp: [],
}, null, 2));

const app = require('../src/index');
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

const server = app.startServer();

check('startServer 已导出（桩测试/运维脚本可用）', () => {
  assert.equal(typeof app.startServer, 'function');
});
check('分发引擎已随启动接线：队列从落盘恢复', () => {
  assert.equal(dispatcher.queue.length, 1, JSON.stringify(dispatcher.queue));
  assert.equal(dispatcher.queue[0].recordId, 'r1');
});
check('分发引擎已随启动接线：printing 幽灵巡检定时器已建', () => {
  assert.ok(dispatcher.staleTimer, 'staleTimer 未建立——start() 未被调用（v37 回归复现）');
});
check('分发引擎已随启动接线：退出冲刷钩子已挂', () => {
  assert.equal(dispatcher.exitHooked, true);
});
check('启动后监听临时端口（PORT=0 不与本地服务冲突）', () => {
  assert.ok(server.listening || server.address(), 'server 未进入监听态');
});

clearInterval(dispatcher.staleTimer);
if (dispatcher.timer) clearInterval(dispatcher.timer);
server.close();
fs.rmSync(TMP, { recursive: true, force: true });
console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
