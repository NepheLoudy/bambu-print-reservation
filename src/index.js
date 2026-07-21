const express = require('express');
const cors = require('cors');
const config = require('./config');
const reservationService = require('./services/reservation');
const printerManager = require('./printer/manager');
const { startEventSubscription, processBitableEvent } = require('./feishu/eventSubscription');
const { processChatMessage, handlePrintHelpCommand, handlePrintStatusCommand, handlePrintListCommand, handlePrintPendingCommand } = require('./services/chatService');

const app = express();

app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    printers: config.printers.length,
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

    await bitableApi.updateRecord(config.bitable.reservationTableId, id, {
      '申请状态': status,
    });
    
    const reservation = await reservationService.getReservationById(id);
    res.json(reservation);
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

app.get('/api/printers/available', (req, res) => {
  try {
    const printers = printerManager.getAvailablePrinters();
    res.json(printers);
  } catch (err) {
    console.error('获取可用打印机失败:', err);
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

    const commandHandlers = {
      '/print-help': handlePrintHelpCommand,
      '/print-status': handlePrintStatusCommand,
      '/print-list': handlePrintListCommand,
      '/print-pending': handlePrintPendingCommand,
    };

    const handler = commandHandlers[command];
    if (!handler) {
      return res.json({ reply: `❌ 未知指令：${command}` });
    }

    const reply = await handler(args || []);
    res.json({ reply });
  } catch (err) {
    console.error('处理指令失败:', err);
    res.json({ reply: `❌ 指令执行失败：${err.message}` });
  }
});

function startServer() {
  const server = app.listen(config.port, () => {
    console.log(`🚀 拓竹3D打印预约系统运行在 http://localhost:${config.port}`);
    console.log(`📚 API 健康检查: http://localhost:${config.port}/api/health`);
    console.log(`🖨️ 打印机数量: ${config.printers.length}`);
  });

  startEventSubscription();

  process.on('SIGINT', async () => {
    console.log('\n正在关闭服务器...');
    await printerManager.cleanupFTPConnections();
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
