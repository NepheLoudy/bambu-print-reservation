/**
 * 本地预约系统单测（路线 A 本地化：存储/状态机/规则快照/审批入队集成）
 * 用法：node test/local-reservation-test.js
 * 注意：所有 env 必须在 require 之前设置（模块顶层读 env）；
 *       QUIET_HOURS_DISABLED=1 防止凌晨跑测试触发静默积压落盘
 */
const os = require('os');
const path = require('path');
process.env.PROCESS_RULES_FILE = require('os').tmpdir() + `/bambu-test-rules-${process.pid}.json`;
process.env.RESERVATIONS_STORE_FILE = path.join(os.tmpdir(), `bambu-test-res-${process.pid}.json`);
process.env.RESERVATIONS_UPLOAD_DIR = path.join(os.tmpdir(), `bambu-test-up-${process.pid}`);
process.env.DISPATCH_STATE_FILE = path.join(os.tmpdir(), `bambu-test-dispatch-${process.pid}.json`);
process.env.QUIET_BACKLOG_FILE = path.join(os.tmpdir(), `bambu-test-quiet-${process.pid}.json`);
process.env.QUIET_HOURS_DISABLED = '1';
// 集成用例不得向真实群 webhook 播报（.env 里是真实群机器人，曾触发 9499 限流）；
// 空字符串已存在 → dotenv 不覆盖 → bot.sendMessage 空值守卫跳过发送
process.env.BOT_WEBHOOK_URL = '';

const assert = require('assert');
const fs = require('fs');
const store = require('../src/services/reservationStore');
const processRules = require('../src/services/processRules');
const dispatcher = require('../src/services/dispatcher');
const reservationService = require('../src/services/reservation');

let failures = 0;
let passed = 0;
const pending = [];
// 同步用例立即判；async 用例（集成链）进 pending，末尾 Promise.all 收齐再总结——
// 异步 rejection 必须计为失败，不得变成 unhandledRejection 假绿
function check(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      pending.push(
        r.then(
          () => { passed++; console.log(`✓ ${name}`); },
          (err) => { failures++; console.error(`✗ ${name} — ${err.message}`); }
        )
      );
    } else {
      passed++;
      console.log(`✓ ${name}`);
    }
  } catch (err) {
    failures++;
    console.error(`✗ ${name} — ${err.message}`);
  }
}

/** 组装一份合法提交（applyRules 定档 → store.create），返回记录 */
function submit(overrides = {}, selection = { load_magnitude: 'medium' }) {
  const material = overrides.materialType || 'PETG';
  const applied = processRules.applyRules(selection, { material });
  assert.equal(applied.blocked, false, `applyRules 意外拦截: ${applied.errors.join(';')}`);
  return store.create({
    applicant: '测试员',
    fileName: 'bracket.3mf', // 集成链路默认 3mf(审批直通);stl 审批拦截有独立用例
    filePath: path.join(__dirname, 'fixtures-does-not-exist.stl'),
    fileSize: 1024,
    materialType: material,
    color: '黑色',
    ...overrides,
    selection,
    processParams: applied.params,
    appliedRules: applied.applied,
  });
}

// ---------- 提交校验 ----------

check('create 材料可空（2026-10-05 曼波定：按需求标签反推材料）', () => {
  const r = store.create({ applicant: 'x', fileName: 'a.stl', filePath: '/tmp/a', selection: {}, processParams: null, appliedRules: [] });
  assert.equal(r.materialType, '');
});

check('create 硬冲突拒绝：耐温≥80°C × PLA', () => {
  assert.throws(
    () => submit({ materialType: 'PLA' }, { temp_class: 't80' }),
    /PLA/
  );
});

check('create 成功：单号格式与当日递增', () => {
  const a = submit();
  const b = submit({ color: '白色' });
  assert.match(a.id, /^R\d{8}-\d{3}$/);
  const na = Number(a.id.slice(-3));
  assert.equal(b.id, a.id.slice(0, -3) + String(na + 1).padStart(3, '0'), '同日单号应递增');
});

check('processParams 快照随单入档（Z 向受力 → 层高 0.16）', () => {
  const r = submit({}, { load_direction: ['Z'], load_magnitude: 'heavy' });
  assert.equal(r.processParams.layerHeight, 0.16);
  assert.equal(r.processParams.infillDensity, 60);
  assert.ok(r.appliedRules.some((x) => x.id === 'z-load-orient'));
  assert.equal(r.status, '待审批');
});

