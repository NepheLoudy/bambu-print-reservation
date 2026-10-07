// 本地存储桩测试：名单增删校验 / state 读写 / 损坏文件报错（env 指向临时目录）
// 运行：node scripts/stub-test-store.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zk-store-'));
process.env.ZK_ATT_MEMBERS_FILE = path.join(tmp, 'config', 'members.json');
process.env.ZK_ATT_STATE_FILE = path.join(tmp, 'state', '.zklink-attendance-state.json');

const store = require('../src/store');

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.error(`  ✗ ${name} — ${extra}`); }
}

console.log('\n== 1. 名单：空 → 增 → 查 ==');
check('无文件 loadMembers=[]', store.loadMembers().length === 0);
let r = store.applyMembersChange({ action: 'add', userid: 'zhangsan', name: '张三' });
check('add 成功', !r.error && r.list.length === 1, JSON.stringify(r));
check('落盘为 {members:[...]} 包装', JSON.parse(fs.readFileSync(process.env.ZK_ATT_MEMBERS_FILE, 'utf8')).members.length === 1);
r = store.applyMembersChange({ action: 'add', userid: 'zhangsan', name: '重复' });
check('重复 userid 拒绝', !!r.error && r.error.includes('已在名单中'), r.error);
r = store.applyMembersChange({ action: 'add', userid: 'noname' });
check('add 缺 name 拒绝', !!r.error && r.error.includes('name 必填'), r.error);
r = store.applyMembersChange({ action: 'add', userid: '', name: '空id' });
check('空 userid 拒绝', !!r.error && r.error.includes('userid 必填'), r.error);
r = store.applyMembersChange({ action: 'toggle', userid: 'zhangsan' });
check('非法 action 拒绝', !!r.error && r.error.includes('add 或 remove'), r.error);
r = store.applyMembersChange({ action: 'remove', userid: 'ghost' });
check('remove 不存在者报错', !!r.error && r.error.includes('不在名单中'), r.error);
r = store.applyMembersChange({ action: 'remove', userid: 'zhangsan' });
check('remove 成功归零', !r.error && r.list.length === 0);

console.log('\n== 2. state 读写往返 ==');
store.saveState({ lastSentWeekKey: '2026-09-14', delivery: { weekKey: '2026-09-14', feishu: true } });
const st = store.loadState();
check('水位往返', st.lastSentWeekKey === '2026-09-14' && st.delivery.feishu === true, JSON.stringify(st));

console.log('\n== 3. 损坏文件 → 抛错（健康检查降级路径的依赖行为） ==');
fs.writeFileSync(process.env.ZK_ATT_STATE_FILE, '{broken json');
let threw = false;
try { store.loadState(); } catch { threw = true; }
check('损坏 state 抛错', threw);
fs.writeFileSync(process.env.ZK_ATT_MEMBERS_FILE, '{broken');
threw = false;
try { store.loadMembers(); } catch { threw = true; }
check('损坏名单抛错', threw);

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
