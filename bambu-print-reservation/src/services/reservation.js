const config = require('../config');
const fs = require('fs');
const path = require('path');
const store = require('./reservationStore');
const processRules = require('./processRules');
const { sendMessage, buildReservationAlertCard, buildReviewResultCard } = require('../feishu/bot');
const quietHours = require('../utils/quietHours');

/** 未切片文件判定（2026-10-06 审查批）：需求链路单（stl/step/obj）不能直接驱动真机——
 *  打印机只认切片产物（gcode.3mf），裸模型分发必然失败。审批与人工恢复双闸拦截 */
function isUnslicedFile(reservation) {
  return !!reservation && !/\.3mf$/i.test(String(reservation.fileName || ''));
}
const UNSLICED_HINT = '该单是未切片模型（stl/step）——请先用 Bambu Studio 切片为 3mf 后重新提交（服务端自动切片上线前，需求链路单暂不支持直接分发）';

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

  /** 提交后提醒审批人（群播卡片；3mf 直通单附内嵌参数摘要——审批透明化） */
  async notifyReviewers(reservation) {
    try {
      const embedLine = reservation.embeddedParams?.params
        ? [{
            tag: 'markdown',
            content: `**内嵌参数**: ${Object.entries(reservation.embeddedParams.params).slice(0, 8)
              .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join('|') : v}`).join(' · ')}`,
          }]
        : [];
      const card = buildReservationAlertCard({
        fields: {
          '发起人': [{ id: '', name: reservation.applicant }],
          '发起时间': reservation.createdAt,
          '切片文件': [{ name: reservation.fileName }],
          '是否加急': reservation.isUrgent,
          [config.dispatch.materialField]: reservation.materialType,
          [config.dispatch.colorField]: reservation.color,
        },
      }, embedLine);
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
    // 未切片文件闸：需求链路单（stl/step）审批通过会直接驱动真机打裸文件——拦截
    if (isUnslicedFile(reservation)) {
      throw new Error(`「${reservation.fileName}」${UNSLICED_HINT}`);
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

  // ---------- 复刻（2026-10-08：已完成单一键带参重提，打坏了重打/帮同学打同款） ----------

  /**
   * 从既有记录复制提交一份新预约（新单号、发起人=当前登录者）。
   * 源文件在保留期内 → 服务端直接复制文件（浏览器无需重传 200MB）；
   * 需求链路单按当前规则库**重新定档**（规则库可能已演进），3mf 直通单保持快照为空。
   * overrides 可覆盖 color/quantity/assignedPrinter/materialType/isUrgent
   */
  async reprintReservation(id, requester, overrides = {}) {
    const src = store.get(id);
    if (!src) throw new Error('预约记录不存在');
    if (src.fileCleaned) throw new Error('源文件已过保留期被清理，请重新上传模型文件');

    // 服务端复制源文件（复刻单与源单生命周期独立：源单日后清理不影响复刻单）
    const ext = path.extname(src.fileName || '') || '.3mf';
    const newPath = path.join(store.UPLOAD_DIR, `${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
    try {
      fs.mkdirSync(store.UPLOAD_DIR, { recursive: true });
      await fs.promises.copyFile(src.filePath, newPath);
    } catch (err) {
      throw new Error(`源文件已不存在（${err.code === 'ENOENT' ? '可能已过保留期清理' : err.message}），请重新上传模型文件`);
    }

    const pick = (key, fallback) => (overrides[key] !== undefined && overrides[key] !== null && overrides[key] !== ''
      ? overrides[key] : fallback);
    const materialType = pick('materialType', src.materialType);
    const isSliced = /\.3mf$/i.test(String(src.fileName || ''));

    let applied = null;
    if (!isSliced) {
      applied = processRules.applyRules(src.selection || {}, { material: materialType });
      if (applied.blocked) {
        try { fs.unlinkSync(newPath); } catch { /* 已不存在 */ }
        const err = new Error('需求勾选存在硬冲突（规则库可能已更新）');
        err.details = { errors: applied.errors, warnings: applied.warnings };
        throw err;
      }
    }

    let record;
    try {
      record = store.create({
        applicant: requester.displayName,
        submittedBy: requester.id,
        fileName: src.fileName,
        filePath: newPath,
        fileSize: src.fileSize,
        materialType,
        color: pick('color', src.color),
        assignedPrinter: pick('assignedPrinter', src.assignedPrinter),
        isUrgent: pick('isUrgent', src.isUrgent),
        quantity: pick('quantity', src.quantity),
        estMinutes: src.estMinutes,
        selection: src.selection || {},
        processParams: applied ? applied.params : null,
        appliedRules: applied ? applied.applied : [],
        embeddedParams: src.embeddedParams, // 3mf 直通单参数摘要随单携带
      });
    } catch (err) {
      try { fs.unlinkSync(newPath); } catch { /* 已不存在 */ }
      throw err;
    }
    return store.get(record.id);
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
