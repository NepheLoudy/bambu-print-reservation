const config = require('../config');
const PrinterClient = require('./client');
const bitableApi = require('../feishu/bitable');

// 判断打印机是否支持自动分发（Bambu 系 MQTT+文件上传；闪铸等异构机型走人工通道）
function isAutoDispatchable(printer) {
  const model = String(printer.model || '').toUpperCase();
  return model.includes('X1') || model.includes('H2D') || model.includes('P1') || model.includes('A1');
}

/**
 * gcodeState 变迁 → jobEvent 判定（纯函数，单测覆盖）。
 * prevState 为空（服务重启/重连后的首个报文）时：完成事件可能落在停机窗口——
 * 打印机实况 FINISH 且引擎仍登记着 activeTask → 补发 finish；实况 IDLE 且有
 * activeTask → 补发 idle（幽灵收尾，走既有失败重排通道）。无任务时首报文不发事件。
 */
function resolveJobEvent(prevState, to, hasActiveTask) {
  if (!prevState) {
    if (to === 'FINISH' && hasActiveTask) return 'finish';
    if (to === 'IDLE' && hasActiveTask) return 'idle';
    return null;
  }
  if (prevState === to) return null;
  if (to === 'PRINTING' && !['RESUME'].includes(prevState)) return 'start';
  // 注意 FINISH → finish 分支在前，idle 分支不再判 FINISH（否则永不可达）
  if (to === 'FINISH') return 'finish';
  if (to === 'FAILED') return 'failed';
  if (to === 'IDLE' && prevState === 'PRINTING') return 'idle';
  return null;
}

class PrinterManager {
  constructor() {
    this.clients = {};
    this.printerStates = {};
    this.listeners = [];
    // 状态签名缓存（printerId → 上次写表签名）：60s 轮询此前无条件 upsert，
    // 状态没变化也整行重写（lastUpdate 带时间戳每行必变），白烧写配额并制造
    // 表格变更噪音——签名不变则本轮跳过写表
    this.statusSignatures = new Map();
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
        remainingMinutes: 0,
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

    // 2026-10-05 路线 A：打印机状态写多维表格的同步已停用（表格不再是数据面）；
    // syncPrinterStatusToBitable 方法保留备查，不再由 init/定时器调用
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
   * gcodeState 关键变迁发 jobEvent（分发引擎靠它触发匹配与收尾）
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
      remainingMinutes: status.remainingMinutes,
      nozzleTemp: status.nozzleTemp,
      bedTemp: status.bedTemp,
      chamberTemp: status.chamberTemp,
      ams: client.getAmsTrays(),
    });

    // 关键变迁 → jobEvent（dispatcher 用它触发匹配、播报用它与完成/失败）；
    // activeTask 取自引擎写入的 printerState（上方 prev 快照，先于 updateState）——
    // 首报文补收尾事件依赖它判「有无任务在册」
    const event = resolveJobEvent(prevState, status.gcodeState, Boolean(prev.activeTask));
    if (event) {
      console.log(`[打印机管理] ${prev.name} 任务变迁: ${prevState || '(首报文)'} → ${status.gcodeState} (${event})`);
      this.notifyListeners('jobEvent', { printer: this.printerStates[printerId], event, prevState, gcodeState: status.gcodeState });
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
    this.printerStates[printerId] = next;
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
   * API 输出形态：附加实时失联标注（stateStale）——status 停留在最后一次报文的
   * 「空闲」而报文早已过期（幽灵空闲）时，页面能看到「失联」警示而非误信空闲
   */
  getApiStates() {
    return Object.values(this.printerStates).map((p) => ({
      ...p,
      stateStale: this.clients[p.id] ? this.clients[p.id].isStateStale() : true,
    }));
  }

  /**
   * 可承接自动分发的打印机：Bambu 系、空闲/已完成、且 state 报文未失联。
   * 幽灵空闲防护：bambu-link 从不 emit 'disconnect'，打印机断电后 connected 仍为
   * true、状态停在最后一次的「空闲」——超时无报文（client.isStateStale，默认 3 分钟）
   * 的机器视为不可选，避免把任务分发给失联真机
   */
  getAvailablePrinters() {
    return Object.values(this.printerStates).filter((p) => {
      if (!p.autoDispatch || !['空闲', '已完成'].includes(p.status)) return false;
      const client = this.clients[p.id];
      return Boolean(client) && !client.isStateStale();
    });
  }

  /**
   * 真机联调核对面（v46）：返回打印机 raw state 报文全量 + 连接/新鲜度元信息。
   * AMS 报文形状、gcodeState 序列等「待真机核对」假设出错时，用它一眼区分
   * 「报文假设错了」还是「解析逻辑错了」（admin/token 经 GET /api/printers/:id/debug 消费）
   */
  getPrinterDebug(printerId) {
    const state = this.printerStates[printerId];
    if (!state) return null;
    const client = this.clients[printerId];
    return {
      id: state.id,
      name: state.name,
      model: state.model,
      host: state.host,
      autoDispatch: state.autoDispatch,
      connected: Boolean(client && client.connected),
      lastStateAt: client ? client.lastStateAt : null,
      stateStale: client ? client.isStateStale() : true,
      status: state.status,
      gcodeState: state.gcodeState,
      activeTask: state.activeTask ? { recordId: state.activeTask.recordId, applicationNo: state.activeTask.applicationNo } : null,
      rawState: client ? client.getState() : null,
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

        // 状态签名：关键状态字段拼接比较（不含 lastUpdate——它恒变，进了签名
        // 等于永远不等）；签名未变且行已存在时跳过写表，签名随实际写表刷新
        const signature = [
          printer.status,
          printer.currentJob || '',
          printer.progress,
          fields.temperature,
        ].join('|');

        if (existingRecord) {
          if (this.statusSignatures.get(printer.id) === signature) {
            continue; // 状态无变化，不重写（保持表内 lastUpdate = 真实变化时刻）
          }
          await bitableApi.updateRecord(
            config.bitable.printerTableId,
            existingRecord.record_id,
            fields
          );
        } else {
          await bitableApi.createRecord(config.bitable.printerTableId, fields);
        }
        this.statusSignatures.set(printer.id, signature);
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

// 2026-10-05 路线 A：60s 打印机状态 upsert 多维表格的定时器已停用（白耗写配额，
// 且表格不再是数据面）；状态查询走 GET /api/printers（内存态）
// setInterval(() => {
//   printerManager.syncPrinterStatusToBitable();
// }, 60000);

module.exports = printerManager;
module.exports.resolveJobEvent = resolveJobEvent;
