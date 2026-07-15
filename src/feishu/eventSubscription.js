const config = require('../config');
const reservationService = require('../services/reservation');
const printerManager = require('../printer/manager');
const { sendMessage, buildPrintStatusCard } = require('./bot');

async function startEventSubscription() {
  if (!config.feishuEvent.useLongConnection) {
    console.log('[事件订阅] 未启用长连接模式');
    return;
  }

  console.log('[事件订阅] 事件订阅功能已启用');
}

async function processBitableEvent(event) {
  try {
    const { table_id, record_id, action_type, fields } = event;

    if (table_id === config.bitable.reservationTableId) {
      await handleReservationEvent(record_id, action_type, fields);
    }

    if (table_id === config.bitable.printerTableId) {
      await handlePrinterEvent(record_id, action_type, fields);
    }
  } catch (err) {
    console.error('[事件订阅] 处理事件失败:', err.message);
  }
}

async function handleReservationEvent(recordId, actionType, fields) {
  console.log(`[事件订阅] 预约表事件: ${actionType} - ${recordId}`);

  if (actionType === 'create') {
    console.log('[事件订阅] 新预约创建:', fields);
    
    const reservationService = require('../services/reservation');
    const reservation = await reservationService.getReservationById(recordId);
    if (reservation) {
      await reservationService.notifyReviewers(reservation);
    }
  }

  if (actionType === 'update') {
    const newStatus = fields['申请状态'];
    
    if (newStatus === config.status.REVIEW_APPROVED) {
      await reservationService.addToPrintQueue(recordId);
    }

    if (newStatus === config.status.CANCELLED) {
      await reservationService.cancelReservation(recordId);
    }
  }
}

async function handlePrinterEvent(recordId, actionType, fields) {
  console.log(`[事件订阅] 打印机表事件: ${actionType} - ${recordId}`);
}

async function processPrinterStatusChange(printerState) {
  try {
    const card = buildPrintStatusCard(
      printerState.name,
      printerState.status,
      printerState.progress,
      printerState.currentJob
    );

    await sendMessage(card);
  } catch (err) {
    console.error('[事件订阅] 发送打印机状态通知失败:', err.message);
  }
}

printerManager.on('statusChange', (printerState) => {
  processPrinterStatusChange(printerState);
});

module.exports = {
  startEventSubscription,
  processBitableEvent,
};
