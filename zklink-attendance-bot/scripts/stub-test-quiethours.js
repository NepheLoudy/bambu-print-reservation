// 晚间静默桩测试：默认窗口/边界 [START,END)/禁用/HH:mm 取整/跨午夜窗口
// 每个场景独立子进程跑（模块在 require 时读 env），本文件只做编排
// 运行：node scripts/stub-test-quiethours.js
const { spawnSync } = require('child_process');
const path = require('path');

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.error(`  ✗ ${name} — ${extra}`); }
}

// 场景 runner：在子进程里设 env + require quietHours + 打印指定时刻判定
// （node -e 的相对 require 以 cwd 为基解析，必须传绝对路径）
const MODULE_PATH = path.join(__dirname, '..', 'src', 'utils', 'quietHours.js');
const RUNNER = `
const quietHours = require(process.env.QUIET_MODULE);
const q = JSON.parse(process.env.PROBE);
for (const ms of q.at) {
  const d = new Date(ms + 8 * 3600 * 1000);
  const label = d.toISOString().slice(5, 16).replace('T', ' ') + ' 上海';
  console.log((quietHours.inQuietHours(ms) ? 'IN ' : 'OUT') + ' ' + label);
}
console.log('STATUS ' + JSON.stringify(quietHours.getStatus()));
`;

function probe(name, env, at, expectations) {
  const r = spawnSync('node', ['-e', RUNNER], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, ...env, PROBE: JSON.stringify({ at }), QUIET_MODULE: MODULE_PATH },
    encoding: 'utf8',
  });
  const lines = (r.stdout || '').split('\n').filter(Boolean);
  const outs = lines.filter((l) => /^(IN|OUT) /.test(l));
  let ok = r.status === 0 && outs.length === expectations.length;
  if (ok) {
    for (let i = 0; i < expectations.length; i++) {
      if (!outs[i].startsWith(expectations[i] + ' ')) { ok = false; console.error(`  ✗ ${name} 第${i + 1}个时刻期望 ${expectations[i]}，实际 ${outs[i]}`); }
    }
  } else if (r.status !== 0) {
    ok = false;
    console.error(`  ✗ ${name} runner 失败: ${r.stderr}`);
  }
  check(name, ok, (r.stdout || '').trim());
  return lines.find((l) => l.startsWith('STATUS '));
}

console.log('\n== 1. 默认窗口 02:00–09:00 ==');
const t = (h, m) => Date.parse(`2026-10-07T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+08:00`);
probe('08:59 在窗内 / 09:00 整出窗 / 01:59 在窗外', {}, [t(8, 59), t(9, 0), t(1, 59)], ['IN', 'OUT', 'OUT']);

console.log('\n== 2. QUIET_HOURS_DISABLED=1 ==');
probe('禁用后 03:00 也放行', { QUIET_HOURS_DISABLED: '1' }, [t(3, 0)], ['OUT']);

console.log('\n== 3. 纯小时数字（duty 口径）22–6 跨午夜 ==');
const env226 = { QUIET_HOURS_START: '22', QUIET_HOURS_END: '6' };
probe('23:00 在窗内 / 05:00 在窗内 / 12:00 窗外', env226, [t(23, 0), t(5, 0), t(12, 0)], ['IN', 'IN', 'OUT']);

console.log('\n== 4. HH:mm 非整点 floor 到整点（22:30 → 22:00 生效，窗口取整后变宽） ==');
const st = probe('22:00 整在窗内 / 22:15 在窗内 / 23:00 在窗内', { QUIET_HOURS_START: '22:30', QUIET_HOURS_END: '6:00' }, [t(22, 0), t(22, 15), t(23, 0)], ['IN', 'IN', 'IN']);
check('status 标注生效窗口 22:00–06:00', st && st.includes('"window":"22:00–06:00"'), st);

console.log('\n== 5. 非法值回退默认 ==');
const st5 = probe('非法 START 回退 02:00：03:00 在窗内', { QUIET_HOURS_START: 'abc' }, [t(3, 0)], ['IN']);
check('status 显示默认窗口', st5 && st5.includes('"window":"02:00–09:00"'), st5);

console.log('\n== 6. 同日窗口不跨界 ==');
const st6 = probe('12:00–14:00：13:00 在窗内 / 11:00 与 14:00 窗外', { QUIET_HOURS_START: '12', QUIET_HOURS_END: '14' }, [t(13, 0), t(11, 0), t(14, 0)], ['IN', 'OUT', 'OUT']);

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