// ---------- 状态机 ----------

check('非法流转拦截：待审批 → 打印中', () => {
  const r = submit();
  assert.throws(() => store.updateStatus(r.id, '打印中'), /状态机不允许/);
});

check('全链合法流转：待审批→已通过→排队中→打印中→已完成', () => {
  const r = submit();
  store.updateStatus(r.id, '已通过', '测试');
  store.updateStatus(r.id, '排队中', '测试');
  store.updateStatus(r.id, '打印中', '测试');
  const done = store.updateStatus(r.id, '已完成', '测试');
  assert.equal(done.status, '已完成');
  assert.equal(done.history.length, 5);
  assert.ok(done.history.every((h) => h.at));
});

check('失败重排合法：打印中 → 排队中', () => {
  const r = submit();
  store.updateStatus(r.id, '已通过', '测试');
  store.updateStatus(r.id, '排队中', '测试');
  store.updateStatus(r.id, '打印中', '测试');
  const back = store.updateStatus(r.id, '排队中', '失败重排');
  assert.equal(back.status, '排队中');
});

check('终态锁定：已驳回/已取消/已完成 不可再流转', () => {
  const a = submit();
  store.updateStatus(a.id, '已驳回', '测试');
  assert.throws(() => store.updateStatus(a.id, '待审批'), /状态机不允许/);
  const b = submit();
  store.updateStatus(b.id, '已取消', '测试');
  assert.throws(() => store.updateStatus(b.id, '已通过'), /状态机不允许/);
});

// ---------- dispatcher 接入 ----------

check('buildLocalTask 字段完整（fileSource=local/filePath 记录）', () => {
  const r = submit({ isUrgent: true, quantity: 3 });
  const t = dispatcher.buildLocalTask(r);
  assert.equal(t.fileSource, 'local');
  assert.equal(t.recordId, r.id);
  assert.equal(t.applicationNo, r.id);
  assert.equal(t.filePath, r.filePath);
  assert.equal(t.fileToken, null);
  assert.equal(t.isUrgent, true);
  assert.equal(t.quantity, 3);
  assert.equal(t.applicant.name, '测试员');
});

check('集成：审批通过 → 入队 + store 排队中（快照一致）', async () => {
  const r = submit();
  const after = await reservationService.approveReservation(r.id, '测试审批人', 'OK');
  assert.equal(after.status, '排队中');
  assert.ok(after.review && after.review.reviewer === '测试审批人');
  const queued = dispatcher.getQueueSnapshot().find((q) => q.recordId === r.id);
  assert.ok(queued, '任务应在分发队列中');
});

check('集成：重复审批被拒（仅待审批单可批，防重复入队）', async () => {
  const r = submit();
  await reservationService.approveReservation(r.id, 'A', '');
  await assert.rejects(
    () => reservationService.approveReservation(r.id, 'B', ''),
    /仅待审批单可审批/
  );
});

check('集成：取消 → dequeue 出队 + store 已取消', async () => {
  const r = submit();
  await reservationService.approveReservation(r.id, 'A', '');
  assert.ok(dispatcher.getQueueSnapshot().some((q) => q.recordId === r.id));
  await reservationService.cancelReservation(r.id);
  assert.equal(store.get(r.id).status, '已取消');
  assert.ok(!dispatcher.getQueueSnapshot().some((q) => q.recordId === r.id), '任务应已出队');
});

// ---------- 审查批：聊天列表兼容 / 上传文件生命周期 ----------

check('聊天 /print-list 发起人显示 displayName（字符串形态兼容）', async () => {
  submit(); // submit() 构造的单 applicant='测试员'
  const { executeCommand } = require('../src/services/chatService');
  const out = await executeCommand('/print-list', []);
  assert.match(out, /测试员/, '字符串 applicant 应直接显示');
  assert.ok(!out.includes('未知'), '不应再恒显「未知」');
});

