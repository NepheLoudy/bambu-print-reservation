const config = require('../config');
const { requestAPI, approveTask } = require('../feishu/client');
const dispatcher = require('./dispatcher');
const printerManager = require('../printer/manager');

// ============================================================
// 官方审批直连：审批实例状态变更事件（秒级）驱动打印分发
//
// 多维表格只是审批系统的同步镜像（半小时级），不能作为触发源；
// 本模块消费 feishu-gateway 转发的 approval_instance 事件，
// 拉取审批实例详情解析表单（附件/材料/颜色/加急/指定打印机），
// 状态 APPROVED → 入队分发，CANCELED/REJECTED → 移出队列。
//
// 表单解析为自适应：不依赖固定字段名——
//   附件字段（type=attachment）取第一个 .3mf 作为切片文件；
//   字段标题含「材料」→ 材料类型；含「颜色」→ 颜色；
//   含「加急/紧急」→ 加急；含「打印机」→ 指定打印机。
// ============================================================

/** 拉取审批实例详情 */
async function getInstanceDetail(instanceId) {
  const res = await requestAPI(
    'GET',
    `/approval/v4/instances/${instanceId}?user_id_type=open_id&locale=zh_cn`
  );
  if (res.code !== 0) {
    throw new Error(`获取审批实例失败: ${res.msg} (code: ${res.code})`);
  }
  return res.data?.instance || null;
}

/**
 * 表单 → 任务字段（自适应按类型与标题关键词）
 * 官方实例详情的 form 是「表单控件 JSON 字符串」，事件/测试里也可能是数组
 * form item: { id, type, title, custom_key?, value }
 */
function parseForm(form) {
  const parsed = {
    materialType: '',
    color: '',
    assignedPrinter: '',
    isUrgent: false,
    attachment: null, // {attachmentId, name}
    fileName: '',
  };

  let items = form;
  if (typeof items === 'string') {
    try {
      items = JSON.parse(items || '[]');
    } catch (err) {
      console.warn('[审批监听] 表单 JSON 解析失败:', err.message);
      items = [];
    }
  }

  for (const item of items || []) {
    const title = String(item.title || item.custom_key || '');
    const type = String(item.type || '');

    if (type === 'attachment' && !parsed.attachment) {
      // value: 逗号分隔的 attachment_id（兼容数组/对象形态）
      let ids = [];
      if (typeof item.value === 'string') {
        ids = item.value.split(',').map((s) => s.trim()).filter(Boolean);
      } else if (Array.isArray(item.value)) {
        ids = item.value.map((v) => (typeof v === 'string' ? v : v.attachment_id || v.file_token)).filter(Boolean);
      } else if (item.value && typeof item.value === 'object') {
        ids = [item.value.attachment_id || item.value.file_token].filter(Boolean);
      }
      if (ids.length > 0) {
        parsed.attachment = { attachmentId: ids[0], name: '' };
      }
      continue;
    }

    const value = typeof item.value === 'string' ? item.value : String(item.value || '');

    if (!parsed.materialType && /材料|耗材/.test(title)) {
      parsed.materialType = value;
    } else if (!parsed.color && /颜色|色彩/.test(title)) {
      parsed.color = value;
    } else if (/加急|紧急/.test(title)) {
      parsed.isUrgent = /是|true|1/i.test(value);
    } else if (!parsed.assignedPrinter && /打印机/.test(title)) {
      parsed.assignedPrinter = value;
    }
  }

  return parsed;
}

/** 实例详情 → 分发任务对象（fileSource=approval） */
function buildTaskFromInstance(instance) {
  const parsed = parseForm(instance.form);
  if (!parsed.attachment) {
    return null; // 没有附件的审批不是打印申请
  }

  return {
    recordId: instance.instance_code, // 复用 recordId 字段做去重/取消键（实例详情响应字段为 instance_code）
    fileSource: 'approval',
    fileToken: parsed.attachment.attachmentId,
    fileName: parsed.attachment.name || `approval_${instance.instance_code}.3mf`,
    applicationNo: instance.instance_code,
    status: instance.status,
    applicant: instance.open_id ? { id: instance.open_id, name: '' } : null,
    materialType: parsed.materialType,
    color: parsed.color,
    assignedPrinter: parsed.assignedPrinter,
    isUrgent: parsed.isUrgent,
  };
}

/**
 * 处理 approval_instance 事件（网关转发，event = {approval_code?, instance_code, ...}）
 */
async function handleApprovalEvent(event) {
  const instanceId = event.instance_code || (event.event && event.event.instance_code);
  if (!instanceId) {
    console.warn('[审批监听] 事件缺少 instance_code，忽略');
    return;
  }

  // 配置了 approval_code 时过滤非打印审批
  const configuredCode = config.approval.approvalCode;
  const eventCode = event.approval_code || (event.event && event.event.approval_code) || '';
  if (configuredCode && eventCode && eventCode !== configuredCode) {
    return;
  }

  let instance;
  try {
    instance = await getInstanceDetail(instanceId);
  } catch (err) {
    console.error(`[审批监听] 拉取实例详情失败 ${instanceId}:`, err.message);
    return;
  }
  if (!instance) return;

  if (configuredCode && instance.approval_code && instance.approval_code !== configuredCode) {
    return;
  }

  const status = String(instance.status || '').toUpperCase();
  const task = buildTaskFromInstance(instance);

  if (status === 'APPROVED') {
    if (!task) {
      console.log(`[审批监听] 实例 ${instanceId} 已通过但无附件字段，非打印审批，忽略`);
      return;
    }
    dispatcher.enqueue(task);
  } else if (['CANCELED', 'REJECTED', 'DELETED', 'REVERTED', 'OVERTIME_CLOSE'].includes(status)) {
    // REVERTED = 通过后撤销；OVERTIME_CLOSE = 超时关闭——同为终态，均需移出队列
    dispatcher.dequeue(instanceId);
    console.log(`[审批监听] 实例 ${instanceId} ${status}，已移出队列`);
  } else {
    console.log(`[审批监听] 实例 ${instanceId} 状态 ${status}，不动作`);
  }
}

