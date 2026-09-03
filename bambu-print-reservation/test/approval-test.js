/**
 * 官方审批表单解析单测（纯逻辑，不调 API）
 * 用法：node test/approval-test.js
 */
const assert = require('assert');
const { parseForm, buildTaskFromInstance } = require('../src/services/approvalService');

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    failures++;
    console.error(`✗ ${name} — ${err.message}`);
  }
}

const FORM = [
  { id: 'widget1', type: 'text', title: '申请说明', value: '车架端盖' },
  { id: 'widget2', type: 'attachment', title: '切片文件', value: 'att_123,att_456' },
  { id: 'widget3', type: 'radio', title: '材料类型', value: 'PETG' },
  { id: 'widget4', type: 'radio', title: '颜色', value: '白色' },
  { id: 'widget5', type: 'checkbox', title: '是否加急', value: '是' },
  { id: 'widget6', type: 'selector', title: '指定打印机', value: 'X1C-02' },
];

check('附件：取第一个 attachment_id', () => {
  const p = parseForm(FORM);
  assert.equal(p.attachment.attachmentId, 'att_123');
});
check('材料/颜色/加急/指定打印机：按标题关键词解析', () => {
  const p = parseForm(FORM);
  assert.equal(p.materialType, 'PETG');
  assert.equal(p.color, '白色');
  assert.equal(p.isUrgent, true);
  assert.equal(p.assignedPrinter, 'X1C-02');
});
check('字段名变化仍可解析（耗材/色彩/紧急）', () => {
  const p = parseForm([
    { type: 'radio', title: '耗材类型', value: 'PLA' },
    { type: 'radio', title: '色彩', value: '黑色' },
    { type: 'checkbox', title: '紧急', value: 'true' },
  ]);
  assert.equal(p.materialType, 'PLA');
  assert.equal(p.color, '黑色');
  assert.equal(p.isUrgent, true);
});
check('无附件表单 → buildTask 返回 null（非打印审批）', () => {
  const task = buildTaskFromInstance({ instance_id: 'i1', form: [{ type: 'text', title: '说明', value: 'x' }] });
  assert.equal(task, null);
});
check('附件 value 为数组形态兼容', () => {
  const p = parseForm([{ type: 'attachment', title: '附件', value: [{ attachment_id: 'att_9', name: 'a.3mf' }] }]);
  assert.equal(p.attachment.attachmentId, 'att_9');
});
check('buildTask：instance_id 作为去重键与申请编号', () => {
  const task = buildTaskFromInstance({
    instance_id: '7123456789',
    status: 'APPROVED',
    start_user_id: 'ou_test',
    form: FORM,
  });
  assert.equal(task.recordId, '7123456789');
  assert.equal(task.applicationNo, '7123456789');
  assert.equal(task.fileSource, 'approval');
  assert.equal(task.fileToken, 'att_123');
  assert.equal(task.applicant.id, 'ou_test');
});
check('加急为「否」时 isUrgent=false', () => {
  const p = parseForm([{ type: 'checkbox', title: '是否加急', value: '否' }]);
  assert.equal(p.isUrgent, false);
});

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
