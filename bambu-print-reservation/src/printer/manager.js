const config = require('../config');
const PrinterClient = require('./client');
const bitableApi = require('../feishu/bitable');

// 判断打印机是否支持自动分发（Bambu 系 MQTT+文件上传；闪铸等异构机型走人工通道）
function isAutoDispatchable(printer) {
  const model = String(printer.model || '').toUpperCase();
  return model.includes('X1') || model.includes('H2D') || model.includes('P1') || model.includes('A1');
}

class PrinterManager {
  constructor() {
    this.clients = {};
    this.printerStates = {};
    this.listeners = [];
    this.init();
  }

  async init() {
    for (const printer of config.printers) {
      this.printerStates[printer.id] = {
        ...printer,
        autoDispatch: isAutoDispatchable(printer),
        status: '未连接',
        gcodeState: '',
        currentJob: '',
        progress: 0,
        remainingTime: 0,
        nozzleTemp: null,
        bedTemp: null,
        chamberTemp: null,
        ams: [],
        // 当前正在执行的任务（dispatcher 写入，用于播报与状态展示）
        activeTask: null,
        lastUpdate: new Date(),
      };

      if (!this.printerStates[printer.id].autoDispatch) {
        console.log(`[打印机管理] ${printer.name}(${printer.model}) 为非 Bambu 机型，仅登记不参与自动分发`);
        continue;
      }

      const client = new PrinterClient(printer);
      this.clients[printer.id] = client;

      client.on('connect', () => this.handleConnect(printer.id));
      client.on('disconnect', () => this.handleDisconnect(printer.id));
      client.on('state', (state) => this.handleStateChange(printer.id, state));
      client.on('error', (err) => this.handleError(printer.id, err));

      setTimeout(() => this.connectPrinter(printer.id), printer.id * 2000);
    }

    await this.syncPrinterStatusToBitable();
  }

  async connectPrinter(printerId) {
    const client = this.clients[printerId];
    if (!client) {
      console.error(`[打印机管理] 未找到打印机 ${printerId}`);
      return;
    }

    try {
      await client.connect();
    } catch (err) {
      console.error(`[打印机管理] 打印机 ${printerId} 连接失败:`, err.message);
      this.updateState(printerId, { status: '故障' });
    }
  }

  async disconnectPrinter(printerId) {
    const client = this.clients[printerId];
    if (!client) return;

    await client.disconnect();
  }

  handleConnect(printerId) {
    console.log(`[打印机管理] 打印机 ${printerId} 已连接`);
    // 连接建立后立刻拉一次全量状态（含 AMS），status 由 state 消息刷新
    const client = this.clients[printerId];
    if (client) {
      const state = client.getState();
      if (state) this.handleStateChange(printerId, state);
    }
    this.updateState(printerId, {});
  }

  handleDisconnect(printerId) {
    console.log(`[打印机管理] 打印机 ${printerId} 已断开`);
    this.updateState(printerId, { status: '未连接', gcodeState: '' });
  }

  /**
   * 状态刷新：以 gcodeState 为准映射中文状态；
   * 只在状态真正变化时发 statusChange，gcodeState 关键变迁额外发 jobEvent
   */
  handleStateChange(printerId, state) {
    const client = this.clients[printerId];
    if (!client) return;

    const status = client.getPrintStatus();
    if (!status) return;

    const prev = this.printerStates[printerId];
    const prevState = prev.gcodeState;

    this.updateState(printerId, {
      status: status.status,
      gcodeState: status.gcodeState,
      currentJob: status.currentFile,
      progress: status.progress,
      remainingTime: status.remainingTime,
      nozzleTemp: status.nozzleTemp,
      bedTemp: status.bedTemp,
      chamberTemp: status.chamberTemp,
      ams: client.getAmsTrays(),
    });

    // 关键变迁 → jobEvent（dispatcher 用它触发匹配、播报用它与完成/失败）
    if (prevState && prevState !== status.gcodeState) {
      const to = status.gcodeState;
      let event = null;
      if (to === 'PRINTING' && !['RESUME'].includes(prevState)) event = 'start';
      else if (to === 'FINISH') event = 'finish';
      else if (to === 'FAILED') event = 'failed';
      else if ((to === 'IDLE' || to === 'FINISH') && prevState === 'PRINTING') event = 'idle';

      if (event) {
        console.log(`[打印机管理] ${prev.name} 任务变迁: ${prevState} → ${to} (${event})`);
        this.notifyListeners('jobEvent', { printer: this.printerStates[printerId], event, prevState, gcodeState: to });
      }
    }
  }

  handleError(printerId, err) {
    console.error(`[打印机管理] 打印机 ${printerId} 错误:`, err.message);
    this.updateState(printerId, { status: '故障' });
  }

