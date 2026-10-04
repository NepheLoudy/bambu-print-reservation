const config = require('../config');
const store = require('./reservationStore');
const { sendMessage, buildReservationAlertCard, buildReviewResultCard } = require('../feishu/bot');
const quietHours = require('../utils/quietHours');

// ============================================================
// 预约服务（2026-10-05 路线 A 本地化改造）：
//   真相源 = reservationStore（本地 JSON 存储），不再读写多维表格镜像、
//   不再依赖审批实例事件；飞书仅剩群 webhook 播报（通知通道，非数据依赖）。
//   旧镜像表记录转换（formatReservation）保留，兼容状态文件里的历史任务与
//   /print-dispatch 对遗留单据的定位。
// 注意：本模块被 dispatcher.js 依赖，对 dispatcher 的引用必须惰性 require（避免循环加载）
// ============================================================

class ReservationService {
  // ---------- 查询（全部走本地存储） ----------

  getAllReservations() {
    return Promise.resolve(store.list());
  }

  getReservationById(id) {
    return Promise.resolve(store.get(id));
  }

  async getPendingReviewReservations() {
    return store.list().filter((r) => r.status === config.status.PENDING_REVIEW);
  }

  async getPrintingReservations() {
    return store.list().filter((r) => r.status === config.status.PRINTING);
  }

  async getCompletedReservations() {
    return store.list().filter((r) => r.status === config.status.COMPLETED);
  }

  // ---------- 提交（index.js 的上传端点在落盘文件后调用） ----------

  createReservation(input) {
    return Promise.resolve(store.create(input));
  }

  /** 提交后提醒审批人（群播卡片；飞书私聊退役——本地系统无 open_id） */
  async notifyReviewers(reservation) {
    try {
      const card = buildReservationAlertCard({
        fields: {
          '发起人': [{ id: '', name: reservation.applicant }],
          '发起时间': reservation.createdAt,
          '切片文件': [{ name: reservation.fileName }],
          '是否加急': reservation.isUrgent,
          [config.dispatch.materialField]: reservation.materialType,
          [config.dispatch.colorField]: reservation.color,
        },
      });
      if (!quietHours.gatePayload('webhook-card', card, `预约审批提醒卡 ${reservation.id}`)) {
        await sendMessage(card);
      }
    } catch (err) {
      console.error('[预约服务] 通知审批人失败:', err.message);
    }
  }

  // ---------- 审批（管理动作，端点侧挂 X-API-Token） ----------

  /** 审批通过：状态流转 + 群播结果卡 + 入队（本地任务，fileSource=local） */
  async approveReservation(id, reviewer, comment) {
    const reservation = store.get(id);
    if (!reservation) throw new Error('预约记录不存在');
    // 显式状态门槛：仅「待审批」可批。不能只依赖状态机——排队中→已通过是
    // 分发失败回滚的合法流转，放行会让已入队的单被重复审批（2026-10-05 测试暴露）
    if (reservation.status !== config.status.PENDING_REVIEW) {
      throw new Error(`预约当前状态「${reservation.status}」，仅待审批单可审批`);
    }

    store.updateStatus(id, config.status.REVIEW_APPROVED, `审批人：${reviewer || '未署名'}${comment ? `｜意见：${comment}` : ''}`);
    store.setReview(id, { reviewer: reviewer || '', comment: comment || '', result: config.reviewResult.APPROVED });
    await this.notifyReviewResult(store.get(id), config.reviewResult.APPROVED, comment);

    // 入队（幂等；重复审批被状态机挡在上一行）
    const dispatcher = require('./dispatcher');
    const fresh = store.get(id);
    const enqueued = dispatcher.enqueue(dispatcher.buildLocalTask(fresh));
    if (enqueued) store.updateStatus(id, config.status.QUEUED, '已进入打印队列');

    return store.get(id);
  }

  async rejectReservation(id, reviewer, comment) {
    const reservation = store.get(id);
    if (!reservation) throw new Error('预约记录不存在');
    if (reservation.status !== config.status.PENDING_REVIEW) {
      throw new Error(`预约当前状态「${reservation.status}」，仅待审批单可驳回`);
    }

    store.updateStatus(id, config.status.REVIEW_REJECTED, `审批人：${reviewer || '未署名'}${comment ? `｜意见：${comment}` : ''}`);
    store.setReview(id, { reviewer: reviewer || '', comment: comment || '', result: config.reviewResult.REJECTED });
    await this.notifyReviewResult(reservation, config.reviewResult.REJECTED, comment);

    return store.get(id);
  }

  async notifyReviewResult(reservation, result, comment) {
    try {
      const card = buildReviewResultCard({
        fields: {
          '发起人': [{ id: '', name: reservation.applicant }],
          '切片文件': [{ name: reservation.fileName }],
        },
      }, result, comment);
      if (!quietHours.gatePayload('webhook-card', card, `审批结果卡 ${reservation.id}`)) {
        await sendMessage(card);
      }
    } catch (err) {
      console.error('[预约服务] 审批结果播报失败:', err.message);
    }
  }

  // ---------- 取消 ----------

  async cancelReservation(id) {
    const reservation = store.get(id);
    if (!reservation) throw new Error('预约记录不存在');

    store.updateStatus(id, config.status.CANCELLED, '取消预约');
    const dispatcher = require('./dispatcher');
    dispatcher.dequeue(id); // 队列中/分发中/打印中（停机）统一由 dequeue 处理

    return { success: true };
  }

  // ---------- 遗留兼容 ----------

  /** 旧镜像表记录 → 展示形态（历史数据/状态文件遗留任务用；不再有新镜像单） */
  formatReservation(record) {
    const fields = record.fields || {};
    const sliceFile = fields['切片文件'] && fields['切片文件'].length > 0 ? fields['切片文件'][0] : null;

    return {
      recordId: record.record_id,
      applicationNo: fields['申请编号'],
      status: fields['申请状态'] || config.status.PENDING_REVIEW,
      startTime: fields['发起时间'],
      applicant: fields['发起人'] ? {
        id: fields['发起人'][0]?.id,
        name: fields['发起人'][0]?.name,
      } : null,
      isInternalProject: fields['是否为千里内部项目'],
      fileName: sliceFile?.name,
      fileToken: sliceFile?.file_token,
      fileUrl: sliceFile?.url,
      screenshot: fields['切片文件详情截图'],
      isUrgent: fields['是否加急'],
      materialType: fields[config.dispatch.materialField] || '',
      color: fields[config.dispatch.colorField] || '',
      assignedPrinter: fields[config.dispatch.printerField] || '',
      createdAt: record.created_time,
      updatedAt: record.updated_time,
    };
  }
}

const reservationService = new ReservationService();

module.exports = reservationService;
