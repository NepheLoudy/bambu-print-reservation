// 存储桩测试：成员增删校验 + 状态水位读写（全部走临时目录，不碰真实 config/）
// 运行：npm run test:store
const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

// config 在 require 时读 env，必须先设再加载
process.env.ATTENDANCE_MEMBERS_FILE = path.join(os.tmpdir(), `wecom-att-test-${Date.now()}`, 'members.json');
process.env.ATTENDANCE_STATE_FILE = path.join(os.tmpdir(), `wecom-att-test-${Date.now()}`, 'state', '.attendance-state.json');
process.env.ATTENDANCE_EXPORTS_DIR = path.join(os.tmpdir(), `wecom-att-test-${Date.now()}`, 'exports'); // runWeekly CSV 落盘也隔离到临时目录
const store = require('../src/store');

// 1) 空名单起步（文件不存在不炸）
assert.deepStrictEqual(store.loadMembers(), [], '无文件返回空名单');

// 2) add 校验
assert.ok(store.applyMembersChange({ action: 'add', userid: 'u1' }).error, 'add 缺 name 报错');
assert.ok(store.applyMembersChange({ action: 'add', name: '张三' }).error, 'add 缺 userid 报错');
assert.ok(store.applyMembersChange({}).error, '缺 action 报错');
assert.ok(store.applyMembersChange({ action: 'dance', userid: 'u1', name: '张三' }).error, '非法 action 报错');

// 3) add/remove 闭环 + 持久化
let r = store.applyMembersChange({ action: 'add', userid: 'u1', name: '张三' });
assert.strictEqual(r.list.length, 1, 'add 生效');
assert.ok(store.applyMembersChange({ action: 'add', userid: 'u1', name: '张三二' }).error, '重复 userid 报错');
r = store.applyMembersChange({ action: 'add', userid: 'u2', name: '李四' });
assert.strictEqual(r.list.length, 2, '第二个 add 生效');
assert.ok(store.applyMembersChange({ action: 'remove', userid: 'u9' }).error, 'remove 不存在报错');
r = store.applyMembersChange({ action: 'remove', userid: 'u1' });
assert.strictEqual(r.list.length, 1, 'remove 生效');

// 落盘内容与新进程读回一致（{members:[...]} 形态）
const onDisk = JSON.parse(fs.readFileSync(process.env.ATTENDANCE_MEMBERS_FILE, 'utf8'));
assert.deepStrictEqual(onDisk.members, [{ userid: 'u2', name: '李四' }], '磁盘形态 {members:[...]}');
assert.strictEqual(store.loadMembers().length, 1, '重读一致');
// push.js 守卫的 countEntries 口径：数组字段长度可数
assert.strictEqual(onDisk.members.length, 1, '守卫可按 members 数组计数');

// 4) 状态水位读写
assert.deepStrictEqual(store.loadState(), {}, '无状态文件返回空');
store.saveState({ lastSentWeekKey: '2026-09-07', lastSentAt: '2026-09-14T01:30:00.000Z', lastError: null });
assert.strictEqual(store.loadState().lastSentWeekKey, '2026-09-07', '水位读写闭环');
store.saveState({ ...store.loadState(), lastError: { weekKey: '2026-09-07', message: 'x' } });
assert.ok(store.loadState().lastError, '错误记录覆盖不丢水位');

// 5) 播报水位门控（回归 2026-09-25）：test-broadcast 补看历史周（offset>0）真发成功
//    不得回拨 lastSentWeekKey/投递快照——否则 watchdog 判当周漏播、整点重复轰炸；
//    且保存走「磁盘最新底+字段叠加」合并，不整包覆盖发送耗时窗口内的并发 import 写入
const scheduler = require('../src/scheduler');
const report = require('../src/report');
const wecom = require('../src/wecom');
const feishu = require('../src/feishu');
feishu.pickChannels = () => ({ wecom: true, feishu: false }); // 打桩通道：只走企微，发函数同样是桩
wecom.sendFile = async () => 'media_id_stub';
// 发送周报卡瞬间模拟 import 端点并发写入（count=7），复现 loadState→发送→saveState 竞态
wecom.sendMarkdownV2 = async () => { store.saveState({ ...store.loadState(), imported: { records: [], importedAt: 'concurrent-import', count: 7 } }); };
const nowMs = Date.now();
const curWin = report.weekWindow(0, nowMs, 1);
const oldWin = report.weekWindow(1, nowMs, 1);
const seedImported = (win) => ({
  records: [{ userid: 'u1', checkin_time: Math.floor((win.start + 3600 * 1000) / 1000), checkin_type: '上班打卡', exception_type: '' }],
  importedAt: 'stub',
  count: 1,
});
store.saveMembers([{ userid: 'u1', name: '张三' }]);
store.saveState({ lastSentWeekKey: curWin.key, lastSentAt: 'stub', delivery: { weekKey: curWin.key, wecomCsv: true, wecom: true } });

// runWeekly 是 async（内部有 await 让出），必须等它跑完再读盘断言
(async () => {
  // 历史周（offset=1）真发成功：水位与投递快照都不得回拨
  store.saveState({ ...store.loadState(), imported: seedImported(oldWin) });
  await scheduler.runWeekly({ offset: 1, trigger: 'stub' });
  let st = store.loadState();
  assert.strictEqual(st.lastSentWeekKey, curWin.key, '历史周播报成功不回拨水位（watchdog 不误判漏播）');
  assert.strictEqual(st.delivery.weekKey, curWin.key, '历史周播报成功不覆盖投递快照');

  // 当周（offset=0）真发成功：水位照常推进，且发送窗口内的并发 import 写入（count=7）不被旧快照回滚
  store.saveState({ ...store.loadState(), imported: seedImported(curWin), delivery: { weekKey: curWin.key } });
  await scheduler.runWeekly({ offset: 0, trigger: 'stub' });
  st = store.loadState();
  assert.strictEqual(st.lastSentWeekKey, curWin.key, '当周播报成功照常推进水位');
  assert.strictEqual(st.delivery.weekKey, curWin.key, '当周投递快照保留');
  assert.ok(st.imported && st.imported.count === 7, '合并保存不回滚发送窗口内的并发 import 写入');

  console.log('✓ stub-test-store 全部通过（成员校验/持久化/水位/水位门控 21 组断言）');
})().catch((e) => { console.error(e); process.exit(1); });
