const config = require('../config');
const PrinterClient = require('./client');
const FlashforgeClient = require('./flashforge');
const bitableApi = require('../feishu/bitable');

/**
 * 机型 → 品牌适配层分派（2026-10-14 纯内网批）：拓竹走 MQTT(bambu-link)，闪铸走
 * HTTP REST 轮询（flashforge.js）。未知型号默认按拓竹处理（保持老 .env 兼容）。
 */
function brandOf(model) {
  const m = String(model || '').toUpperCase();
  if (m.includes('AD5') || m.includes('AD5X') || m.includes('5M') || m.includes('CREATOR')) return 'flashforge';
  return 'bambu';
}

// 判断打印机是否支持自动分发：两条链路就绪后拓竹与闪铸均可（gcode/3mf 文件类型
// 由 dispatcher 按品牌校验）
function isAutoDispatchable(printer) {
  return brandOf(printer.model) !== 'unknown';
}

/**
 * 摄像头通道类型（观察台画面区按此选渲染器，2026-10-14）：
 *   p1stream = 拓竹 P1/A1 系 TCP6000 H.264（服务端 WS 中继 + 前端 WebCodecs 解码）
 *   mjpeg    = 闪铸 8080 MJPEG（服务端 HTTP 代理，<img> 直显；无摄像头机型代理 502）
 *   rtsp     = 拓竹 X1/H2D 系 RTSP:554（暂不代理，前端标注「画面通道待接」）
 *   null     = 未知机型
 */
function cameraKind(printer) {
  const m = String(printer.model || '').toUpperCase();
  if (brandOf(m) === 'flashforge') return 'mjpeg';
  if (m.includes('P1') || m.includes('A1')) return 'p1stream';
  if (m.includes('X1') || m.includes('H2D')) return 'rtsp';
  return null;
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
  // RUNNING = H2 新固件的打印执行态（2026-10-16 实测），与 PRINTING 同义并入 start 判定
  if ((to === 'PRINTING' || to === 'RUNNING') && !['RESUME'].includes(prevState)) return 'start';
  // 注意 FINISH → finish 分支在前，idle 分支不再判 FINISH（否则永不可达）
  if (to === 'FINISH') return 'finish';
  if (to === 'FAILED') return 'failed';
  // 任何非空闲态 → 空闲 = 「机器恢复可用」信号（2026-10-16 曼波真单卡滞修复）：
  // 此前仅认 PRINTING→IDLE，打印机 FAILED（失败/取消后驻留故障态）→ 屏幕消除 → IDLE
  // 的恢复路径不触发匹配，等待中的队列静默卡死。匹配侧有队列/空闲/槽位多重门控，多余触发幂等无害。
  if (to === 'IDLE') return 'idle';
  return null;
}

/**
 * 「动机械」类远控指令（回原点/轴移动/校准/退料）的状态门控（纯函数，单测覆盖）：
 * 仅空闲/已完成/故障态可点——打印中、暂停、准备中一律拒绝，防手滑毁件毁喷头。
 * 速度/风扇/灯/gcode 打印中可用（调参正是打印中的需求），不走此门。
 */
function canJogMachine(gcodeState) {
  return ['IDLE', 'FINISH', 'FAILED'].includes(String(gcodeState || '').toUpperCase());
}

/**
 * 残留故障可派单判定（2026-10-16 曼波令·方案B，纯函数单测覆盖）：打印被取消/失败后
 * H2 固件把 gcode_state=FAILED 挂住且**对指令免疫**（clean_print_error/stop 实测全受理
 * 但不生效，屏幕亦无提示），机器实际静止可用。放行「静止残留」参与分发——新任务开打时
 * 固件用新状态顶掉残留（Bambu Studio 同口径）；真故障（有在打痕迹：activeTask/进度>0）
 * 不放行。失联门由调用方（getAvailablePrinters 的报文新鲜度）把守。
 */
