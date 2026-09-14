// 周窗口语义桩测试：锚定日、跨月/跨年、发送时刻判定
// 运行：npm run test:window
const assert = require('assert');
const {
  weekWindow, isPastSendTime, currentAnchor,
} = require('../src/report');

const SH = (s) => Date.parse(s); // '2026-09-15T12:00:00+08:00' 形式的上海时刻 → 真实毫秒

// 1) 周二中午看，本周一锚=09-14，窗口=上一完整周 09-07 ~ 09-13
let win = weekWindow(0, SH('2026-09-15T12:00:00+08:00'), 1);
assert.strictEqual(win.label, '2026-09-07 ~ 2026-09-13', '周二中午的窗口标签');
assert.strictEqual(win.key, '2026-09-07', '周唯一键=窗口周一日期');
assert.strictEqual(new Date(win.start).toISOString(), '2026-09-06T16:00:00.000Z', '窗口起点=上海周一 00:00（=UTC 周日 16:00）');
assert.strictEqual(new Date(win.end).toISOString(), '2026-09-13T16:00:00.000Z', '窗口终点=上海下周一 00:00');

// 2) 周日（未到下周一发送时刻）看，窗口=再往前一周 08-31 ~ 09-06
win = weekWindow(0, SH('2026-09-13T10:00:00+08:00'), 1);
assert.strictEqual(win.label, '2026-08-31 ~ 2026-09-06', '周日尚未跨锚，窗口还是上一个周期');

// 3) offset=1 往前推一周
win = weekWindow(1, SH('2026-09-15T12:00:00+08:00'), 1);
assert.strictEqual(win.label, '2026-08-31 ~ 2026-09-06', 'offset=1 前推一周');

// 4) 跨年：2026-01-01（周四）看，锚=2025-12-29（周一），窗口 2025-12-22 ~ 12-28
win = weekWindow(0, SH('2026-01-01T12:00:00+08:00'), 1);
assert.strictEqual(win.label, '2025-12-22 ~ 2025-12-28', '跨年窗口');
assert.strictEqual(win.key, '2025-12-22', '跨年周键');

// 5) 发送日=周日（sendDow=0）：周三看，锚=09-13（周日），窗口 09-06 ~ 09-12
win = weekWindow(0, SH('2026-09-16T12:00:00+08:00'), 0);
assert.strictEqual(win.label, '2026-09-06 ~ 2026-09-12', '自定义发送日（周日）的窗口');

// 6) 发送时刻判定（周一 09:30 档）
assert.strictEqual(isPastSendTime(SH('2026-09-14T10:00:00+08:00'), 1, 9, 30), true, '周一 10:00 已过 09:30');
assert.strictEqual(isPastSendTime(SH('2026-09-14T09:00:00+08:00'), 1, 9, 30), false, '周一 09:00 未到');
assert.strictEqual(isPastSendTime(SH('2026-09-14T09:30:00+08:00'), 1, 9, 30), true, '恰好到点即算已过');
assert.strictEqual(isPastSendTime(SH('2026-09-13T23:00:00+08:00'), 1, 9, 30), true, '周日时上周发送早已过期');
assert.strictEqual(currentAnchor(SH('2026-09-15T00:01:00+08:00'), 1), SH('2026-09-14T00:00:00+08:00'), '周一凌晨零点刚过锚定本周一');

// 7) 下次发送时刻（自算，替代 node-cron 缺失的 nextDates）
const { nextSendTime } = require('../src/report');
assert.strictEqual(nextSendTime(SH('2026-09-15T12:00:00+08:00'), 1, 9, 30), SH('2026-09-21T09:30:00+08:00'), '周二看下次=下周一 09:30');
assert.strictEqual(nextSendTime(SH('2026-09-14T09:29:00+08:00'), 1, 9, 30), SH('2026-09-14T09:30:00+08:00'), '发送前 1 分钟=本刻');
assert.strictEqual(nextSendTime(SH('2026-09-14T09:31:00+08:00'), 1, 9, 30), SH('2026-09-21T09:30:00+08:00'), '刚过点顺延 7 天');
assert.strictEqual(nextSendTime(SH('2026-09-16T12:00:00+08:00'), 1, 9, 30), SH('2026-09-21T09:30:00+08:00'), '周三看下次=下周一 09:30');

console.log('✓ stub-test-window 全部通过（10 组断言）');
