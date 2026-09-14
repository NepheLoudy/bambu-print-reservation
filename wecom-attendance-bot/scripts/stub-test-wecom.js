// 企微客户端桩测试（纯函数，不联网）：分批/去重 + 错误码提示 + 无配置可安全加载
// 运行：npm run test:wecom
const assert = require('assert');

// 无企微凭据时模块也必须能加载（本地开发/CI 无 .env 密钥）
const wecom = require('../src/wecom');

// 1) 分批：去重、去空、每批 ≤100、205 个 → 3 批（100+100+5，跨批边界）
const ids = [];
for (let i = 0; i < 205; i++) ids.push(`user${i}`);
ids.push('user0', 'user1', ''); // 重复+空串
const batches = wecom.partitionUserids(ids);
assert.strictEqual(batches.length, 3, '205 个去重后 id 分 3 批');
assert.ok(batches.every((b) => b.length <= 100), '每批 ≤100（官方接口上限）');
assert.strictEqual(batches[2].length, 5, '尾批 5 个');
assert.strictEqual(batches[0][0], 'user0', '保序');
assert.deepStrictEqual([].concat(...batches).length, 205, '去重后总数 205');

// 2) 小名单单批
assert.strictEqual(wecom.partitionUserids(['a', 'b']).length, 1, '小名单 1 批');
assert.strictEqual(wecom.partitionUserids([]).length, 0, '空名单 0 批');

// 3) 错误码处理提示（拉数失败时负责人能照着自救）
assert.ok(wecom.describeErrcode(60020).includes('可信IP'), '60020 提示可信 IP');
assert.ok(wecom.describeErrcode(60011).includes('打卡'), '60011 提示打卡授权');
assert.strictEqual(wecom.describeErrcode(99999), '', '未知错误码给空提示');

// 4) token 缓存不导出（模块态），但 getToken 无配置必须报 NO_CONFIG 而不是发请求
(async () => {
  await assert.rejects(() => wecom.getToken(), (e) => e.errcode === 'NO_CONFIG', '无配置报 NO_CONFIG');
  await assert.rejects(
    () => wecom.sendMarkdownV2('x'),
    (e) => e.errcode === 'NO_CONFIG',
    '无 webhook key 发送报 NO_CONFIG',
  );
  console.log('✓ stub-test-wecom 全部通过（分批/错误码/无配置安全 8 组断言）');
})();
