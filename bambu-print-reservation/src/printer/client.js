const { BambuLink } = require('bambu-link');
const { Client: SSHClient } = require('ssh2');
const ftp = require('ftp');
const { Client: FTPSClient } = require('basic-ftp');
const net = require('net');
const RtpsSession = require('./rtsps');

// gcodeState（打印机上报的 gcode_state）→ 统一中文状态
const GCODE_STATE_MAP = {
  PRINTING: '打印中',
  RESUME: '打印中',
  PAUSE: '暂停',
  FINISH: '已完成',
  FAILED: '故障',
  PREPARE: '准备中',
  SLICING: '切片中',
  IDLE: '空闲',
};

// 文件传输超时：挂起的上传会把分发引擎的串行匹配段永久卡死
const SFTP_TIMEOUT_MS = 120 * 1000;
const FTP_TIMEOUT_MS = 60 * 1000;
const FTPS_TIMEOUT_MS = 90 * 1000;

// 失联判定窗口（PRINTER_STATE_STALE_MS 可配，默认 3 分钟）：超过该时长未收到任何
// state 报文即视为失联。幽灵空闲防护——bambu-link 从不 emit 'disconnect'，
// connected 置 true 后永不回落，打印机断电/断网后仍按最后一条 state 显示「空闲」，
// 分发引擎会继续选中它空跑分发；必须以报文新鲜度兜底，不依赖库的断开事件
const STATE_STALE_MS = Number(process.env.PRINTER_STATE_STALE_MS || 3 * 60 * 1000);

class PrinterClient {
  constructor(printerConfig) {
    this.config = printerConfig;
    this.client = null;
    this.state = null;
    this.connected = false;
    this.connecting = false;
    // 最近一次收到 state 报文的时间戳（失联判定依据，见 isStateStale）
    this.lastStateAt = 0;
    this.listeners = [];
    this.ftpClient = null;
    this.ftpsClient = null;
    this.sshClient = null;
    // project_file 命令的序号从高段位起，避免与 bambu-link 内部序号撞车
    this.projectSeq = 10000 + Math.floor(Math.random() * 1000);
  }

  async connect() {
    if (this.connecting) return;
    if (this.connected) return;

    this.connecting = true;

    try {
      this.client = new BambuLink(
        this.config.accessCode,
        this.config.host,
        0,
        8883,
        this.config.serial
      );

      this.client.on('connect', () => {
        this.connected = true;
        this.connecting = false;
        console.log(`[打印机] ${this.config.name} 已连接`);
        this.notifyListeners('connect');
      });

      this.client.on('disconnect', () => {
        this.connected = false;
        console.log(`[打印机] ${this.config.name} 已断开连接`);
        this.notifyListeners('disconnect');
      });

      this.client.on('state', (state) => {
        this.lastStateAt = Date.now();
        this.state = state;
        this.notifyListeners('state', state);
      });

      this.client.on('stateUpdate', (patch, previousState) => {
        // 增量报文同样证明连接存活，一并刷新新鲜度
        this.lastStateAt = Date.now();
        this.notifyListeners('stateUpdate', patch, previousState);
      });

      this.client.on('error', (err) => {
        console.error(`[打印机] ${this.config.name} 错误:`, err.message);
        this.notifyListeners('error', err);
      });

      await this.client.connect();
    } catch (err) {
      this.connecting = false;
      console.error(`[打印机] ${this.config.name} 连接失败:`, err.message);
      throw err;
    }
  }

