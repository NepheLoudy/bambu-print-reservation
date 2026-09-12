const express = require('express');
const cors = require('cors');
const config = require('./config');
const reservationService = require('./services/reservation');
const approvalService = require('./services/approvalService');
const dispatcher = require('./services/dispatcher');
const printerManager = require('./printer/manager');
const { startEventSubscription, processBitableEvent, processApprovalEvent, processApprovalTaskEvent } = require('./feishu/eventSubscription');
const {
  processChatMessage,
  executeCommand,
  handlePrintHelpCommand,
  handlePrintStatusCommand,
  handlePrintAmsCommand,
  handlePrintListCommand,
  handlePrintPendingCommand,
  handlePrintDispatchCommand,
} = require('./services/chatService');

const app = express();

app.use(cors());
// 审批事件/表单可能较大（AGENTS.md 通用坑：express.json 放宽到 2mb）
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    printers: config.printers.length,
    quietHours: require('./utils/quietHours').getStatus(),
  });
});

// ---------- 定制窗口（规则见顶层 AGENTS「机器人后端定制窗口」）：定制项全景只读 ----------

app.get('/api/print/policy', (req, res) => {
  let queue = null;
  try { queue = dispatcher.getQueueSnapshot(); } catch (err) { queue = null; }
  let printing = null;
  try { printing = dispatcher.getPrintingSnapshot(); } catch (err) { printing = null; }
  res.json({
    bot: { name: config.bot?.name || 'bambu-print-reservation', port: config.port },
    printers: {
      configured: config.printers.length,
      list: config.printers.map((p) => ({ id: p.id, name: p.name, model: p.model })),
      available: (() => { try { return printerManager.getAvailablePrinters().length; } catch { return null; } })(),
    },
    approval: {
      primaryChannel: config.approval.enabled,
      approvalCodeConfigured: Boolean(config.approval.approvalCode),
      autoApprove: Boolean(config.approval.autoApproverId),
      reconcileMinutes: config.approval.reconcileMinutes,
      reconcileWindowMinutes: config.approval.reconcileWindowMinutes,
    },
    dispatch: {
      colorDistanceThreshold: config.dispatch.colorDistanceThreshold,
      reconcileMinutes: config.dispatch.reconcileMinutes,
      materialRemindMinutes: config.dispatch.materialRemindMinutes,
      useAms: config.dispatch.useAms,
      maxRetries: config.dispatch.maxRetries,
      retryCooldownMs: config.dispatch.retryCooldownMs,
    },
    queue: { waiting: Array.isArray(queue) ? queue.length : null, printingCount: printing ? (Array.isArray(printing) ? printing.length : Object.keys(printing).length) : null },
    reviewResult: config.reviewResult,
  });
});

