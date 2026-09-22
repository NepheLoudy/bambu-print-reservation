/**
 * 正经活跃口径 stub 测试（2026-09-22 活跃口径修正，不触飞书/离线可跑）：
 * - 娱乐功能（抽奖/关键词回答，含静态与 fun:1 上报标记）不计入 seriousActiveUsers；
 * - 抽奖 learn:[触发词] 学进 funCmds，'/触发词' 的路由层记录按娱乐剔除（/lottery 静态同理）；
 * - activeUsers（机器人交互全量口径，网关日活跃表同源）不受影响；
 * - 旧数据（无按人归因 f）按全量正经处理，不回溯剔除。
 * 跑法：node scripts/stub-test-usage-serious.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.GATEWAY_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-usage-serious-'));
const usage = require('../src/usage');

// 今日记录：正经指令 / 娱乐-only / 混合 / 静态娱乐指令 / 归因正经功能
usage.recordMessage({ senderId: 'ou_serious', feature: '/print-status' });
usage.recordMessage({ senderId: 'ou_serious', feature: '私聊对话' });
usage.recordFeature({ senderId: 'ou_funonly', feature: '抽奖', fun: 1 });
usage.recordFeature({ senderId: 'ou_funonly', feature: '关键词回答', fun: 1 });
usage.recordFeature({ senderId: 'ou_funonly', feature: '抽奖', learn: ['锦鲤', 'Big Draw'] });
usage.recordMessage({ senderId: 'ou_funonly', feature: '/锦鲤' }); // 路由层记录，靠学习清单归为娱乐
usage.recordMessage({ senderId: 'ou_mix', feature: '/ddl' });
usage.recordFeature({ senderId: 'ou_mix', feature: '抽奖', fun: 1, learn: ['锦鲤'] });
usage.recordFeature({ senderId: 'ou_ddl', feature: 'DDL确认' });
usage.recordMessage({ senderId: 'ou_gacha', feature: '/lottery' }); // 静态娱乐指令

// 20 天前旧数据（按人归因 f 尚未上线的形态）：按全量正经处理
const pad = (n) => String(n).padStart(2, '0');
const d = new Date(Date.now() - 20 * 86400000);
usage.getAllDays()[`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`] =
  { total: 2, users: { ou_legacy: { c: 2, last: 0 } }, feats: { 私聊对话: 2 } };

const byId = (list, id) => list.find((u) => u.id === id);
const agg = usage.aggregate(30);

assert.strictEqual(agg.activeUsers, 6, 'activeUsers=交互全量口径不剔（serious/funonly/mix/ddl/gacha/legacy）');
assert.strictEqual(agg.seriousActiveUsers, 4, 'seriousActiveUsers 剔掉 funonly 与 gacha');
assert.ok(byId(agg.seriousUsers, 'ou_serious'), '正经用户在 seriousUsers');
assert.ok(byId(agg.seriousUsers, 'ou_legacy'), '旧数据用户按全量正经保留');
assert.strictEqual(byId(agg.seriousUsers, 'ou_funonly'), undefined, '纯娱乐用户不在 seriousUsers');
assert.strictEqual(byId(agg.seriousUsers, 'ou_gacha'), undefined, '/lottery 静态娱乐不计活跃');
assert.strictEqual(byId(agg.users, 'ou_funonly').count, 4, '纯娱乐用户交互计数全量保留');
assert.strictEqual(byId(agg.users, 'ou_funonly').seriousCount, 0, "纯娱乐 seriousCount=0（含 '/锦鲤' 学习识别）");
assert.strictEqual(byId(agg.users, 'ou_mix').count, 2, '混合用户全量计数');
assert.strictEqual(byId(agg.users, 'ou_mix').seriousCount, 1, '混合用户只剔娱乐命中');
assert.strictEqual(byId(agg.users, 'ou_legacy').seriousCount, 2, '旧数据用户 seriousCount=全量');

const today = usage.aggregate(1);
assert.strictEqual(today.activeUsers, 5, '1 天窗口不含旧数据用户');
assert.strictEqual(today.seriousActiveUsers, 3, '1 天窗口正经活跃=serious/mix/ddl');

console.log('全部通过 ✅（正经活跃口径：娱乐剔除/学习清单/静态清单/旧数据兼容/双口径并存）');
process.exit(0);