  async disconnect() {
    if (this.client) {
      try {
        await this.client.disconnect();
      } catch (err) {
        console.error(`[打印机] ${this.config.name} 断开连接失败:`, err.message);
      }
    }
    this.connected = false;
    this.client = null;
    await this.disconnectFileSession();
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
          console.error(`[打印机] 监听器错误:`, err.message);
        }
      }
    });
  }

  getState() {
    if (!this.client) return null;
    return this.client.getFullState();
  }

  getPrinterInfo() {
    return this.config;
  }

  /**
   * 是否失联：超过 STATE_STALE_MS 未收到任何 state 报文（含从未收到过）。
   * bambu-link 无可靠的 disconnect 事件，选机与状态展示以此兜底判定
   */
  isStateStale() {
    return this.lastStateAt <= 0 || Date.now() - this.lastStateAt > STATE_STALE_MS;
  }

  /**
   * 归一化打印状态：以 gcode_state 为准（job.stage 是数值型 mc_print_stage，判不准）
   */
  getPrintStatus() {
    const state = this.getState();
    if (!state) return null;

    const job = state.job || {};
    const temps = state.temps || {};
    const gcodeState = String(state.gcodeState || 'IDLE').toUpperCase();
    // spd_lvl 不在 bambu-link 的归一化字段里，从原始报文取（"1"~"4"）
    const spdRaw = state.raw && state.raw.print ? state.raw.print.spd_lvl : null;
    const speedLevel = spdRaw != null ? Number(spdRaw) || null : null;

    return {
      gcodeState,
      status: GCODE_STATE_MAP[gcodeState] || '空闲',
      progress: job.percent || 0,
      // mc_remaining_time 单位是分钟（bambu-link 误命名为 remainingSeconds，勿再除以 60）
      remainingMinutes: job.remainingSeconds || 0,
      currentFile: job.file || '',
      nozzleTemp: temps.nozzle || null,
      bedTemp: temps.bed || null,
      chamberTemp: temps.chamber || null,
      // 目标温度/风扇/速度档/灯：全量报文才带，增量报文里是 undefined → 保持 null
      nozzleTargetTemp: temps.nozzleTarget ?? null,
      bedTargetTemp: temps.bedTarget ?? null,
      fans: state.fans ? { part: state.fans.part ?? null, aux: state.fans.aux ?? null, chamber: state.fans.chamber ?? null } : null,
      speedLevel,
      lights: state.lights ? { chamber: state.lights.chamber || null, work: state.lights.work || null } : null,
      // 失联标注：true 表示该状态来自过期报文（幽灵空闲防护，选机侧会过滤）
      stateStale: this.isStateStale(),
    };
  }

  /**
   * AMS + 外部料架的耗材清单
   * @returns {Array<{slot: string, type: string, colorHex: string, active: boolean, external: boolean}>}
   */
  getAmsTrays() {
    const state = this.getState();
    if (!state) return [];

    const trays = [];
    const ams = state.ams;
    const trayNow = ams ? ams.trayNow : null;

    if (ams && ams.trays) {
      for (const tray of Object.values(ams.trays)) {
        if (!tray) continue;
        // 254=外部料架（vt_tray，bambu-link 解析里 external: tid === 254），
        // 不在 4 位位图内，由下方 vtTray 分支单独处理
        if (Number(tray.id) === 254) continue;
        // existBits（ams_exist_bits）标记各槽是否实际插着料盒，'1111' 从左到右。
        // 槽位 0 基（0..3）：bambu-link 直接以打印机上报的 tray.id 作键（0..3），
        // 位图第 N 位即 tray.id=N，故直接 charAt(tray.id)，勿再减 1
        const installed = ams.existBits
          ? String(ams.existBits).charAt(tray.id) !== '0'
          : true;
        if (!installed) continue;
        trays.push({
          slot: `AMS ${tray.id}`,
          type: tray.type || '',
          colorHex: tray.colorHex ? String(tray.colorHex).slice(0, 6) : '',
          active: trayNow === tray.id,
          external: false,
          remain: tray.remain ?? null, // 剩余料量（百分比，AMS UI 显示）
        });
      }
    }

    const vt = state.vtTray;
    if (vt && vt.type) {
      trays.push({
        slot: '外部料架',
        type: vt.type || '',
        colorHex: vt.colorHex ? String(vt.colorHex).slice(0, 6) : '',
        active: trayNow === 254 || trayNow === 0,
        external: true,
      });
    }

    return trays;
  }

  // ============ 打印控制 ============

  async startPrint(filePath) {
    if (!this.client || !this.connected) {
      throw new Error('打印机未连接');
    }
    return this.client.printGcode_file(filePath);
  }

  /**
   * 直接下发 3mf 打印任务（X1/H2D 支持，切片参数随文件）
   * 标准 LAN 协议 project_file 命令：url 指向上传到 /sdcard/ 的 3mf
   */
  async startProjectFile(fileName, subtaskName, useAms = true) {
    if (!this.client || !this.connected) {
      throw new Error('打印机未连接');
    }
    const sequenceId = ++this.projectSeq;
    const payload = {
      print: {
        sequence_id: sequenceId,
        command: 'project_file',
        param: '',
        url: `ftp:///sdcard/${fileName}`,
        subtask_name: subtaskName || fileName,
        use_ams: useAms,
        md5: '',
      },
    };
    return this.client
      .getMqttClient()
      .sendCommand(JSON.stringify(payload), sequenceId, true);
  }

  async pausePrint() {
    if (!this.client || !this.connected) {
      throw new Error('打印机未连接');
    }
    return this.client.pausePrint();
  }

  async resumePrint() {
    if (!this.client || !this.connected) {
      throw new Error('打印机未连接');
    }
    return this.client.resumePrint();
  }

  async stopPrint() {
    if (!this.client || !this.connected) {
      throw new Error('打印机未连接');
    }
    return this.client.stopPrint();
  }

  /**
   * 灯控制（观察台指令条）：标准 LAN 协议 ledctrl 命令，直接走底层 MQTT sendCommand
   * （序号沿用 projectSeq 高段位防撞车）。lamp：chamber_light（腔灯）/ work_light（工作灯）
   */
  async lightControl(on, lamp = 'chamber_light') {
    if (!this.client || !this.connected) {
      throw new Error('打印机未连接');
    }
    const node = lamp === 'work_light' ? 'work_light' : 'chamber_light';
    const sequenceId = ++this.projectSeq;
    const payload = {
      system: {
        sequence_id: sequenceId, // 必须数字——回包匹配器按数值序号对帧（字符串会超时）
        command: 'ledctrl',
        led_node: node,
        led_mode: on ? 'on' : 'off',
        led_time: 600,
      },
    };
    return this.client.getMqttClient().sendCommand(JSON.stringify(payload), sequenceId, true);
  }

  // ============ 全量远控（2026-10-15 观察台 v55）============
  // 参数校验前置（未连接也先报参数错，前端 400/409 语义区分）；动作本体走
  // bambu-link 现成封装。危险面（轴动/回原点/校准/退料）的状态门控在 manager/端点层。

  /** 打印速度档：1 静默 / 2 标准 / 3 竞速 / 4 疯狂 */
  async setSpeed(level) {
    const n = Number(level);
    if (!Number.isInteger(n) || n < 1 || n > 4) {
      throw new Error('速度档必须是 1-4 的整数');
    }
    if (!this.client || !this.connected) throw new Error('打印机未连接');
    return this.client.printSpeedSet(n);
  }

  /** 风扇速度：kind = PART(模型扇 P1) / AUX(辅助扇 P2) / CHAMBER(腔室扇 P3)，0-255 */
  async setFanSpeed(kind, speed) {
    const K = String(kind || '').toUpperCase();
    if (!['PART', 'AUX', 'CHAMBER'].includes(K)) {
      throw new Error('风扇类型必须是 part/aux/chamber');
    }
    const s = Number(speed);
    if (!Number.isInteger(s) || s < 0 || s > 255) {
      throw new Error('风扇速度必须是 0-255 的整数');
    }
    if (!this.client || !this.connected) throw new Error('打印机未连接');
    return this.client.setFanSpeed(s, K);
  }

  /** gcode 直控：单条（可多行）原始 G-code 下发 */
  async sendGcode(line) {
    const g = String(line || '').trim();
    if (!g) throw new Error('gcode 不能为空');
    if (g.length > 800) throw new Error('gcode 过长（>800 字符）');
    if (!this.client || !this.connected) throw new Error('打印机未连接');
    return this.client.printGcode(g.endsWith('\n') ? g : g + '\n');
  }

  async calibration() {
    if (!this.client || !this.connected) throw new Error('打印机未连接');
    return this.client.calibration();
  }

  async home() {
    if (!this.client || !this.connected) throw new Error('打印机未连接');
    return this.client.home();
  }

  /** 轴相对移动：axis X/Y/Z，distance mm（带符号）；Z 轴限低速防撞 */
  async moveAxis(axis, distance) {
    const A = String(axis || '').toUpperCase();
    if (!['X', 'Y', 'Z'].includes(A)) {
      throw new Error('轴必须是 x/y/z');
    }
    const d = Number(distance);
    if (!Number.isFinite(d) || d === 0) {
      throw new Error('移动距离必须是非 0 数字');
    }
    if (Math.abs(d) > 100) {
      throw new Error('单次移动距离不能超过 100mm');
    }
    if (!this.client || !this.connected) throw new Error('打印机未连接');
    return this.client.move(A, d, A === 'Z' ? 1200 : 9000);
  }

  async unloadFilament() {
    if (!this.client || !this.connected) throw new Error('打印机未连接');
    return this.client.unloadFilament();
  }

  // ============ 设备化扩展（2026-10-15 观察台 v56：温度/AMS/文件管理/校准细分）============

  /** 喷嘴目标温度（M104，不等待升温）。H2D 高温喷嘴上限 350，保守取同值 */
  async setNozzleTemp(deg) {
    const d = Number(deg);
    if (!Number.isInteger(d) || d < 0 || d > 350) {
      throw new Error('喷嘴温度必须是 0-350 的整数');
    }
    if (!this.client || !this.connected) throw new Error('打印机未连接');
    return this.sendGcode(`M104 S${d}`);
  }

  /** 热床目标温度（M140，不等待升温） */
  async setBedTemp(deg) {
    const d = Number(deg);
    if (!Number.isInteger(d) || d < 0 || d > 120) {
      throw new Error('热床温度必须是 0-120 的整数');
    }
    if (!this.client || !this.connected) throw new Error('打印机未连接');
    return this.sendGcode(`M140 S${d}`);
  }

  /**
   * AMS 切槽进料（空闲态换料）：ams_change_filament，目标槽先退旧料再进新料。
   * 帧格式为社区口径（OpenBambuAPI），v56 真机 H2D 校准
   */
  async amsChangeFilament(amsId, trayId) {
    const a = Number(amsId);
    const t = Number(trayId);
    if (!Number.isInteger(a) || a < 0 || a > 3) {
      throw new Error('AMS 单元号必须是 0-3');
    }
    if (!Number.isInteger(t) || t < 0 || (t > 3 && t !== 254)) {
      throw new Error('AMS 槽位必须是 0-3（254=外部料架）');
    }
    if (!this.client || !this.connected) throw new Error('打印机未连接');
    const sequenceId = ++this.projectSeq;
    const payload = {
      print: {
        sequence_id: sequenceId,
        command: 'ams_change_filament',
        ams_id: a,
        tray_id: t,
      },
    };
    return this.client.getMqttClient().sendCommand(JSON.stringify(payload), sequenceId, true);
  }

  /**
   * 校准：full=全量（bambu-link 封装）；level=自动调平、vib=振动补偿（社区 option 位
   * 口径：1=调平 2=振动补偿，v56 真机校准，异常回退全量）
   */
  async calibration(option) {
    if (!this.client || !this.connected) throw new Error('打印机未连接');
    if (option === undefined || option === null || option === 'full') {
      return this.client.calibration();
    }
    const OPT = { level: 1, vib: 2 };
    const v = OPT[option];
    if (!v) throw new Error('校准类型必须是 full/level/vib');
    const sequenceId = ++this.projectSeq;
    const payload = {
      print: { sequence_id: sequenceId, command: 'calibration', option: v },
    };
    return this.client.getMqttClient().sendCommand(JSON.stringify(payload), sequenceId, true);
  }

  /** 设备全景（raw 补充字段）：喷嘴规格/WiFi 信号/固件版本/AMS 湿度 */
  getDeviceInfo() {
    const state = this.getState();
    if (!state) return null;
    const amsRaw = state.raw && state.raw.print ? state.raw.print.ams : null;
    return {
      nozzleDiameter: state.nozzleDiameter ?? null,
      nozzleType: state.nozzleType || null,
      wifiDbm: state.wifiSignalDbm ?? null,
      fwVersion: state.upgrade ? (state.upgrade.currentVersion || null) : null,
      amsHumidity: amsRaw && amsRaw.humidity != null ? (Number(amsRaw.humidity) || null) : null,
    };
  }

  /** FTPS 会话（990 implicit TLS，懒建 + 复用，出错置空强制重连） */
  async withFtps(fn) {
    let client = this.ftpsClient || (await this.connectFTPS());
    try {
      return await fn(client);
    } catch (err) {
      // 出错视为连接已坏：关闭置空强制下轮重连
      this.disconnectFTPS();
      throw err;
    }
  }

  /** /sdcard 文件清单（仅切片产物后缀，按修改时间倒序）——FTPS 990 通道 */
  async listSdcardFiles() {
    return this.withFtps(async (client) => {
      const list = await client.list('/sdcard');
      return list
        .filter((e) => !e.isDirectory)
        .filter((e) => /\.(3mf|gcode|gx|g)$/i.test(e.name))
        .map((e) => ({ name: e.name, size: e.size, mtime: e.modifiedAt ? new Date(e.modifiedAt).getTime() : 0 }))
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, 200);
    });
  }

  /** 删除 /sdcard 文件（文件名白名单校验，禁路径穿越）——FTPS 990 通道 */
  async deleteSdcardFile(name) {
    const n = String(name || '');
    if (!n || /[\\/]/.test(n) || n.includes('..') || !/\.(3mf|gcode|gx|g)$/i.test(n)) {
      throw new Error('非法文件名');
    }
    return this.withFtps(async (client) => {
      await client.remove(`/sdcard/${n}`);
      return { deleted: n };
    });
  }

  /**
   * 本地摄像头流，按机型分通道（观察台 WS 中继消费——每个观看客户端独立一路，
   * 断开即销毁，不在 client 内长驻）：
   *   P1/A1 系 = TCP 6000 裸 H.264 Annex-B（LAN/云模式端口均开，无握手）
   *   X1/H2D 系 = RTSPS :322（RTSP over TLS，digest 认证，RTP interleaved，
   *               rtsps.js 还原成同款 Annex-B 字节流）
   */
  openCameraStream() {
    const model = String(this.config.model || '').toUpperCase();
    if (model.includes('X1') || model.includes('H2D')) {
      return new RtpsSession({ host: this.config.host, password: this.config.accessCode }).connect();
    }
    return net.connect({ host: this.config.host, port: 6000, timeout: 8000 });
  }

  // ============ 文件传输（SFTP 优先，FTPS/FTP 兜底） ============

  /**
   * 上传 Buffer 到打印机 /sdcard/。
   * 2026-10-15 真机 H2D 实测：22/21 全关（ECONNREFUSED），FTPS 990 为唯一通道——
   * 与 P1 系 2026-10-07 实测一致，「X1/H2D 走 SFTP:22」系老假设已废，全系统一
   * FTPS 990（implicit TLS）优先、FTP 21 回退兼容老固件
   */
  async uploadBuffer(buffer, remotePath) {
    let ftpsErr = null;
    try {
      return await this.ftpsPut(buffer, remotePath);
    } catch (err) {
      ftpsErr = err;
    }
    try {
      return await this.ftpPut(buffer, remotePath);
    } catch (err) {
      throw new Error(
        `FTPS(990) 上传失败（${ftpsErr ? ftpsErr.message : '未知'}），FTP(21) 回退也失败（${err.message}）`
      );
    }
  }

  async connectFTPS() {
    const client = new FTPSClient(15000);
    try {
      await client.access({
        host: this.config.host,
        port: 990,
        user: 'bblp',
        password: this.config.accessCode,
        secure: 'implicit',
        secureOptions: { rejectUnauthorized: false }, // 打印机自签证书（BBL CA）
      });
    } catch (err) {
      try { client.close(); } catch (e) { /* ignore */ }
      throw err;
    }
    this.ftpsClient = client;
    return client;
  }

  disconnectFTPS() {
    if (this.ftpsClient) {
      try { this.ftpsClient.close(); } catch (e) { /* ignore */ }
      this.ftpsClient = null;
    }
  }

  async ftpsPut(buffer, remotePath) {
    let client = this.ftpsClient;
    if (!client) {
      client = await this.connectFTPS();
    }
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`FTPS 上传超时（${FTPS_TIMEOUT_MS / 1000}s）: ${remotePath}`));
        }, FTPS_TIMEOUT_MS);
        client.uploadFrom(Buffer.from(buffer), remotePath).then(
          () => { clearTimeout(timer); resolve(); },
          (err) => { clearTimeout(timer); reject(err); }
        );
      });
    } catch (err) {
      // 出错视为连接已坏：关闭置空强制下轮重连
      this.disconnectFTPS();
      throw err;
    }
  }

  sftpPut(buffer, remotePath) {
    return new Promise((resolve, reject) => {
      const tryUpload = (sftp) => {
        const stream = sftp.createWriteStream(remotePath);
        const timer = setTimeout(() => {
          // 超时视为会话已坏：断开并置空，下次上传重建连接
          stream.destroy();
          if (this.sshClient) {
            try { this.sshClient.end(); } catch (e) { /* ignore */ }
            this.sshClient = null;
          }
          reject(new Error(`SFTP 上传超时（${SFTP_TIMEOUT_MS / 1000}s）: ${remotePath}`));
        }, SFTP_TIMEOUT_MS);
        stream.on('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
        stream.on('close', () => {
          clearTimeout(timer);
          resolve();
        });
        stream.end(Buffer.from(buffer));
      };

      if (this.sshClient && this.sshClient.sftpReady) {
        return tryUpload(this.sshClient.sftp);
      }

      const conn = new SSHClient();
      conn.on('ready', () => {
        conn.sftp((err, sftp) => {
          if (err) {
            conn.end();
            return reject(err);
          }
          // 顶掉旧会话时显式关闭，避免连接泄漏
          if (this.sshClient && this.sshClient !== conn) {
            try { this.sshClient.end(); } catch (e) { /* ignore */ }
          }
          this.sshClient = conn;
          this.sshClient.sftp = sftp;
          this.sshClient.sftpReady = true;
          tryUpload(sftp);
        });
      });
      conn.on('error', (err) => reject(err));
      conn.on('close', () => {
        // 只处理当前会话的关闭：旧连接的 close 不能误清新会话的 sftpReady
        if (this.sshClient === conn) {
          this.sshClient = null;
        }
      });
      conn.connect({
        host: this.config.host,
        port: 22,
        username: 'bblp',
        password: this.config.accessCode,
        readyTimeout: 15000,
      });
    });
  }

  async disconnectFileSession() {
    if (this.sshClient) {
      this.sshClient.end();
      this.sshClient = null;
    }
    this.disconnectFTPS();
    if (this.ftpClient) {
      await this.disconnectFTP();
    }
  }

  connectFTP() {
    return new Promise((resolve, reject) => {
      const client = new ftp();
      this.ftpClient = client;

      client.on('ready', () => {
        resolve();
      });

      client.on('error', (err) => {
        // 连接失败/中途掉线后残留死客户端，会让后续操作永远挂在坏连接上：置空强制下轮重连
        if (this.ftpClient === client) this.ftpClient = null;
        reject(err);
      });

      client.connect({
        host: this.config.host,
        user: 'bblp',
        password: this.config.accessCode,
        port: 21,
        connTimeout: 30000,
        pasvTimeout: 30000,
      });
    });
  }

  async disconnectFTP() {
    if (this.ftpClient) {
      return new Promise((resolve) => {
        this.ftpClient.end(() => {
          this.ftpClient = null;
          resolve();
        });
      });
    }
  }

  async ftpPut(buffer, remotePath) {
    if (!this.ftpClient) {
      await this.connectFTP();
    }

    const client = this.ftpClient;
    return new Promise((resolve, reject) => {
      const fail = (err) => {
        // 出错视为连接已坏：置空强制下轮重连，并显式销毁 socket 防泄漏
        if (this.ftpClient === client) this.ftpClient = null;
        try { client.destroy(); } catch (e) { /* ignore */ }
        reject(err);
      };
      const timer = setTimeout(() => {
        fail(new Error(`FTP 上传超时（${FTP_TIMEOUT_MS / 1000}s）: ${remotePath}`));
      }, FTP_TIMEOUT_MS);
      client.put(Buffer.from(buffer), remotePath, (err) => {
        clearTimeout(timer);
        if (err) {
          fail(err);
        } else {
          resolve();
        }
      });
    });
  }
}

module.exports = PrinterClient;
module.exports.GCODE_STATE_MAP = GCODE_STATE_MAP;