  updateState(printerId, patch) {
    const prev = this.printerStates[printerId];
    if (!prev) return;
    const next = { ...prev, ...patch, lastUpdate: new Date() };
    const changed = Object.keys(patch).some((k) => patch[k] !== prev[k]);
    this.printerStates[printerId] = next;
    if (changed) {
      this.notifyListeners('statusChange', next);
    }
  }

  on(event, callback) {
    this.listeners.push({ event, callback });
  }

  off(event, callback) {
    this.listeners = this.listeners.filter(
      (l) => !(l.event === event && l.callback === callback)
    );
  }

  notifyListeners(event, ...args) {
    this.listeners.forEach((l) => {
      if (l.event === event) {
        try {
          l.callback(...args);
        } catch (err) {
          console.error(`[打印机管理] 监听器错误:`, err.message);
        }
      }
    });
  }

  getPrinterState(printerId) {
    return this.printerStates[printerId] || null;
  }

  getAllPrinterStates() {
    return Object.values(this.printerStates);
  }

  /**
   * 可承接自动分发的打印机：Bambu 系且空闲/已完成
   */
  getAvailablePrinters() {
    return Object.values(this.printerStates).filter(
      (p) => p.autoDispatch && ['空闲', '已完成'].includes(p.status)
    );
  }

  async getPrinterByName(name) {
    const printer = Object.values(this.printerStates).find((p) => p.name === name);
    if (!printer) return null;
    return {
      ...printer,
      client: this.clients[printer.id],
    };
  }

  async uploadFileToPrinter(printerId, buffer, fileName) {
    const client = this.clients[printerId];
    if (!client || !client.connected) {
      throw new Error('打印机未连接');
    }

    const remotePath = `/sdcard/${fileName}`;
    await client.uploadBuffer(Buffer.from(buffer), remotePath);
    return remotePath;
  }

  async startProjectOnPrinter(printerId, fileName, subtaskName, useAms = true) {
    const client = this.clients[printerId];
    if (!client || !client.connected) {
      throw new Error('打印机未连接');
    }
    await client.startProjectFile(fileName, subtaskName, useAms);
  }

  async startPrintOnPrinter(printerId, filePath) {
    const client = this.clients[printerId];
    if (!client || !client.connected) {
      throw new Error('打印机未连接');
    }

    await client.startPrint(filePath);
  }

  async pausePrintOnPrinter(printerId) {
    const client = this.clients[printerId];
    if (!client || !client.connected) {
      throw new Error('打印机未连接');
    }

    await client.pausePrint();
  }

  async resumePrintOnPrinter(printerId) {
    const client = this.clients[printerId];
    if (!client || !client.connected) {
      throw new Error('打印机未连接');
    }

    await client.resumePrint();
  }

  async stopPrintOnPrinter(printerId) {
    const client = this.clients[printerId];
    if (!client || !client.connected) {
      throw new Error('打印机未连接');
    }

    await client.stopPrint();
  }

  async syncPrinterStatusToBitable() {
    if (!config.bitable.printerTableId) {
      return; // 未配置打印机表时静默跳过（每 60s 一次，不刷 warn）
    }

    try {
      const existingRecords = await bitableApi.getAllRecords(config.bitable.printerTableId);

      for (const printer of Object.values(this.printerStates)) {
        const existingRecord = existingRecords.find(
          (r) => r.fields.printerName === printer.name
        );

        const fields = {
          printerName: printer.name,
          printerModel: printer.model,
          ipAddress: printer.host,
          status: printer.status,
          currentJob: printer.currentJob || '',
          progress: printer.progress,
          temperature: [
            printer.nozzleTemp ? `喷嘴: ${printer.nozzleTemp}°C` : '',
            printer.bedTemp ? `热床: ${printer.bedTemp}°C` : '',
            printer.chamberTemp ? `腔室: ${printer.chamberTemp}°C` : '',
          ].filter(Boolean).join(' | ') || '',
          lastUpdate: new Date().toISOString(),
        };

        if (existingRecord) {
          await bitableApi.updateRecord(
            config.bitable.printerTableId,
            existingRecord.record_id,
            fields
          );
        } else {
          await bitableApi.createRecord(config.bitable.printerTableId, fields);
        }
      }
    } catch (err) {
      console.error('[打印机管理] 同步打印机状态失败:', err.message);
    }
  }

  async cleanupFileSessions() {
    for (const client of Object.values(this.clients)) {
      await client.disconnectFileSession();
    }
  }
}

const printerManager = new PrinterManager();

setInterval(() => {
  printerManager.syncPrinterStatusToBitable();
}, 60000);

module.exports = printerManager;
