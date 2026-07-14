const config = require('../config');
const bitableApi = require('../feishu/bitable');
const { downloadFile } = require('../feishu/client');
const { sendMessage, sendTextToUser, buildReservationAlertCard, buildReviewResultCard } = require('../feishu/bot');
const printerManager = require('../printer/manager');

class ReservationService {
  constructor() {
    this.printQueue = [];
    this.isProcessingQueue = false;
  }

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

    const records = await bitableApi.getAllRecords(config.bitable.reservationTableId);
    const record = records.find((r) => r.record_id === recordId);
    if (!record) return null;
    return this.formatReservation(record);
  }

  formatReservation(record) {
    const fields = record.fields;
    const sliceFile = fields['切片文件'] && fields['切片文件'].length > 0 ? fields['切片文件'][0] : null;
    
    return {
      recordId: record.record_id,
      applicant: fields['发起人'] ? {
        id: fields['发起人'][0]?.id,
        name: fields['发起人'][0]?.name,
      } : null,
      startTime: fields['发起时间'],
      endTime: fields.endTime,
      fileName: sliceFile?.name || fields.fileName,
      fileToken: sliceFile?.file_token || fields.fileToken,
      fileUrl: sliceFile?.url,
      printer: fields.printer,
      status: fields['申请状态'] || config.status.PENDING_REVIEW,
      isInternalProject: fields['是否为千里内部项目'],
      screenshot: fields['切片文件详情截图'],
      isUrgent: fields['是否加急'],
      reviewer: fields.reviewer ? {
        id: fields.reviewer[0]?.id,
        name: fields.reviewer[0]?.name,
      } : null,
      reviewResult: fields.reviewResult,
      reviewComment: fields.reviewComment,
      printProgress: fields.printProgress || 0,
      estimatedTime: fields.estimatedTime,
      actualTime: fields.actualTime,
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

    const record = await bitableApi.createRecord(config.bitable.reservationTableId, {
      ...fields,
      status: config.status.PENDING_REVIEW,
    });

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
    if (!fields.printer) {
      return { valid: false, message: '打印机不能为空' };
    }

    return { valid: true, message: '' };
  }

  async checkConflict(printer, startTime, endTime, excludeRecordId = null) {
    const reservations = await this.getAllReservations();
    const overlapping = reservations.filter((r) => {
      if (r.recordId === excludeRecordId) return false;
      if (r.printer !== printer) return false;
      if (r.status === config.status.CANCELLED || r.status === config.status.COMPLETED) return false;

      const rStart = new Date(r.startTime);
      const rEnd = new Date(r.endTime);

      return !(endTime <= rStart || startTime >= rEnd);
    });

    return overlapping.length > 0;
  }

  async notifyReviewers(reservation) {
    try {
      const card = buildReservationAlertCard({
        fields: {
          '发起人': reservation.applicant ? [{ id: reservation.applicant.id, name: reservation.applicant.name }] : [],
          '发起时间': reservation.startTime,
          '切片文件': reservation.fileName ? [{ name: reservation.fileName, file_token: reservation.fileToken }] : [],
          printer: reservation.printer,
          '是否加急': reservation.isUrgent,
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
      status,
      reviewResult,
      reviewComment,
      reviewer: reviewer ? [{ id: reviewer.id, name: reviewer.name }] : [],
    });

    await this.notifyApplicant(reservation, reviewResult, reviewComment);

    if (reviewResult === config.reviewResult.APPROVED) {
      await this.addToPrintQueue(recordId);
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
            ? `您的打印预约已通过审批，文件将上传至打印机并排队打印。\n文件：${reservation.fileName}`
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

  async addToPrintQueue(recordId) {
    if (this.printQueue.includes(recordId)) {
      return;
    }

    this.printQueue.push(recordId);
    console.log(`[预约服务] 预约 ${recordId} 已加入打印队列`);

    if (!this.isProcessingQueue) {
      this.processPrintQueue();
    }
  }

  async processPrintQueue() {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;

    try {
      while (this.printQueue.length > 0) {
        const recordId = this.printQueue[0];

        const availablePrinters = printerManager.getAvailablePrinters();
        if (availablePrinters.length === 0) {
          console.log('[预约服务] 暂无可用打印机，等待中...');
          await new Promise((resolve) => setTimeout(resolve, 30000));
          continue;
        }

        const reservation = await this.getReservationById(recordId);
        if (!reservation) {
          this.printQueue.shift();
          continue;
        }

        let targetPrinter = availablePrinters.find((p) => p.name === reservation.printer);
        if (!targetPrinter) {
          targetPrinter = availablePrinters[0];
        }

        try {
          await this.executePrint(reservation, targetPrinter);
          this.printQueue.shift();
        } catch (err) {
          console.error(`[预约服务] 执行打印失败 ${recordId}:`, err.message);
          await new Promise((resolve) => setTimeout(resolve, 60000));
        }
      }
    } finally {
      this.isProcessingQueue = false;
    }
  }

  async executePrint(reservation, printer) {
    if (!config.bitable.reservationTableId) {
      throw new Error('未配置预约表ID');
    }

    console.log(`[预约服务] 开始执行打印: ${reservation.fileName} -> ${printer.name}`);

    await bitableApi.updateRecord(config.bitable.reservationTableId, reservation.recordId, {
      status: config.status.QUEUED,
    });

    const fileBuffer = await downloadFile(reservation.fileToken);

    const remotePath = await printerManager.uploadFileToPrinter(printer.id, fileBuffer, reservation.fileName);

    console.log(`[预约服务] 文件已上传: ${remotePath}`);

    await bitableApi.updateRecord(config.bitable.reservationTableId, reservation.recordId, {
      status: config.status.PRINTING,
    });

    await printerManager.startPrintOnPrinter(printer.id, remotePath);

    console.log(`[预约服务] 打印已开始: ${reservation.fileName}`);

    await this.monitorPrintProgress(reservation, printer);
  }

  async monitorPrintProgress(reservation, printer) {
    if (!config.bitable.reservationTableId) {
      return;
    }

    return new Promise((resolve) => {
      const checkInterval = setInterval(async () => {
        try {
          const printerState = printerManager.getPrinterState(printer.id);
          if (!printerState) {
            return;
          }

          const progress = printerState.progress || 0;

          await bitableApi.updateRecord(config.bitable.reservationTableId, reservation.recordId, {
            printProgress: progress,
          });

          if (printerState.status === 'idle' || progress >= 100) {
            clearInterval(checkInterval);
            await bitableApi.updateRecord(config.bitable.reservationTableId, reservation.recordId, {
              status: config.status.COMPLETED,
              printProgress: 100,
            });
            resolve();
          }
        } catch (err) {
          console.error(`[预约服务] 监控打印进度失败:`, err.message);
        }
      }, 30000);
    });
  }

  async cancelReservation(recordId) {
    if (!config.bitable.reservationTableId) {
      throw new Error('未配置预约表ID');
    }

    await bitableApi.updateRecord(config.bitable.reservationTableId, recordId, {
      status: config.status.CANCELLED,
    });

    const index = this.printQueue.indexOf(recordId);
    if (index > -1) {
      this.printQueue.splice(index, 1);
    }

    return { success: true };
  }

  async updateReservation(recordId, fields) {
    if (!config.bitable.reservationTableId) {
      throw new Error('未配置预约表ID');
    }

    const allowedFields = ['startTime', 'endTime', 'fileName', 'fileToken', 'printer'];

    const updateFields = {};
    for (const key of allowedFields) {
      if (fields[key] !== undefined) {
        updateFields[key] = fields[key];
      }
    }

    await bitableApi.updateRecord(config.bitable.reservationTableId, recordId, updateFields);

    return this.getReservationById(recordId);
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