// 自动审批任务去重（task_id 只处理一次）
const handledTasks = new Set();

/**
 * 处理 approval_task 事件（审批任务状态变更）：
 * 任务审批人 == 配置的自动审批人（审批流「自动审批」节点）时，
 * 按 AMS 规则自动同意（能匹配到材料）或留人工（缺料/无附件）。
 */
async function handleApprovalTaskEvent(event) {
  const autoApproverId = config.approval.autoApproverId;
  if (!autoApproverId) return; // 未配置自动审批人，不动作

  const evt = event.event && event.event.instance_code ? event.event : event;
  const instanceId = evt.instance_code;
  const taskId = evt.task_id;
  if (!instanceId || !taskId) return;
  if (handledTasks.has(taskId)) return;
  handledTasks.add(taskId);
  if (handledTasks.size > 500) {
    const first = handledTasks.values().next().value;
    handledTasks.delete(first);
  }

  const configuredCode = config.approval.approvalCode;
  if (configuredCode && evt.approval_code && evt.approval_code !== configuredCode) return;

  let instance;
  try {
    instance = await getInstanceDetail(instanceId);
  } catch (err) {
    console.error(`[自动审批] 拉取实例详情失败 ${instanceId}:`, err.message);
    return;
  }
  if (!instance || String(instance.status || '').toUpperCase() !== 'PENDING') return;

  // 实例任务清单：确认该 task 的审批人是否为自动审批人（任务未处理）
  const task = (instance.task_list || []).find((t) => t.id === taskId || t.task_id === taskId);
  if (!task) return;
  const taskStatus = String(task.status || '').toUpperCase();
  if (['DONE', 'APPROVED', 'REJECTED'].includes(taskStatus)) return;
  const taskApprover = task.user_id || task.approver_id || '';
  if (taskApprover !== autoApproverId) return;

  const approvalCode = instance.approval_code || evt.approval_code;
  const parsed = parseForm(instance.form);
  if (!parsed.attachment) return; // 无附件不是打印审批，不代批

  // 规则：任一 Bambu 打印机 AMS 装载能匹配材料（不要求空闲——排队即可），则自动同意
  const needMaterial = String(parsed.materialType || '').trim().toUpperCase();
  const needColor = String(parsed.color || '').trim();
  const colorRgb = config.colorReference[needColor] || null;
  const anyMatch = printerManager
    .getAllPrinterStates()
    .filter((p) => p.autoDispatch && (p.ams || []).length > 0)
    .some((p) =>
      dispatcher.findTray
        ? dispatcher.findTray(p, needMaterial, colorRgb, 'exact') ||
          dispatcher.findTray(p, needMaterial, colorRgb, 'family')
        : true
    );

  if (!anyMatch) {
    console.log(`[自动审批] ${instanceId} 缺料（${needMaterial || '任意'}×${needColor || '任意'}），留人工审批`);
    return;
  }

  try {
    const res = await approveTask({
      approvalCode,
      instanceCode: instanceId,
      taskId,
      userId: autoApproverId,
      comment: `自动审批：AMS 可匹配 ${needMaterial || '任意材料'}×${needColor || '任意颜色'}，通过后自动分发打印`,
    });
    if (res.code !== 0) {
      console.error(`[自动审批] 同意失败 ${instanceId}: ${res.msg} (code: ${res.code})`);
    } else {
      console.log(`[自动审批] 已自动同意 ${instanceId}（task ${taskId}）`);
    }
  } catch (err) {
    console.error(`[自动审批] 调用同意接口失败 ${instanceId}:`, err.message);
  }
}

/**
 * 订阅审批定义事件（一次性/幂等）：应用要收到某 approval_code 的事件必须先订阅
 * 用法：node -e "require('./src/services/approvalService').subscribeApproval('<approval_code>')"
 */
async function subscribeApproval(approvalCode) {
  const code = approvalCode || config.approval.approvalCode;
  if (!code) throw new Error('未提供 approval_code');
  const res = await requestAPI('POST', `/approval/v4/approvals/${code}/subscribe`);
  if (res.code !== 0) {
    throw new Error(`订阅审批失败: ${res.msg} (code: ${res.code})`);
  }
  console.log(`✓ 已订阅审批定义 ${code} 的事件`);
  return true;
}

module.exports = {
  getInstanceDetail,
  parseForm,
  buildTaskFromInstance,
  handleApprovalEvent,
  handleApprovalTaskEvent,
  subscribeApproval,
};