app.get('/api/reservations', async (req, res) => {
  try {
    const reservations = await reservationService.getAllReservations();
    res.json(reservations);
  } catch (err) {
    console.error('获取预约列表失败:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/reservations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const reservation = await reservationService.getReservationById(id);
    if (!reservation) {
      return res.status(404).json({ error: '预约记录不存在' });
    }
    res.json(reservation);
  } catch (err) {
    console.error('获取预约失败:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/reservations', async (req, res) => {
  try {
    const reservation = await reservationService.createReservation(req.body);
    res.json(reservation);
  } catch (err) {
    console.error('创建预约失败:', err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/reservations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ error: '状态不能为空' });
    }

    const reservation = await reservationService.getReservationById(id);
    if (!reservation) {
      return res.status(404).json({ error: '预约记录不存在' });
    }

    if (status === config.status.REVIEW_APPROVED) {
      await reservationService.handleReviewResult(id, config.reviewResult.APPROVED, '', '');
    } else if (status === config.status.CANCELLED) {
      await reservationService.cancelReservation(id);
    } else {
      const bitableApi = require('./feishu/bitable');
      await bitableApi.updateRecord(config.bitable.reservationTableId, id, {
        '申请状态': status,
      });
    }

    res.json(await reservationService.getReservationById(id));
  } catch (err) {
    console.error('更新预约失败:', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/reservations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await reservationService.cancelReservation(id);
    res.json({ success: true });
  } catch (err) {
    console.error('取消预约失败:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/reservations/:id/review', async (req, res) => {
  try {
    const { id } = req.params;
    const { reviewResult, reviewComment, reviewer } = req.body;
    
    if (!reviewResult) {
      return res.status(400).json({ error: '审查结果不能为空' });
    }

    const result = await reservationService.handleReviewResult(id, reviewResult, reviewComment, reviewer);
    res.json(result);
  } catch (err) {
    console.error('处理审查结果失败:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/reservations/status/pending-review', async (req, res) => {
  try {
    const reservations = await reservationService.getPendingReviewReservations();
    res.json(reservations);
  } catch (err) {
    console.error('获取待审批预约失败:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/reservations/status/printing', async (req, res) => {
  try {
    const reservations = await reservationService.getPrintingReservations();
    res.json(reservations);
  } catch (err) {
    console.error('获取打印中预约失败:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/reservations/status/completed', async (req, res) => {
  try {
    const reservations = await reservationService.getCompletedReservations();
    res.json(reservations);
  } catch (err) {
    console.error('获取已完成预约失败:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/printers', (req, res) => {
  try {
    const printers = printerManager.getAllPrinterStates();
    res.json(printers);
  } catch (err) {
    console.error('获取打印机状态失败:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/printers/available', (req, res) => {
  try {
    const printers = printerManager.getAvailablePrinters();
    res.json(printers);
  } catch (err) {
    console.error('获取可用打印机失败:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/printers/:id', (req, res) => {
  try {
    const { id } = req.params;
    const printer = printerManager.getPrinterState(parseInt(id));
    if (!printer) {
      return res.status(404).json({ error: '打印机不存在' });
    }
    res.json(printer);
  } catch (err) {
    console.error('获取打印机状态失败:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/printers/:id/print', async (req, res) => {
  try {
    const { id } = req.params;
    const { filePath } = req.body;
    
    if (!filePath) {
      return res.status(400).json({ error: '文件路径不能为空' });
    }

    await printerManager.startPrintOnPrinter(parseInt(id), filePath);
    res.json({ success: true });
  } catch (err) {
    console.error('开始打印失败:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/printers/:id/pause', async (req, res) => {
  try {
    const { id } = req.params;
    await printerManager.pausePrintOnPrinter(parseInt(id));
    res.json({ success: true });
  } catch (err) {
    console.error('暂停打印失败:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/printers/:id/resume', async (req, res) => {
  try {
    const { id } = req.params;
    await printerManager.resumePrintOnPrinter(parseInt(id));
    res.json({ success: true });
  } catch (err) {
    console.error('恢复打印失败:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/printers/:id/stop', async (req, res) => {
  try {
    const { id } = req.params;
    await printerManager.stopPrintOnPrinter(parseInt(id));
    res.json({ success: true });
  } catch (err) {
    console.error('停止打印失败:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/feishu/event', async (req, res) => {
  const { type, challenge, token, header, event } = req.body;

  if (config.feishuEvent.verificationToken && token !== config.feishuEvent.verificationToken) {
    return res.status(403).json({ error: 'Invalid verification token' });
  }

  if (type === 'url_verification') {
    return res.json({ challenge });
  }

  // 官方审批实例事件（网关转发，秒级）：审批状态直接驱动分发
  if (header?.event_type === 'approval_instance') {
    setImmediate(async () => {
      try {
        await processApprovalEvent(event || {});
      } catch (err) {
        console.error('处理审批事件失败:', err);
      }
    });
  }

  // 官方审批任务事件（网关转发，秒级）：自动审批入口
  if (header?.event_type === 'approval_task') {
    setImmediate(async () => {
      try {
        await processApprovalTaskEvent(event || {});
      } catch (err) {
        console.error('处理审批任务事件失败:', err);
      }
    });
  }

  if (header?.event_type === 'bitable.record.create' || header?.event_type === 'bitable.record.update') {
    setImmediate(async () => {
      try {
        const tableId = event?.table_id;
        const recordId = event?.record?.record_id;
        const actionType = header?.event_type === 'bitable.record.create' ? 'create' : 'update';
        const fields = event?.record?.fields;

        if (tableId && recordId && fields) {
          const bitableEvent = {
            table_id: tableId,
            record_id: recordId,
            action_type: actionType,
            fields: fields,
          };
          await processBitableEvent(bitableEvent);
        }
      } catch (err) {
        console.error('处理飞书事件失败:', err);
      }
    });
  }

  if (header?.event_type === 'im.message.receive_v1') {
    setImmediate(async () => {
      try {
        await processChatMessage(event);
      } catch (err) {
        console.error('处理消息事件失败:', err);
      }
    });
  }

  res.json({ code: 0, msg: 'success' });
});

app.post('/api/chat/command', async (req, res) => {
  try {
    const { command, args } = req.body;

    if (!command) {
      return res.status(400).json({ error: '指令不能为空' });
    }

    const reply = await executeCommand(command, args || []);
    res.json({ reply });
  } catch (err) {
    console.error('处理指令失败:', err);
    res.json({ reply: `❌ 指令执行失败：${err.message}` });
  }
});

// ---------- 分发引擎 ----------

app.get('/api/dispatch/queue', (req, res) => {
  res.json({ queue: dispatcher.getQueueSnapshot(), printing: dispatcher.getPrintingSnapshot() });
});

app.post('/api/dispatch/manual', async (req, res) => {
  try {
    const { recordId, printerName } = req.body;
    if (!recordId || !printerName) {
      return res.status(400).json({ error: 'recordId 和 printerName 不能为空' });
    }
    const result = await dispatcher.manualDispatch(recordId, printerName);
    res.json(result);
  } catch (err) {
    console.error('手动分发失败:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/dispatch/reconcile', async (req, res) => {
  try {
    await dispatcher.reconcile();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 审批源对账（手动触发）：重拉失败登记 + 补扫窗口内漏收事件的审批实例
app.post('/api/approval/reconcile', async (req, res) => {
  try {
    const handled = await approvalService.reconcileApprovals();
    res.json({ success: true, handled });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function startServer() {
  const server = app.listen(config.port, () => {
    console.log(`🚀 拓竹3D打印预约系统运行在 http://localhost:${config.port}`);
    console.log(`📚 API 健康检查: http://localhost:${config.port}/api/health`);
    console.log(`🖨️ 打印机数量: ${config.printers.length}`);
  });

  startEventSubscription();

  // 晚间静默：启动时若有积压通知，按当前时点调度补发（过点立即、未过点等到窗口结束整点）
  require('./utils/quietHours').initQuietHoursFlush();

  process.on('SIGINT', async () => {
    console.log('\n正在关闭服务器...');
    await printerManager.cleanupFileSessions();
    server.close(() => {
      console.log('服务器已关闭');
      process.exit(0);
    });
  });

  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = app;
