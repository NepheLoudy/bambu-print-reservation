const { BambuLink } = require('bambu-link');
const { Client: SSHClient } = require('ssh2');
const ftp = require('ftp');

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

class PrinterClient {
  constructor(printerConfig) {
    this.config = printerConfig;
    this.client = null;
    this.state = null;
    this.connected = false;
    this.connecting = false;
    this.listeners = [];
    this.ftpClient = null;
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
        this.state = state;
        this.notifyListeners('state', state);
      });

      this.client.on('stateUpdate', (patch, previousState) => {
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
   * 归一化打印状态：以 gcode_state 为准（job.stage 是数值型 mc_print_stage，判不准）
   */
  getPrintStatus() {
    const state = this.getState();
    if (!state) return null;

    const job = state.job || {};
    const temps = state.temps || {};
    const gcodeState = String(state.gcodeState || 'IDLE').toUpperCase();

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
        // existBits 标记各槽是否实际插着料盒（'1111' 从左到右）
        const installed = ams.existBits
          ? String(ams.existBits).charAt(Number(tray.id) - 1) !== '0'
          : true;
        if (!installed) continue;
        trays.push({
          slot: `AMS ${tray.id}`,
          type: tray.type || '',
          colorHex: tray.colorHex ? String(tray.colorHex).slice(0, 6) : '',
          active: trayNow === tray.id,
          external: false,
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

  getIsPrinting() {
    const status = this.getPrintStatus();
    if (!status) return false;
    return ['打印中', '暂停', '准备中', '切片中'].includes(status.status);
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

  async home() {
    if (!this.client || !this.connected) {
      throw new Error('打印机未连接');
    }
    return this.client.home();
  }

  async sendGcode(gcode) {
    if (!this.client || !this.connected) {
      throw new Error('打印机未连接');
    }
    return this.client.printGcode(gcode);
  }

  // ============ 文件传输（SFTP 优先，FTP 兜底） ============

  /**
   * 上传 Buffer 到打印机 /sdcard/。
   * X1C/H2D 只有 SFTP(22)；P1 系可用 FTP(21)。按配置 model 决定传输方式。
   */
  async uploadBuffer(buffer, remotePath) {
    const model = String(this.config.model || '').toUpperCase();
    if (model.includes('X1') || model.includes('H2D')) {
      return this.sftpPut(buffer, remotePath);
    }
    return this.ftpPut(buffer, remotePath);
  }

  sftpPut(buffer, remotePath) {
    return new Promise((resolve, reject) => {
      const tryUpload = (sftp) => {
        const stream = sftp.createWriteStream(remotePath);
        stream.on('error', (err) => reject(err));
        stream.on('close', () => resolve());
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
          this.sshClient = conn;
          this.sshClient.sftp = sftp;
          this.sshClient.sftpReady = true;
          tryUpload(sftp);
        });
      });
      conn.on('error', (err) => reject(err));
      conn.on('close', () => {
        if (this.sshClient) this.sshClient.sftpReady = false;
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
    if (this.ftpClient) {
      await this.disconnectFTP();
    }
  }

  connectFTP() {
    return new Promise((resolve, reject) => {
      this.ftpClient = new ftp();

      this.ftpClient.on('ready', () => {
        resolve();
      });

      this.ftpClient.on('error', (err) => {
        reject(err);
      });

      this.ftpClient.connect({
        host: this.config.host,
        user: 'bblp',
        password: this.config.accessCode,
        port: 21,
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

    return new Promise((resolve, reject) => {
      this.ftpClient.put(Buffer.from(buffer), remotePath, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  async uploadFile(localPath, remotePath) {
    const fs = require('fs');
    const buffer = fs.readFileSync(localPath);
    return this.uploadBuffer(buffer, remotePath);
  }

  async listFiles(remoteDir = '/') {
    if (!this.ftpClient) {
      await this.connectFTP();
    }

    return new Promise((resolve, reject) => {
      this.ftpClient.list(remoteDir, (err, list) => {
        if (err) {
          reject(err);
        } else {
          resolve(list || []);
        }
      });
    });
  }

  async deleteFile(remotePath) {
    if (!this.ftpClient) {
      await this.connectFTP();
    }

    return new Promise((resolve, reject) => {
      this.ftpClient.delete(remotePath, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }
}

module.exports = PrinterClient;
module.exports.GCODE_STATE_MAP = GCODE_STATE_MAP;