check('cleanupExpiredUploads：终态超期源文件清理，记录保留并标记', async () => {
  const path1 = require('path');
  const tmpFile = path1.join(os.tmpdir(), `bambu-cleanup-${process.pid}.stl`);
  fs.writeFileSync(tmpFile, 'x');
  const rec = submit({ filePath: tmpFile });
  store.updateStatus(rec.id, '已通过', 't');
  store.updateStatus(rec.id, '排队中', 't'); // 排队中非终态,不应清
  let r = store.cleanupExpiredUploads();
  assert.equal(r.removed, 0, '非终态单不清理');
  store.updateStatus(rec.id, '打印中', 't');
  store.updateStatus(rec.id, '已完成', 't');
  const stale = JSON.parse(fs.readFileSync(process.env.RESERVATIONS_STORE_FILE, 'utf-8'));
  const target = stale.records.find((x) => x.id === rec.id);
  target.updatedAt = new Date(Date.now() - 31 * 24 * 3600 * 1000).toISOString(); // 31 天前(默认保留 30)
  fs.writeFileSync(process.env.RESERVATIONS_STORE_FILE, JSON.stringify(stale));
  r = store.cleanupExpiredUploads();
  assert.equal(r.removed, 1);
  assert.ok(!fs.existsSync(tmpFile), '过期源文件应被删除');
  const after = store.get(rec.id);
  assert.equal(after.status, '已完成', '单据记录保留');
  assert.equal(after.fileCleaned, true, '标记 fileCleaned');
});

check('cleanupExpiredUploads：UPLOAD_RETENTION_DAYS=0 禁用', () => {
  process.env.UPLOAD_RETENTION_DAYS = '0';
  const r = store.cleanupExpiredUploads();
  assert.equal(r.disabled, true);
  delete process.env.UPLOAD_RETENTION_DAYS;
});

check('材料可空提交:需求标签反推材料约束随单下发', () => {
  const material = 'PETG';
  const applied = processRules.applyRules({ temp_class: 't80' }, { material }); // 引擎照常算 exclude
  assert.equal(applied.blocked, false);
  const rec = store.create({
    applicant: '反推测试', fileName: 'a.stl', filePath: 'x',
    materialType: '', // 留空
    selection: { temp_class: 't80' },
    processParams: applied.params, appliedRules: applied.applied,
  });
  const task = dispatcher.buildLocalTask(rec);
  assert.deepEqual(task.materialExclude, ['^PLA'], '耐温标签的排除应随任务下发');
  assert.equal(task.materialType, '');
});

check('findTray 材料反推:exclude 槽不可见,prefer 槽优先', () => {
  const printer = { ams: [{ type: 'PLA', colorHex: '' }, { type: 'PETG', colorHex: '' }, { type: 'PA-CF', colorHex: '' }] };
  // 排除 PLA 后:任意需求不再落 PLA 槽
  const t1 = dispatcher.findTray(printer, '', null, 'exact', { exclude: ['^PLA'] });
  assert.equal(t1.type, 'PETG', '排除 PLA 后应选到 PETG(非 prefer 时取首个合规槽)');
  // prefer PA:直接命中 PA 槽
  const t2 = dispatcher.findTray(printer, '', null, 'exact', { prefer: ['PA'] });
  assert.equal(t2.type, 'PA-CF');
  // 明确需求材料+exclude 抵触:需求优先按匹配走,exclude 过滤不匹配槽
  const t3 = dispatcher.findTray(printer, 'PLA', null, 'exact', { exclude: ['^PETG'] });
  assert.equal(t3.type, 'PLA', '排除 PETG 不影响明确要 PLA');
});

check('多色匹配:所有颜色同机 AMS 可得才选机,缺色不选,不共槽', () => {
  const mk = (ams) => ({ autoDispatch: true, status: '空闲', name: 'T', ams });
  const full = mk([
    { type: 'PLA', colorHex: '#ffffff' }, // 白
    { type: 'PLA', colorHex: '#000000' }, // 黑
    { type: 'PETG', colorHex: '#ff0000' },
  ]);
  const onlyWhite = mk([{ type: 'PLA', colorHex: '#ffffff' }, { type: 'PLA', colorHex: '#eeeeee' }]);
  const task = { materialType: 'PLA', color: '白色+黑色', materialExclude: [], materialPrefer: [] };
  assert.equal(dispatcher.matchPrinter(task, [onlyWhite]), null, '缺黑色的打印机不可选');
  assert.equal(dispatcher.matchPrinter(task, [full]).name, 'T', '双色齐备可选');
  // 共槽防护:两个颜色近似匹配到同一槽 → 不算覆盖
  const oneSlot = mk([{ type: 'PLA', colorHex: '#ffffff' }]);
  assert.equal(dispatcher.matchPrinter({ ...task, color: '白色+白色' }, [oneSlot]), null, '两色不可共一槽');
});

