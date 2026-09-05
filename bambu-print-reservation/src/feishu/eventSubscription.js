const config = require('../config');
const reservationService = require('../services/reservation');
const approvalService = require('../services/approvalService');
const dispatcher = require('../services/dispatcher');
// ============================================================
// 事件订阅（事件由 feishu-gateway 转发，本服务不开长连接）
//
// 主通道 = 官方审批事件（approval_instance，秒级）：
//   审批通过/撤销直接驱动分发，完全不依赖多维表格同步。
// 多维表格（半小时级镜像）：审批主通道开启时忽略其入队事件，
//   防止 30 分钟后镜像同步出的「已通过」把同一单重复入队。
//   表格直提交流程（人工在表格建单改状态）保留为后备，可配置关闭。
// ============================================================

async function startEventSubscription() {
  if (!config.feishuEvent.useLongConnection) {
    console.log('[事件订阅] 网关模式：事件由 feishu-gateway 转发到 /api/feishu/event');
  } else {
    console.log('[事件订阅] 独立长连接模式（本地调试用）');
  }
  console.log(
    config.approval.enabled
      ? '[事件订阅] 审批直连主通道：approval_instance 事件驱动分发（表格镜像仅展示）'
      : '[事件订阅] 表格直提交流程（后备模式）'
  );
  dispatcher.start();
  // 审批事件丢失自愈：只随主通道开启（后备模式的任务来自表格直提交流程，走旧对账）
  if (config.approval.enabled) {
    approvalService.startApprovalReconciler();
  }
}

/**
 * 处理网关转发的表格事件（旧版结构 {table_id, record_id, action_type, fields}）
 */
async function processBitableEvent(event) {
  try {
    const { table_id, record_id } = event;

    if (table_id !== config.bitable.reservationTableId) return;

    // 审批主通道：镜像表的「已通过」是半小时前审批系统的同步回放，
    // 早已由 approval_instance 事件处理过，忽略以防重复入队
    if (config.approval.enabled) {
      return;
    }

    await handleReservationEvent(record_id);
  } catch (err) {
    console.error('[事件订阅] 处理表格事件失败:', err.message);
  }
}

async function handleReservationEvent(recordId) {
  let reservation;
  try {
    reservation = await reservationService.getReservationById(recordId);
  } catch (err) {
    console.warn(`[事件订阅] 回查记录失败（可能已被删除）: ${err.message}`);
    return;
  }
  if (!reservation) return;

  if (reservation.status === config.status.REVIEW_APPROVED) {
    dispatcher.enqueue(reservation);
  } else if (reservation.status === config.status.CANCELLED) {
    dispatcher.dequeue(recordId);
  }
}

/**
 * 处理网关转发的审批实例事件（{instance_id, approval_code?, ...}）
 */
async function processApprovalEvent(event) {
  try {
    await approvalService.handleApprovalEvent(event || {});
  } catch (err) {
    console.error('[事件订阅] 处理审批事件失败:', err.message);
  }
}

/**
 * 处理网关转发的审批任务事件（approval_task：自动审批入口）
 */
async function processApprovalTaskEvent(event) {
  try {
    await approvalService.handleApprovalTaskEvent(event || {});
  } catch (err) {
    console.error('[事件订阅] 处理审批任务事件失败:', err.message);
  }
}

module.exports = {
  startEventSubscription,
  processBitableEvent,
  processApprovalEvent,
  processApprovalTaskEvent,
};
