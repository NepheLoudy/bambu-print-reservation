const { BambuLink } = require('bambu-link');
const ftp = require('ftp');
const fs = require('fs');
const path = require('path');

class PrinterClient {
  constructor(printerConfig) {
    this.config = printerConfig;
    this.client = null;
    this.state = null;
    this.connected = false;
    this.connecting = false;
    this.listeners = [];
    this.ftpClient = null;
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

  async startPrint(filePath) {
    if (!this.client || !this.connected) {
      throw new Error('打印机未连接');
    }
    return this.client.printGcode_file(filePath);
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

  getPrintStatus() {
    const state = this.getState();
    if (!state) return null;

    const job = state.job || {};
    const temps = state.temps || {};

    return {
      status: job.stage || 'unknown',
      progress: job.progress || 0,
      remainingTime: job.remaining_time || 0,
      currentFile: job.file || '',
      nozzleTemp: temps.nozzle || null,
      bedTemp: temps.bed || null,
      chamberTemp: temps.chamber || null,
    };
  }

  getIsPrinting() {
    const status = this.getPrintStatus();
    if (!status) return false;
    return ['printing', 'paused'].includes(status.status.toLowerCase());
  }

  async connectFTP() {
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

  async uploadFile(localPath, remotePath) {
    if (!this.ftpClient) {
      await this.connectFTP();
    }

    return new Promise((resolve, reject) => {
      this.ftpClient.put(localPath, remotePath, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  async uploadFileFromBuffer(buffer, remotePath) {
    if (!this.ftpClient) {
      await this.connectFTP();
    }

    return new Promise((resolve, reject) => {
      this.ftpClient.put(buffer, remotePath, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
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
