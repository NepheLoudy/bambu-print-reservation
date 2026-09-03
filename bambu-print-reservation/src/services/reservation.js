const config = require('../config');
const bitableApi = require('../feishu/bitable');
const { sendMessage, sendTextToUser, buildReservationAlertCard, buildReviewResultCard } = require('../feishu/bot');

// 注意：本模块被 dispatcher.js 依赖，对 dispatcher 的引用必须惰性 require（避免循环加载）

class ReservationService {
  async getAllReservations() {
    if (!config.bitable.reservationTableId) {
      throw new Error('未配置预约表ID');
    }

    const records = await bitableApi.getAllRecords(config.bitable.reservationTableId);
    return records.map(this.formatReservation);
  }

  async getReservationById(recordId) {
    if (!config.bitable.reservationTableId) {
      throw new Error('未配置预约表ID');
    }

    const record = await bitableApi.getRecord(config.bitable.reservationTableId, recordId);
    if (!record) return null;
    return this.formatReservation(record);
  }

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
      // 分发引擎字段（审批表单补齐后生效）
      materialType: fields[config.dispatch.materialField] || '',
      color: fields[config.dispatch.colorField] || '',
      assignedPrinter: fields[config.dispatch.printerField] || '',
      createdAt: record.created_time,
      updatedAt: record.updated_time,
    };
  }

  async createReservation(fields) {
    if (!config.bitable.reservationTableId) {
      throw new Error('未配置预约表ID');
    }

    const validation = this.validateReservation(fields);
    if (!validation.valid) {
      throw new Error(validation.message);
    }

    const record = await bitableApi.createRecord(config.bitable.reservationTableId, fields);

    const reservation = this.formatReservation(record);

    await this.notifyReviewers(reservation);

    return reservation;
  }

  validateReservation(fields) {
    if (!fields['发起人'] || !fields['发起人'].length) {
      return { valid: false, message: '发起人不能为空' };
    }
    if (!fields['发起时间']) {
      return { valid: false, message: '发起时间不能为空' };
    }
    if (!fields['切片文件'] || !fields['切片文件'].length) {
      return { valid: false, message: '切片文件不能为空' };
    }

    return { valid: true, message: '' };
  }

  async notifyReviewers(reservation) {
    try {
      const card = buildReservationAlertCard({
        fields: {
          '发起人': reservation.applicant ? [{ id: reservation.applicant.id, name: reservation.applicant.name }] : [],
          '发起时间': reservation.startTime,
          '切片文件': reservation.fileName ? [{ name: reservation.fileName, file_token: reservation.fileToken }] : [],
          '是否加急': reservation.isUrgent,
          [config.dispatch.materialField]: reservation.materialType,
          [config.dispatch.colorField]: reservation.color,
        },
      });

      await sendMessage(card);

      if (config.reviewers && config.reviewers.length > 0) {
        for (const reviewerId of config.reviewers) {
          try {
            await sendTextToUser(reviewerId, `有新的打印预约需要您审批，请在飞书多维表格中查看并处理。\n文件：${reservation.fileName}`);
          } catch (err) {
            console.error(`[预约服务] 通知审批者 ${reviewerId} 失败:`, err.message);
          }
        }
      }
    } catch (err) {
      console.error('[预约服务] 通知审批者失败:', err.message);
    }
  }

  async handleReviewResult(recordId, reviewResult, reviewComment, reviewer) {
    if (!config.bitable.reservationTableId) {
      throw new Error('未配置预约表ID');
    }

    const reservation = await this.getReservationById(recordId);
    if (!reservation) {
      throw new Error('预约记录不存在');
    }

    const status = reviewResult === config.reviewResult.APPROVED
      ? config.status.REVIEW_APPROVED
      : config.status.REVIEW_REJECTED;

    await bitableApi.updateRecord(config.bitable.reservationTableId, recordId, {
      '申请状态': status,
    });

    await this.notifyApplicant(reservation, reviewResult, reviewComment);

    if (reviewResult === config.reviewResult.APPROVED) {
      // 状态写回会触发表格事件 → 由事件监听统一入队；这里主动入一次兜底（幂等）
      const dispatcher = require('./dispatcher');
      const fresh = await this.getReservationById(recordId);
      dispatcher.enqueue(fresh, { silent: true });
    }

    return { success: true };
  }

  async notifyApplicant(reservation, reviewResult, reviewComment) {
    try {
      const card = buildReviewResultCard({
        fields: {
          '发起人': reservation.applicant ? [{ id: reservation.applicant.id, name: reservation.applicant.name }] : [],
          '切片文件': reservation.fileName ? [{ name: reservation.fileName }] : [],
        },
      }, reviewResult, reviewComment);

      await sendMessage(card);

      if (reservation.applicant && reservation.applicant.id) {
        try {
          const message = reviewResult === config.reviewResult.APPROVED
            ? `您的打印预约已通过审批，已进入打印队列，将按材料自动匹配打印机。\n文件：${reservation.fileName}`
            : `您的打印预约未通过审批，请查看审批意见并修改后重新提交。\n文件：${reservation.fileName}\n意见：${reviewComment}`;
          await sendTextToUser(reservation.applicant.id, message);
        } catch (err) {
          console.error(`[预约服务] 通知发起人 ${reservation.applicant.id} 失败:`, err.message);
        }
      }
    } catch (err) {
      console.error('[预约服务] 通知发起人失败:', err.message);
    }
  }

  async cancelReservation(recordId) {
    if (!config.bitable.reservationTableId) {
      throw new Error('未配置预约表ID');
    }

    await bitableApi.updateRecord(config.bitable.reservationTableId, recordId, {
      '申请状态': config.status.CANCELLED,
    });

    const dispatcher = require('./dispatcher');
    dispatcher.dequeue(recordId);

    return { success: true };
  }

  async getPendingReviewReservations() {
    const reservations = await this.getAllReservations();
    return reservations.filter((r) => r.status === config.status.PENDING_REVIEW);
  }

  async getPrintingReservations() {
    const reservations = await this.getAllReservations();
    return reservations.filter((r) => r.status === config.status.PRINTING);
  }

  async getCompletedReservations() {
    const reservations = await this.getAllReservations();
    return reservations.filter((r) => r.status === config.status.COMPLETED);
  }
}

const reservationService = new ReservationService();

module.exports = reservationService;
