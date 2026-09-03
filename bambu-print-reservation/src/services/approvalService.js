const config = require('../config');
const { requestAPI } = require('../feishu/client');
const dispatcher = require('./dispatcher');

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
 * 表单数组 → 任务字段（自适应按类型与标题关键词）
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

  for (const item of form || []) {
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
    recordId: instance.instance_id, // 复用 recordId 字段做去重/取消键
    fileSource: 'approval',
    fileToken: parsed.attachment.attachmentId,
    fileName: parsed.attachment.name || `approval_${instance.instance_id}.3mf`,
    applicationNo: instance.instance_id,
    status: instance.status,
    applicant: instance.start_user_id
      ? { id: instance.start_user_id, name: instance.start_user_name || '' }
      : null,
    materialType: parsed.materialType,
    color: parsed.color,
    assignedPrinter: parsed.assignedPrinter,
    isUrgent: parsed.isUrgent,
  };
}

/**
 * 处理 approval_instance 事件（网关转发，event = {approval_code?, instance_id, ...}）
 */
async function handleApprovalEvent(event) {
  const instanceId = event.instance_id || (event.event && event.event.instance_id);
  if (!instanceId) {
    console.warn('[审批监听] 事件缺少 instance_id，忽略');
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

  if (configuredCode && instance.approval_id && instance.approval_id !== configuredCode) {
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
  } else if (['CANCELED', 'REJECTED', 'DELETED'].includes(status)) {
    dispatcher.dequeue(instanceId);
    console.log(`[审批监听] 实例 ${instanceId} ${status}，已移出队列`);
  } else {
    console.log(`[审批监听] 实例 ${instanceId} 状态 ${status}，不动作`);
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
  subscribeApproval,
};
