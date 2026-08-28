const config = require('../config');
const PrinterClient = require('./client');
const bitableApi = require('../feishu/bitable');

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
        status: 'disconnected',
        currentJob: '',
        progress: 0,
        nozzleTemp: null,
        bedTemp: null,
        chamberTemp: null,
        lastUpdate: new Date(),
      };

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
      this.printerStates[printerId].status = 'fault';
      this.notifyListeners('statusChange', this.printerStates[printerId]);
    }
  }

  async disconnectPrinter(printerId) {
    const client = this.clients[printerId];
    if (!client) return;

    await client.disconnect();
  }

  handleConnect(printerId) {
    console.log(`[打印机管理] 打印机 ${printerId} 已连接`);
    this.printerStates[printerId].status = 'connected';
    this.notifyListeners('statusChange', this.printerStates[printerId]);
  }

  handleDisconnect(printerId) {
    console.log(`[打印机管理] 打印机 ${printerId} 已断开`);
    this.printerStates[printerId].status = 'disconnected';
    this.notifyListeners('statusChange', this.printerStates[printerId]);
  }

  handleStateChange(printerId, state) {
    const job = state.job || {};
    const temps = state.temps || {};

    const newState = {
      ...this.printerStates[printerId],
      status: job.stage === 'printing' ? 'printing' : 
              job.stage === 'paused' ? 'paused' : 
              job.stage === 'finished' ? 'idle' : 'idle',
      currentJob: job.file || '',
      progress: job.progress || 0,
      nozzleTemp: temps.nozzle || null,
      bedTemp: temps.bed || null,
      chamberTemp: temps.chamber || null,
      remainingTime: job.remaining_time || 0,
      lastUpdate: new Date(),
    };

    this.printerStates[printerId] = newState;
    this.notifyListeners('statusChange', newState);
  }

  handleError(printerId, err) {
    console.error(`[打印机管理] 打印机 ${printerId} 错误:`, err.message);
    this.printerStates[printerId].status = 'fault';
    this.notifyListeners('statusChange', this.printerStates[printerId]);
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

  getAvailablePrinters() {
    return Object.values(this.printerStates).filter(
      (p) => p.status === 'idle' || p.status === 'connected'
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
    await client.uploadFileFromBuffer(buffer, remotePath);
    return remotePath;
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
      console.warn('[打印机管理] 未配置打印机表ID，跳过同步');
      return;
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

      console.log('[打印机管理] 打印机状态已同步到多维表格');
    } catch (err) {
      console.error('[打印机管理] 同步打印机状态失败:', err.message);
    }
  }

  async cleanupFTPConnections() {
    for (const client of Object.values(this.clients)) {
      await client.disconnectFTP();
    }
  }
}

const printerManager = new PrinterManager();

setInterval(() => {
  printerManager.syncPrinterStatusToBitable();
}, 60000);

module.exports = printerManager;
