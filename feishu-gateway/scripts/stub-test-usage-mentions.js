/**
 * 群聊被@统计 stub 测试（2026-09-24 团队负载算法数据源，不触飞书/离线可跑）：
 * - 普通成员每 @ 一人次计一（同消息多人各计一次）；
 * - @机器人（self/app/bot/@_bot_*）与 @所有人（@_everyone）不计；
 * - 私聊不计（chat_type !== 'group'）；
 * - mention id 对象形态（{open_id}）兼容取值；
 * - mention 自带姓名进 names 缓存，聚合输出带名字；
 * - 滑窗聚合（?days=N）按人求和降序；
 * - 旧 stats 文件无 mentions 键时自动补 {}（向后兼容）；
 * - prune 同窗清理（>30 天的被@桶删除）。
 * 跑法：node scripts/stub-test-usage-mentions.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.GATEWAY_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-usage-mentions-'));
const usage = require('../src/usage');

// —— 计数形态 ——
usage.recordMentions({
  chat_type: 'group',
  mentions: [
    { key: '@_user_1', id: 'ou_a', name: '张三' },
    { key: '@_user_2', id: 'ou_b', name: '李四' },
  ],
});
usage.recordMentions({
  chat_type: 'group',
  mentions: [
    { key: '@_user_1', id: 'ou_a', name: '张三' }, // 再@张三一次 → 2
    { key: '@_bot_1', id: 'self', mentioned_type: 'app' }, // @机器人不计
    { key: '@_bot_2', id: { open_id: 'ou_bot' }, mentioned_type: 'bot' }, // @机器人对象形态不计
    { key: '@_everyone', id: 'all' }, // @所有人不计
  ],
});
usage.recordMentions({ chat_type: 'p2p', mentions: [{ key: '@_user_1', id: 'ou_a', name: '张三' }] }); // 私聊不计
usage.recordMentions({ chat_type: 'group' }); // 无 mentions 字段不炸不计
usage.recordMentions(null); // 空消息防御

// 对象形态的普通成员 id（个别事件形态）：兼容取 open_id
usage.recordMentions({ chat_type: 'group', mentions: [{ key: '@_user_3', id: { open_id: 'ou_c' }, name: '王五' }] });

// —— 历史桶 + 滑窗 ——
const pad = (n) => String(n).padStart(2, '0');
const dayKey = (offsetDays) => {
  const d = new Date(Date.now() - offsetDays * 86400000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
// 直接注历史桶：10 天前 ou_a 3 次（默认 7 天窗外）、5 天前 ou_b 7 次（窗内）
usage.getAllMentions()[dayKey(10)] = { ou_a: 3 };
usage.getAllMentions()[dayKey(5)] = { ou_b: 7 };

const byId = (list, id) => list.find((u) => u.id === id);

const agg7 = usage.aggregateMentions(7); // 默认窗
assert.strictEqual(byId(agg7.users, 'ou_a').count, 2, '普通成员被@计数（当日 2 次，窗外历史不计）');
assert.strictEqual(byId(agg7.users, 'ou_b').count, 7 + 1, '跨桶求和（今日 1 次 + 5 天前 7 次）');
assert.strictEqual(byId(agg7.users, 'ou_c').count, 1, '对象形态 id 取 open_id 计数');
assert.ok(!agg7.users.some((u) => u.id === 'ou_bot' || u.id === 'all' || u.id === 'self'), '@机器人/@所有人/私聊不产生计数');
assert.strictEqual(byId(agg7.users, 'ou_a').name, '张三', 'mention 自带姓名进 names 缓存');
assert.ok(agg7.users[0].count >= agg7.users[agg7.users.length - 1].count, '聚合输出按次数降序');
assert.strictEqual(agg7.days, 7, '响应带窗口天数');

const agg30 = usage.aggregateMentions(30); // 放宽到 30 天 → 10 天前的 ou_a 也计入
assert.strictEqual(byId(agg30.users, 'ou_a').count, 2 + 3, '30 天窗含 10 天前历史桶');
assert.strictEqual(usage.aggregateMentions(999).days, 30, '窗口 clamp 到 30 天');
assert.strictEqual(usage.aggregateMentions(0).days, 1, '窗口下限 1 天');

// —— prune 同窗清理（注入足量旧桶超过 30 天上限，触发清理） ——
for (let i = 3; i <= 45; i++) {
  if (i === 5 || i === 10) continue; // 已有桶不覆盖
  usage.getAllMentions()[dayKey(i)] = { ou_z: 1 };
}
usage.recordMentions({ chat_type: 'group', mentions: [{ key: '@_user_1', id: 'ou_a', name: '张三' }] });
const kept = Object.keys(usage.getAllMentions()).sort();
assert.ok(!kept.includes(dayKey(45)) && kept.length <= 30, '被@桶随 prune 同窗清理（>30 天删除）');

console.log('全部通过 ✅');
process.exit(0);