function canDispatchResidueFailed(p) {
  return Boolean(p)
    && p.status === '故障'
    && String(p.gcodeState || '').toUpperCase() === 'FAILED'
    && !p.activeTask
    && !(Number(p.progress) > 0);
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
        brand: brandOf(printer.model),
        autoDispatch: isAutoDispatchable(printer),
        status: '未连接',
        gcodeState: '',
        currentJob: '',
        progress: 0,
        remainingMinutes: 0,
        nozzleTemp: null,
        bedTemp: null,
        chamberTemp: null,
        nozzleTargetTemp: null,
        bedTargetTemp: null,
        fans: null,
        speedLevel: null,
        lights: null,
        hms: [],
        nozzles: null,
        amsUnits: [],
        layerNum: 0,
        totalLayers: 0,
        subtaskName: '',
        printType: '',
        spdMag: null,
        queueTotal: 0,
        sdcard: false,
        printError: 0,
        failReason: 0,
        deviceInfo: null,
        ams: [],
        // 当前正在执行的任务（dispatcher 写入，用于播报与状态展示）
        activeTask: null,
        lastUpdate: new Date(),
      };

      if (!this.printerStates[printer.id].autoDispatch) {
        console.log(`[打印机管理] ${printer.name}(${printer.model}) 为未知品牌机型，仅登记不参与自动分发`);
        continue;
      }

      // 品牌分派：拓竹=MQTT 长连（bambu-link），闪铸=HTTP 轮询（flashforge）
      const client = this.printerStates[printer.id].brand === 'flashforge'
        ? new FlashforgeClient(printer)
        : new PrinterClient(printer);
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
      nozzleTargetTemp: status.nozzleTargetTemp,
      bedTargetTemp: status.bedTargetTemp,
      fans: status.fans,
      speedLevel: status.speedLevel,
      lights: status.lights,
      hms: status.hms || [],
      nozzles: status.nozzles || null,
      amsUnits: typeof client.getAmsUnits === 'function' ? client.getAmsUnits() : [],
      layerNum: status.layerNum || 0,
      totalLayers: status.totalLayers || 0,
      subtaskName: status.subtaskName || '',
      printType: status.printType || '',
      spdMag: status.spdMag ?? null,
      queueTotal: status.queueTotal || 0,
      sdcard: Boolean(status.sdcard),
      printError: status.printError || 0,
      failReason: status.failReason || 0,
      deviceInfo: typeof client.getDeviceInfo === 'function' ? client.getDeviceInfo() : null,
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
    return Object.values(this.printerStates).map((p) => {
      const client = this.clients[p.id];
      return {
        ...p,
        stateStale: client ? client.isStateStale() : true,
        // 摄像头能力（观察台画面区消费）：拓竹 P1/A1 系=TCP6000 H.264（经 WS 中继）；
        // X1/H2D 系=RTSP 暂不代理；闪铸=HTTP MJPEG 代理。机型不带摄像头则 false
        camera: cameraKind(p),
        cameraUrl: client && typeof client.getCameraUrl === 'function' ? client.getCameraUrl() : null,
      };
    });
  }

  /** 单机客户端取用（摄像头流开关等品牌特有能力；无则 null） */
  getClient(printerId) {
    return this.clients[printerId] || null;
  }

  /**
   * 可承接自动分发的打印机：Bambu 系、空闲/已完成、且 state 报文未失联。
   * 幽灵空闲防护：bambu-link 从不 emit 'disconnect'，打印机断电后 connected 仍为
   * true、状态停在最后一次的「空闲」——超时无报文（client.isStateStale，默认 3 分钟）
   * 的机器视为不可选，避免把任务分发给失联真机
   */
  getAvailablePrinters() {
    return Object.values(this.printerStates).filter((p) => {
      if (!p.autoDispatch) return false;
      // 2026-10-16 方案B：静止的残留故障（指令免疫的 FAILED 挂态）同空闲放行派单
      if (!['空闲', '已完成'].includes(p.status) && !canDispatchResidueFailed(p)) return false;
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
      brand: state.brand || brandOf(state.model),
      camera: cameraKind(state),
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
    // 品牌分派：拓竹推到 /sdcard/（返回远端路径，随后的 project_file 引用它）；
    // 闪铸传 /data（printNow=false 两步式——上传与开打解耦，失败重试不重传文件）
    if (this.printerStates[printerId].brand === 'flashforge') {
      await client.uploadBuffer(Buffer.from(buffer), fileName, { printNow: false });
      return `/data/${fileName}`;
    }
    const remotePath = `/sdcard/${fileName}`;
    await client.uploadBuffer(Buffer.from(buffer), remotePath);
    return remotePath;
  }

  async startProjectOnPrinter(printerId, fileName, subtaskName, useAms = true, prefTray = null, frameOpts = {}) {
    const client = this.clients[printerId];
    if (!client || !client.connected) {
      throw new Error('打印机未连接');
    }
    if (this.printerStates[printerId].brand === 'flashforge') {
      return client.startFile(fileName);
    }
    await client.startProjectFile(fileName, subtaskName, useAms, prefTray, frameOpts);
  }

  /** 灯控制（观察台指令条；两品牌各走各的协议；lamp 仅拓竹区分腔灯/工作灯） */
  async lightControlOnPrinter(printerId, on, lamp) {
    const client = this.clients[printerId];
    if (!client || !client.connected) {
      throw new Error('打印机未连接');
    }
    return client.lightControl(on, lamp);
  }

  // ============ 全量远控转发（2026-10-15 观察台 v55）============
  // 通用闸门：连接在、品牌支持（新指令仅拓竹链路有实现）；状态门控在端点层用 canJogMachine

  _bambuClient(printerId) {
    const client = this.clients[printerId];
    if (!client || !client.connected) {
      throw new Error('打印机未连接');
    }
    if (this.printerStates[printerId].brand !== 'bambu') {
      throw new Error('该机型品牌不支持此指令（仅拓竹链路）');
    }
    return client;
  }

  setSpeedOnPrinter(printerId, level) {
    return this._bambuClient(printerId).setSpeed(level);
  }

  setFanSpeedOnPrinter(printerId, kind, speed) {
    return this._bambuClient(printerId).setFanSpeed(kind, speed);
  }

  sendGcodeOnPrinter(printerId, line) {
    return this._bambuClient(printerId).sendGcode(line);
  }

  calibrationOnPrinter(printerId, option) {
    return this._bambuClient(printerId).calibration(option);
  }

  // 温度/AMS/文件管理（v56 设备化）：温度与 AMS 切槽仅拓竹链路有实现
  setNozzleTempOnPrinter(printerId, deg) {
    return this._bambuClient(printerId).setNozzleTemp(deg);
  }

  setBedTempOnPrinter(printerId, deg) {
    return this._bambuClient(printerId).setBedTemp(deg);
  }

  amsChangeFilamentOnPrinter(printerId, amsId, trayId) {
    return this._bambuClient(printerId).amsChangeFilament(amsId, trayId);
  }

  /** 清除任务残留（admin）。拓竹=clean_print_error（多形态组帧见 client.cleanPrintError）；
   *  闪铸=stateCtrl_cmd setClearPlatform——打印完成/取消后的屏幕弹窗会挡后续控制，
   *  等价屏幕上点掉弹窗（2026-10-16 协议实证） */
  cleanPrintErrorOnPrinter(printerId) {
    const client = this.clients[printerId];
    if (!client || !client.connected) {
      throw new Error('打印机未连接');
    }
    if (this.printerStates[printerId].brand === 'flashforge') {
      return client.clearScreenDialog();
    }
    return client.cleanPrintError();
  }

  listSdcardFilesOnPrinter(printerId) {
    return this._bambuClient(printerId).listSdcardFiles();
  }

  deleteSdcardFileOnPrinter(printerId, name) {
    return this._bambuClient(printerId).deleteSdcardFile(name);
  }

  homeOnPrinter(printerId) {
    return this._bambuClient(printerId).home();
  }

  moveAxisOnPrinter(printerId, axis, distance) {
    return this._bambuClient(printerId).moveAxis(axis, distance);
  }

  unloadFilamentOnPrinter(printerId) {
    return this._bambuClient(printerId).unloadFilament();
  }

  /** 摄像头上游流（拓竹 P1/A1 系 TCP6000；每个观看客户端独立 socket） */
  openCameraStream(printerId) {
    const client = this.clients[printerId];
    if (!client || typeof client.openCameraStream !== 'function') {
      throw new Error('该机型不支持此画面通道');
    }
    return client.openCameraStream();
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
      // 闪铸 client 无文件长会话（每轮 HTTP 独立），方法缺席即跳过
      if (typeof client.disconnectFileSession === 'function') {
        await client.disconnectFileSession();
      }
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
module.exports.brandOf = brandOf;
module.exports.cameraKind = cameraKind;
module.exports.canJogMachine = canJogMachine;
module.exports.canDispatchResidueFailed = canDispatchResidueFailed;
