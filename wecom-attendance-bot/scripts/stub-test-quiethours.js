// 离线桩测试：晚间静默闸门（utils/quietHours）
// 运行：node scripts/stub-test-quiethours.js
const assert = require('assert');

// 控制 process.env 后清 require 缓存重载
function reload(env) {
  delete require.cache[require.resolve('../src/utils/quietHours')];
  for (const k of ['QUIET_HOURS_START', 'QUIET_HOURS_END', 'QUIET_HOURS_DISABLED']) delete process.env[k];
  Object.assign(process.env, env || {});
  return require('../src/utils/quietHours');
}

const SH = (iso) => new Date(iso).getTime(); // ISO 里直接写 +08:00 即上海时间

// 1) 默认窗口 02:00–09:00
let qh = reload();
assert.strictEqual(qh.getStatus().enabled, true, '默认启用');
assert.strictEqual(qh.getStatus().window, '02:00–09:00', '默认窗口文案');
assert.strictEqual(qh.inQuietHours(SH('2026-09-15T01:59:00+08:00')), false, '01:59 未入窗');
assert.strictEqual(qh.inQuietHours(SH('2026-09-15T02:00:00+08:00')), true, '02:00 整入窗（左闭）');
assert.strictEqual(qh.inQuietHours(SH('2026-09-15T08:59:00+08:00')), true, '08:59 仍在窗');
assert.strictEqual(qh.inQuietHours(SH('2026-09-15T09:00:00+08:00')), false, '09:00 出窗（右开）');
assert.strictEqual(qh.inQuietHours(SH('2026-09-15T09:30:00+08:00')), false, '09:30 播报档不受限');
assert.strictEqual(qh.inQuietHours(SH('2026-09-15T23:30:00+08:00')), false, '深夜不在窗');

// 2) 跨午夜窗口（22:00–06:00）
qh = reload({ QUIET_HOURS_START: '22:00', QUIET_HOURS_END: '06:00' });
assert.strictEqual(qh.getStatus().window, '22:00–06:00', '自定义窗口文案');
assert.strictEqual(qh.inQuietHours(SH('2026-09-15T23:00:00+08:00')), true, '跨午夜：23:00 在窗');
assert.strictEqual(qh.inQuietHours(SH('2026-09-16T05:59:00+08:00')), true, '跨午夜：05:59 在窗');
assert.strictEqual(qh.inQuietHours(SH('2026-09-16T06:00:00+08:00')), false, '跨午夜：06:00 出窗');
assert.strictEqual(qh.inQuietHours(SH('2026-09-15T21:59:00+08:00')), false, '跨午夜：21:59 未入窗');

// 3) 关闭开关
qh = reload({ QUIET_HOURS_DISABLED: '1' });
assert.strictEqual(qh.getStatus().enabled, false, 'DISABLED=1 生效');
assert.strictEqual(qh.inQuietHours(SH('2026-09-15T03:00:00+08:00')), false, '关闭后凌晨也不拦');

// 4) 非法配置回退默认
qh = reload({ QUIET_HOURS_START: 'bad', QUIET_HOURS_END: '25:00' });
assert.strictEqual(qh.getStatus().window, '02:00–09:00', '非法值回退默认窗口');

console.log('✓ stub-test-quiethours 全部通过（15 组断言）');
