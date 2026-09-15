// 飞书通道桩测试（纯函数，不联网）：签名算法/通道门控/周报卡片构建与截断
// 运行：npm run test:feishu
const assert = require('assert');
const crypto = require('crypto');
const feishu = require('../src/feishu');

// 1) 签名算法：官方规则 key=`${timestamp}\n${secret}` 对空串 HMAC-SHA256 → base64
//    （公式即实现，这里锁住：①确定性 ②换 secret 变 ③base64 形态 ④与 crypto 独立推导一致）
const s1 = feishu.signFor('1599360473', 'mysecret');
assert.strictEqual(s1, feishu.signFor('1599360473', 'mysecret'), '签名确定性');
assert.notStrictEqual(s1, feishu.signFor('1599360473', 'other'), '换密钥签名必变');
assert.notStrictEqual(s1, feishu.signFor('1599360474', 'mysecret'), '换时间戳签名必变');
assert.ok(/^[A-Za-z0-9+/]+={0,2}$/.test(s1), 'base64 形态');
const expected = crypto.createHmac('sha256', '1599360473\nmysecret').update('').digest('base64');
assert.strictEqual(s1, expected, '与官方算法推导一致');

// 2) 通道门控：至少一个；布尔正确
assert.throws(() => feishu.pickChannels({ webhookKey: '', feishuWebhookUrl: '' }), (e) => e.errcode === 'NO_CONFIG', '双通道全空报 NO_CONFIG');
assert.deepStrictEqual(feishu.pickChannels({ webhookKey: 'k', feishuWebhookUrl: '' }), { wecom: true, feishu: false }, '仅企微');
assert.deepStrictEqual(feishu.pickChannels({ webhookKey: '', feishuWebhookUrl: 'https://x' }), { wecom: false, feishu: true }, '仅飞书');
assert.deepStrictEqual(feishu.pickChannels({ webhookKey: 'k', feishuWebhookUrl: 'https://x' }), { wecom: true, feishu: true }, '双通道');

// 3) 周报卡片：逐人一行（lark_md 不渲染表格）、异常明细、橙/绿模板
const win = { label: '2026-09-07 ~ 2026-09-13', key: '2026-09-07' };
const members = [{ userid: 'u1', name: '张三' }, { userid: 'u2', name: '李四' }];
const rep = require('../src/report').aggregate([
  { userid: 'u1', checkin_time: Math.floor(Date.parse('2026-09-07T08:55:00+08:00') / 1000), checkin_type: '上班打卡', exception_type: '' },
  { userid: 'u1', checkin_time: Math.floor(Date.parse('2026-09-08T09:41:00+08:00') / 1000), checkin_type: '上班打卡', exception_type: '时间异常', groupname: '默认规则' },
  { userid: 'u2', checkin_time: Math.floor(Date.parse('2026-09-09T09:00:00+08:00') / 1000), checkin_type: '上班打卡', exception_type: '' },
], members);

const card = feishu.buildAttendanceCard(win, rep);
assert.strictEqual(card.header.template, 'orange', '有异常=橙色模板');
assert.ok(card.header.title.content.includes('2026-09-07 ~ 2026-09-13'), '标题含窗口');
const mdAll = card.elements.map((e) => e.content || '').join('\n');
assert.ok(mdAll.includes('**打卡 3 条 · 异常 1 条'), '摘要行');
assert.ok(mdAll.includes('**张三**：打卡 2 天 / 2 条 · 异常 1'), '张三逐人一行');
assert.ok(mdAll.includes('**李四**：打卡 1 天 / 1 条 · 异常 无'), '李四逐人一行');
assert.ok(mdAll.includes('⚠ 张三 09-08 09:41 **时间异常**（默认规则）'), '异常明细行');
assert.ok(mdAll.includes('数据来自企业微信打卡接口'), '脚注');

// 4) 无异常=绿色；空周报兜底
const emptyRep = require('../src/report').aggregate([], members);
const cardGreen = feishu.buildAttendanceCard(win, emptyRep);
assert.strictEqual(cardGreen.header.template, 'green', '无异常=绿色模板');
assert.ok(cardGreen.elements.map((e) => e.content || '').join('\n').includes('本周无打卡记录'), '空周报提示');

// 5) 截断：45 人名单截到 40 行 + 提示
const many = Array.from({ length: 45 }, (_, i) => ({ userid: `u${i}`, name: `成员${i}` }));
const bigRecords = many.map((m, i) => ({ userid: m.userid, checkin_time: 1789000000 + i, checkin_type: '上班打卡', exception_type: '' }));
const bigRep = require('../src/report').aggregate(bigRecords, many);
const cardBig = feishu.buildAttendanceCard(win, bigRep);
const bigMd = cardBig.elements.map((e) => e.content || '').join('\n');
assert.ok(bigMd.includes('…其余 5 人见 CSV 明细'), '成员行截断提示');
assert.ok(!bigMd.includes('成员44：'), '第 41 人起不出现');

// 6) 错误码提示
assert.ok(feishu.describeErrcode(19021).includes('FEISHU_WEBHOOK_SECRET'), '19021 提示签名密钥');
assert.ok(feishu.describeErrcode(19024).includes('关键词'), '19024 提示关键词过滤');
assert.ok(feishu.describeErrcode(9499).includes('20KB'), '9499 提示体积');

// 7) 无 URL 时 sendCardToWebhook 报 NO_CONFIG（不发请求）
(async () => {
  await assert.rejects(() => feishu.sendCardToWebhook('', '', {}), (e) => e.errcode === 'NO_CONFIG', '无 URL 报 NO_CONFIG');
  console.log('✓ stub-test-feishu 全部通过（签名/门控/卡片/截断/错误码 18 组断言）');
})();
