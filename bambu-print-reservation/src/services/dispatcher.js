const config = require('../config');
const bitableApi = require('../feishu/bitable');
const { downloadFile, downloadApprovalAttachment } = require('../feishu/client');
const { sendMessage } = require('../feishu/bot');
const printerManager = require('../printer/manager');
const reservationService = require('./reservation');

// ============================================================
// 打印分发引擎：任务队列 + 空闲触发匹配
//
// 触发时机：新任务入队 / 打印机空闲变迁（jobEvent）/ 对账周期
// 匹配规则：指定打印机优先 → AMS 材料类型+颜色近似匹配 → 加急优先 → 负载最少
// 执行链：飞书下载 3mf → SFTP 上传打印机 → MQTT project_file 下发 → 状态写表
// 播报：开始/完成/失败 关键节点卡片；缺料提醒按间隔节流
// ============================================================

/** redmean 颜色距离（人眼加权），约 0~765 */
function colorDistance(hex1, hex2) {
  const p1 = hexToRgb(hex1);
  const p2 = hexToRgb(hex2);
  if (!p1 || !p2) return Infinity;
  const rm = (p1[0] + p2[0]) / 2;
  const dr = p1[0] - p2[0];
  const dg = p1[1] - p2[1];
  const db = p1[2] - p2[2];
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** 材料类型匹配：精确匹配；家族前缀（PLA-CF ⊂ PLA）作为软匹配 */
function materialMatch(required, trayType) {
  const a = String(required || '').trim().toUpperCase();
  const b = String(trayType || '').trim().toUpperCase();
  if (!a || !b) return false;
  if (a === b) return 'exact';
  if (b.startsWith(a + '-') || a.startsWith(b + '-')) return 'family';
  return false;
}

class Dispatcher {
  constructor() {
    this.queue = [];              // 待分发任务（按优先级排序后）
    this.known = new Set();       // 已处理过的 recordId（防事件与对账重复入队）
    this.printing = new Map();    // printerId → task（正在执行）
    this.completedCount = new Map(); // printerId → 累计完成数（负载均衡用）
    this.lastMaterialRemind = 0;  // 缺料提醒节流
    this.matching = false;        // 匹配过程串行化
    this.timer = null;
  }

  start() {
    if (this.timer) return;
    if (config.approval.enabled) {
      // 审批直连主通道：事件秒级且可靠，镜像表对账只会造成重复入队，关闭
      console.log('[分发] 审批直连主通道，表格对账已关闭');
      this.bindPrinterEvents();
      return;
    }
    // 对账兜底：网关事件丢失时分钟级补漏（审批表「已通过」未入队的记录）
    this.timer = setInterval(() => {
      this.reconcile().catch((err) =>
        console.error('[分发] 对账失败:', err.message)
      );
    }, Math.max(config.dispatch.reconcileMinutes, 1) * 60 * 1000);
    this.reconcile().catch(() => {});
    this.bindPrinterEvents();
    console.log(`[分发] 引擎已启动（对账间隔 ${config.dispatch.reconcileMinutes} 分钟）`);
  }

  bindPrinterEvents() {
    printerManager.on('jobEvent', ({ printer, event }) => {
      const task = this.printing.get(printer.id);
      if (event === 'finish') {
        if (task) this.completeTask(task, printer);
      } else if (event === 'failed') {
        if (task) this.failTask(task, printer, '打印机上报失败状态');
      } else if (event === 'idle') {
        // 打印机回到空闲：触发下一轮匹配
        this.trigger('printer-idle');
      }
    });
  }

  /** 对账：拉「已通过」状态的记录，补入队列（幂等） */
  async reconcile() {
    if (!config.bitable.reservationTableId) return;
    const records = await bitableApi.getAllRecords(config.bitable.reservationTableId);
    const approved = records.filter(
      (r) => r.fields && r.fields['申请状态'] === config.status.REVIEW_APPROVED
    );
    for (const r of approved) {
      this.enqueue(reservationService.formatReservation(r), { silent: true });
    }
    // 打印中的记录若重启后丢失映射，恢复占用关系（尽力而为）
    const printingRecords = records.filter(
      (r) => r.fields && r.fields['申请状态'] === config.status.PRINTING
    );
    for (const r of printingRecords) {
      if (![...this.printing.values()].some((t) => t.recordId === r.record_id)) {
        const task = reservationService.formatReservation(r);
        const printerName = r.fields[config.dispatch.printerField];
        const printer = printerManager.getAllPrinterStates().find((p) => p.name === printerName);
        if (printer) {
          this.printing.set(printer.id, task);
          console.log(`[分发] 恢复打印中任务映射: ${task.fileName || task.recordId} → ${printer.name}`);
        }
      }
    }
    this.trigger('reconcile');
  }

  /**
   * 入队（幂等）。来源：审批事件 / 对账 / 人工指令
   */
  enqueue(task, { silent = false } = {}) {
    if (!task || !task.recordId) return false;
    if (this.known.has(task.recordId)) return false;
    if (this.queue.some((t) => t.recordId === task.recordId)) return false;

    this.known.add(task.recordId);
    this.queue.push(task);
    const position = this.queue.length - 1;
    console.log(`[分发] 入队: ${task.applicationNo || task.recordId} ${task.materialType || ''}${task.color ? '×' + task.color : ''}${task.isUrgent ? ' [加急]' : ''}`);

    if (!silent) {
      sendMessage(require('../feishu/bot').buildQueueCard(task, position)).catch((err) =>
        console.error('[分发] 入队播报失败:', err.message)
      );
    }
    this.trigger('enqueue');
    return true;
  }

  dequeue(recordId) {
    this.queue = this.queue.filter((t) => t.recordId !== recordId);
    for (const [printerId, task] of this.printing) {
      if (task.recordId === recordId) {
        // 打印中取消：停机并释放
        printerManager.stopPrintOnPrinter(printerId).catch(() => {});
        this.printing.delete(printerId);
      }
    }
  }

  /** 触发一轮匹配（串行） */
  trigger(reason) {
    if (this.matching) return;
    this.matching = true;
    Promise.resolve()
      .then(() => this.match(reason))
      .catch((err) => console.error(`[分发] 匹配失败(${reason}):`, err.message))
      .finally(() => {
        this.matching = false;
        // 匹配过程中可能有新任务/新空闲，再跑一轮
        // （全部任务处于失败重试冷却期时不触发，等冷却定时器）
        if (
          this.queue.some((t) => this.isTaskReady(t)) &&
          printerManager.getAvailablePrinters().length > 0
        ) {
          setImmediate(() => this.trigger(reason + '-retry'));
        }
      });
  }

  /** 任务是否已过失败重试冷却期 */
  isTaskReady(task) {
    return !task.nextMatchAt || task.nextMatchAt <= Date.now();
  }

  async match(reason) {
    while (this.queue.length > 0) {
      const available = printerManager.getAvailablePrinters();
      if (available.length === 0) break;

      this.sortQueue();
      const task = this.queue.find((t) => this.isTaskReady(t));
      if (!task) break; // 全部任务都在重试冷却中

      const result = this.matchPrinter(task, available);

      if (!result) {
        // 队首匹配不到：不阻塞后续任务，看看后面的任务有没有能匹配的
        const alternate = this.findAnyMatch(available);
        if (!alternate) {
          this.notifyMaterialMissing();
          break;
        }
        await this.dispatch(alternate.task, alternate.printer);
        continue;
      }
      await this.dispatch(task, result);
    }
  }

  sortQueue() {
    this.queue.sort((a, b) => {
      if (!!b.isUrgent !== !!a.isUrgent) return b.isUrgent ? 1 : -1; // 加急在前
      return (a.enqueuedAt || 0) - (b.enqueuedAt || 0);               // 先来先服务
    });
    this.queue.forEach((t, i) => {
      if (!t.enqueuedAt) t.enqueuedAt = Date.now() + i;
    });
  }

  /** 为单个任务选机：指定打印机 → AMS 精确 → AMS 家族 → 负载最少 */
  matchPrinter(task, available) {
    // 双保险：只考虑真正空闲且支持自动分发的打印机（调用方列表未过滤时也不误选）
    const candidates = (available || []).filter(
      (p) => p.autoDispatch && ['空闲', '已完成'].includes(p.status)
    );

    // 1. 指定打印机
    if (task.assignedPrinter) {
      const named = candidates.find((p) => p.name === task.assignedPrinter);
      if (named) return named;
    }

    const needMaterial = String(task.materialType || '').trim().toUpperCase();
    const needColor = String(task.color || '').trim();
    const colorRgb = config.colorReference[needColor] || null;

    // 2. AMS 精确材料匹配（+颜色近似）
    for (const printer of candidates) {
      const tray = this.findTray(printer, needMaterial, colorRgb, 'exact');
      if (tray) return printer;
    }
    // 3. 家族匹配（PLA-CF/PLA-HF 等）
    for (const printer of candidates) {
      const tray = this.findTray(printer, needMaterial, colorRgb, 'family');
      if (tray) return printer;
    }
    return null;
  }

  findTray(printer, needMaterial, colorRgb, level) {
    if (!needMaterial) {
      // 未填材料：任意有料的槽位即可
      return (printer.ams || []).find((t) => t.type) || null;
    }
    for (const tray of printer.ams || []) {
      if (materialMatch(needMaterial, tray.type) !== level) continue;
      if (!colorRgb || !tray.colorHex) return tray;
      if (colorDistance(tray.colorHex, rgbToHex(colorRgb)) <= config.dispatch.colorDistanceThreshold) {
        return tray;
      }
    }
    return null;
  }

  /** 遍历整个队列找任何一个能匹配的组合（避免队首缺料阻塞整条队列；冷却中的任务跳过） */
  findAnyMatch(available) {
    for (const task of this.queue) {
      if (!this.isTaskReady(task)) continue;
      const printer = this.matchPrinter(task, available);
      if (printer) return { task, printer };
    }
    return null;
  }

  notifyMaterialMissing() {
    const now = Date.now();
    if (now - this.lastMaterialRemind < config.dispatch.materialRemindMinutes * 60 * 1000) return;
    this.lastMaterialRemind = now;

    const needs = this.queue
      .slice(0, 5)
      .map((t) => `${t.materialType || '任意材料'}×${t.color || '任意颜色'}（${t.applicationNo || t.fileName || t.recordId}）`)
      .join('；');
    sendMessage(require('../feishu/bot').buildMaterialMissingCard(this.queue.length, needs)).catch(() => {});
    console.log(`[分发] ${this.queue.length} 个任务缺料等待: ${needs}`);
  }

  /** 执行分发：下载 → 上传 → 下发 → 写表 → 占用登记 */
  async dispatch(task, printer) {
    this.queue = this.queue.filter((t) => t.recordId !== task.recordId);

    try {
      console.log(`[分发] 开始分发: ${task.applicationNo || task.recordId} → ${printer.name}`);

      const fromApproval = task.fileSource === 'approval';
      // 审批来源不写镜像表（那是审批系统的同步数据，写入会被覆盖且无权限）；
      // 状态追踪由引擎内存完成
      if (!fromApproval) {
        await bitableApi.updateRecord(config.bitable.reservationTableId, task.recordId, {
          '申请状态': config.status.PRINTING,
          [config.dispatch.printerField]: printer.name,
        });
      }

      if (!task.fileToken) throw new Error('任务缺少切片文件附件');

      // 远端文件名用 recordId，避免中文名/空格在 FTP URL 里出编码问题
      const remoteName = `print_${task.recordId}.3mf`;
      const buffer = fromApproval
        ? await downloadApprovalAttachment(task.fileToken, task.fileName)
        : await downloadFile(task.fileToken);
      await printerManager.uploadFileToPrinter(printer.id, buffer, remoteName);

      await printerManager.startProjectOnPrinter(
        printer.id,
        remoteName,
        task.fileName || task.applicationNo || remoteName,
        config.dispatch.useAms
      );

      task.startedAt = Date.now();
      this.printing.set(printer.id, task);
      printerManager.updateState(printer.id, { activeTask: task });

      sendMessage(
        require('../feishu/bot').buildJobStartCard(task, printer)
      ).catch((err) => console.error('[分发] 开始播报失败:', err.message));
    } catch (err) {
      console.error(`[分发] 分发失败 ${task.recordId}:`, err.message);
      // 回滚状态并重新排队（下一轮再试）；审批来源无表状态可回滚
      if (task.fileSource !== 'approval') {
        await bitableApi
          .updateRecord(config.bitable.reservationTableId, task.recordId, {
            '申请状态': config.status.REVIEW_APPROVED,
          })
          .catch(() => {});
      }
      // 重试上限 + 冷却：缺附件/上传失败等确定性失败若不设限，match 循环会原地死循环并刷屏
      task.dispatchRetries = (task.dispatchRetries || 0) + 1;
      if (task.dispatchRetries >= config.dispatch.maxRetries) {
        console.error(
          `[分发] 任务 ${task.recordId} 已重试 ${task.dispatchRetries} 次仍失败，退出队列，请人工处理`
        );
        sendMessage(
          require('../feishu/bot').buildJobFailedCard(
            task,
            printer,
            `分发失败：${err.message}；已自动重试 ${task.dispatchRetries} 次仍失败，已暂停自动分发，请人工介入`
          )
        ).catch(() => {});
        return;
      }
      task.dispatchError = err.message;
      task.nextMatchAt = Date.now() + config.dispatch.retryCooldownMs;
      task.enqueuedAt = Date.now();
      this.queue.push(task);
      sendMessage(
        require('../feishu/bot').buildJobFailedCard(
          task,
          printer,
          `分发失败：${err.message}，已重新排队（第 ${task.dispatchRetries}/${config.dispatch.maxRetries} 次重试）`
        )
      ).catch(() => {});
      // 冷却结束后再触发一轮匹配（否则要等到下一次入队/空闲事件才会重试）
      setTimeout(() => {
        if (this.queue.some((t) => t.recordId === task.recordId)) {
          this.trigger('retry-cooldown');
        }
      }, config.dispatch.retryCooldownMs + 500);
    }
  }

  async completeTask(task, printer) {
    if (this.printing.get(printer.id) !== task) return;
    this.printing.delete(printer.id);
    this.completedCount.set(printer.id, (this.completedCount.get(printer.id) || 0) + 1);
    printerManager.updateState(printer.id, { activeTask: null });

    if (task.fileSource !== 'approval') {
      await bitableApi
        .updateRecord(config.bitable.reservationTableId, task.recordId, {
          '申请状态': config.status.COMPLETED,
        })
        .catch((err) => console.error('[分发] 完成写表失败:', err.message));
    }

    sendMessage(require('../feishu/bot').buildJobFinishCard(task, printer)).catch(() => {});
    console.log(`[分发] 完成: ${task.applicationNo || task.recordId} @ ${printer.name}`);
    this.trigger('task-finish');
  }

  async failTask(task, printer, reason) {
    if (this.printing.get(printer.id) !== task) return;
    this.printing.delete(printer.id);
    printerManager.updateState(printer.id, { activeTask: null });

    if (task.fileSource !== 'approval') {
      await bitableApi
        .updateRecord(config.bitable.reservationTableId, task.recordId, {
          '申请状态': config.status.QUEUED,
        })
        .catch(() => {});
    }

    sendMessage(require('../feishu/bot').buildJobFailedCard(task, printer, reason)).catch(() => {});
    console.error(`[分发] 失败: ${task.applicationNo || task.recordId} @ ${printer.name} ${reason}`);
    this.trigger('task-failed');
  }

  /** 队列快照（指令/接口展示用） */
  getQueueSnapshot() {
    this.sortQueue();
    return this.queue.map((t, i) => ({
      position: i + 1,
      applicationNo: t.applicationNo,
      fileName: t.fileName,
      materialType: t.materialType,
      color: t.color,
      isUrgent: t.isUrgent,
      applicant: t.applicant?.name || '',
      recordId: t.recordId,
    }));
  }

  getPrintingSnapshot() {
    return [...this.printing.entries()].map(([printerId, task]) => ({
      printer: printerManager.getPrinterState(printerId)?.name || printerId,
      applicationNo: task.applicationNo,
      fileName: task.fileName,
      startedAt: task.startedAt,
    }));
  }

  /** 人工强制指定分发（/print-dispatch） */
  async manualDispatch(recordId, printerName) {
    const printer = printerManager.getAllPrinterStates().find(
      (p) => p.name === printerName || String(p.id) === String(printerName)
    );
    if (!printer) throw new Error(`未找到打印机「${printerName}」`);

    let task = this.queue.find((t) => t.recordId === recordId || t.applicationNo === recordId);
    if (!task) {
      // 不在队列里（可能还在审批中）→ 拉记录直接分发
      const records = await bitableApi.getAllRecords(config.bitable.reservationTableId);
      const record = records.find(
        (r) => r.record_id === recordId || r.fields['申请编号'] === recordId
      );
      if (!record) throw new Error(`未找到预约「${recordId}」`);
      task = reservationService.formatReservation(record);
    }

    if (!printer.autoDispatch) {
      // 非自动机型（如闪铸）：只写表提示人工上传
      await bitableApi.updateRecord(config.bitable.reservationTableId, task.recordId, {
        '申请状态': config.status.QUEUED,
        [config.dispatch.printerField]: printer.name,
      });
      return {
        manualOnly: true,
        message: `已指定 ${printer.name}（${printer.model}，需人工上传文件启动打印）：请用厂商工具将「${task.fileName}」发送到该打印机`,
      };
    }

    this.queue = this.queue.filter((t) => t.recordId !== task.recordId);
    await this.dispatch(task, printer);
    return { manualOnly: false, message: `已分发到 ${printer.name}` };
  }
}

function rgbToHex(rgb) {
  return '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
}

const dispatcher = new Dispatcher();

module.exports = dispatcher;
module.exports.colorDistance = colorDistance;
module.exports.materialMatch = materialMatch;
