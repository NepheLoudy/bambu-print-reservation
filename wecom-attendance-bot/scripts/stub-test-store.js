// 存储桩测试：成员增删校验 + 状态水位读写（全部走临时目录，不碰真实 config/）
// 运行：npm run test:store
const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

// config 在 require 时读 env，必须先设再加载
process.env.ATTENDANCE_MEMBERS_FILE = path.join(os.tmpdir(), `wecom-att-test-${Date.now()}`, 'members.json');
process.env.ATTENDANCE_STATE_FILE = path.join(os.tmpdir(), `wecom-att-test-${Date.now()}`, 'state', '.attendance-state.json');
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

console.log('✓ stub-test-store 全部通过（成员校验/持久化/水位 12 组断言）');