check('份数续打:quantity=3 完成后 remaining 递减重入队,末件才终态', async () => {
  const material = 'PETG';
  const applied = processRules.applyRules({ load_magnitude: 'medium' }, { material });
  const rec = store.create({
    applicant: '批量测试', fileName: 'x3.3mf', filePath: 'x', materialType: material,
    quantity: 3, selection: { load_magnitude: 'medium' }, processParams: applied.params, appliedRules: [],
  });
  await reservationService.approveReservation(rec.id, 'A', '');
  const task = dispatcher.getQueueSnapshot().find((q) => q.recordId === rec.id);
  assert.equal(task.remaining, 2, '首件外剩余 2');
  // 模拟第一件完成:任务在 printing 中 → completeTask
  // 模拟 dispatch 出队(真实流程 dispatchLocked 会把任务移出队列)
  dispatcher.queue = dispatcher.queue.filter((q) => q.recordId !== rec.id);
  const t = dispatcher.buildLocalTask(store.get(rec.id));
  t.remaining = 2;
  dispatcher.printing.set(998, t);
  await dispatcher.completeTask(t, { id: 998, name: '模拟机' });
  assert.ok(dispatcher.getQueueSnapshot().some((q) => q.recordId === rec.id), '续件应重入队');
  assert.equal(store.get(rec.id).status, '排队中', '未全部完成不写终态');
  const t2 = dispatcher.getQueueSnapshot().find((q) => q.recordId === rec.id);
  assert.equal(t2.remaining, 1);
  // 第二件完成
  dispatcher.queue = dispatcher.queue.filter((q) => q.recordId !== rec.id);
  t.remaining = 1;
  dispatcher.printing.set(998, t);
  await dispatcher.completeTask(t, { id: 998, name: '模拟机' });
  // 第三件(最后一件)完成 → 终态
  dispatcher.queue = dispatcher.queue.filter((q) => q.recordId !== rec.id);
  dispatcher.printing.set(998, t);
  t.remaining = 0;
  await dispatcher.completeTask(t, { id: 998, name: '模拟机' });
  assert.equal(store.get(rec.id).status, '已完成', '末件完成才写已完成');
  assert.ok(!dispatcher.getQueueSnapshot().some((q) => q.recordId === rec.id), '无剩余不再入队');
});

check('taxonomy v2.1:多色打印标签在池', () => {
  const taxonomy = require('../src/services/taxonomy');
  const ids = new Set(taxonomy.groups.flatMap((g) => g.fields.map((f) => f.id)));
  assert.ok(ids.has('multi_color'), '缺 multi_color');
});

check('双通道分流:3mf 提交跳过定档(processParams null),stl/step 照常', () => {
  const r3mf = store.create({
    applicant: '直通测试', fileName: 'done.3mf', filePath: 'x', materialType: 'PETG', color: '白色+黑色',
    selection: {}, processParams: null, appliedRules: [],
  });
  assert.equal(r3mf.processParams, null, '3mf 不定档');
  assert.deepEqual(r3mf.appliedRules, []);
  const rstl = submit(); // stl 走需求链路(有快照)
  assert.ok(rstl.processParams && rstl.processParams.layerHeight, 'stl 应有定档快照');
  // 3mf 多色直接按颜色栏匹配(无 multi_color 标签依赖)
  const t = dispatcher.buildLocalTask(r3mf);
  assert.equal(t.materialType, 'PETG');
});

// ---------- 收尾：异步用例全部落定后清理与总结 ----------
Promise.all(pending).then(() => {
  for (const f of [process.env.RESERVATIONS_STORE_FILE, process.env.DISPATCH_STATE_FILE, process.env.QUIET_BACKLOG_FILE]) {
    try { fs.unlinkSync(f); } catch { /* 无则跳过 */ }
  }
  console.log(failures === 0 ? `\n全部通过（${passed} 项）` : `\n${failures} 项失败`);
  process.exit(failures === 0 ? 0 : 1);
});
