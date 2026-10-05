// ============================================================
// 预约本地存储（2026-10-05 路线 A：断飞书审批链，预约系统整体本地化）
//
// 真相源 = 本文件管理的 JSON 存储（不再依赖多维表格镜像/审批实例事件）。
// 持久化模式照 DISPATCH_STATE_FILE：外部数据目录（部署清目录不丢）、
// 同步写 + 临时文件原子改名；预约低频写，不做防抖。
//
// 状态机（config.status）：
//   待审批 → 已通过 | 已驳回 | 已取消
//   已通过 → 排队中 | 已取消
//   排队中 → 打印中 | 排队中(失败重排) | 已取消
//   打印中 → 已完成 | 排队中(失败重排) | 已取消
//   已完成/已驳回/已取消 = 终态
// ============================================================

const fs = require('fs');
const path = require('path');
const config = require('../config');
const taxonomy = require('./taxonomy');

const STORE_FILE = process.env.RESERVATIONS_STORE_FILE || path.join(__dirname, '..', '..', '.reservations.json');
const UPLOAD_DIR = process.env.RESERVATIONS_UPLOAD_DIR || path.join(__dirname, '..', '..', 'data', 'uploads');

// 状态机：from → 允许的 to 集合
const TRANSITIONS = {
  [config.status.PENDING_REVIEW]: [config.status.REVIEW_APPROVED, config.status.REVIEW_REJECTED, config.status.CANCELLED],
  [config.status.REVIEW_APPROVED]: [config.status.QUEUED, config.status.CANCELLED],
  [config.status.QUEUED]: [config.status.PRINTING, config.status.QUEUED, config.status.COMPLETED, config.status.REVIEW_APPROVED, config.status.CANCELLED],
  [config.status.PRINTING]: [config.status.COMPLETED, config.status.QUEUED, config.status.CANCELLED],
  [config.status.COMPLETED]: [],
  [config.status.REVIEW_REJECTED]: [],
  [config.status.CANCELLED]: [],
};

function save(records) {
  const tmp = STORE_FILE + '.tmp';
  fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify({ savedAt: new Date().toISOString(), records }, null, 2));
  fs.renameSync(tmp, STORE_FILE);
}

function load() {
  try {
    if (!fs.existsSync(STORE_FILE)) return [];
    const data = JSON.parse(fs.readFileSync(STORE_FILE, 'utf-8'));
    return Array.isArray(data.records) ? data.records : [];
  } catch (err) {
    console.warn('[预约存储] 存储文件加载失败（按空启动）:', err.message);
    return [];
  }
}

/** 当日单号：R + YYYYMMDD + '-' + 3 位当日序号（以既有记录为准，重启不重号） */
function nextId(records) {
  const day = new Date();
  const ymd = `${day.getFullYear()}${String(day.getMonth() + 1).padStart(2, '0')}${String(day.getDate()).padStart(2, '0')}`;
  const prefix = `R${ymd}-`;
  const todayCount = records.filter((r) => String(r.id).startsWith(prefix)).length;
  return `${prefix}${String(todayCount + 1).padStart(3, '0')}`;
}

const reservationStore = {
  STORE_FILE,
  UPLOAD_DIR,

  /** 提交预约：材料可空——由需求标签反推（materialExclude/materialPrefer 随 processParams 下发选机） */
  create(input) {
    const errors = [];
    if (!input.applicant || !String(input.applicant).trim()) errors.push('发起人不能为空');
    if (!input.fileName) errors.push('切片/模型文件不能为空');
    if (!input.filePath) errors.push('文件未落盘');

    const selection = input.selection || {};
    const gate = taxonomy.validateSelection(selection, { material: input.materialType });
    errors.push(...gate.errors);
    if (errors.length > 0) {
      const err = new Error(errors.join('；'));
      err.details = { errors, warnings: gate.warnings };
      throw err;
    }

    const records = load();
    const now = new Date().toISOString();
    const record = {
      id: nextId(records),
      createdAt: now,
      updatedAt: now,
      status: config.status.PENDING_REVIEW,
      applicant: String(input.applicant).trim(),
      submittedBy: String(input.submittedBy || ''), // 提交账号 id（归属判定键，displayName 非唯一）
      fileName: input.fileName,
      filePath: input.filePath,
      fileSize: input.fileSize || 0,
      materialType: String(input.materialType || '').trim(),
      color: String(input.color || '').trim(),
      assignedPrinter: String(input.assignedPrinter || '').trim(),
      isUrgent: Boolean(input.isUrgent),
      quantity: Number(input.quantity) > 0 ? Number(input.quantity) : 1,
      selection,
      processParams: input.processParams || null,   // applyRules 快照（需求链路单；3mf 直通为 null）
      appliedRules: input.appliedRules || [],
      embeddedParams: input.embeddedParams || null, // 3mf 内嵌参数摘要（审批透明化）
      processWarnings: gate.warnings,
      review: null,
      printer: null,
      history: [{ at: now, from: null, to: config.status.PENDING_REVIEW, note: '提交预约' }],
    };
    records.push(record);
    save(records);
    return { ...record };
  },

  get(id) {
    return load().find((r) => r.id === id) || null;
  },

  list() {
    return load();
  },

  countByStatus(status) {
    return load().filter((r) => r.status === status).length;
  },

  /** 状态流转（状态机校验非法流转即抛）；printer 可选记录分配结果 */
  updateStatus(id, to, note = '') {
    const records = load();
    const record = records.find((r) => r.id === id);
    if (!record) throw new Error(`预约不存在: ${id}`);
    const allowed = TRANSITIONS[record.status] || [];
    if (!allowed.includes(to)) {
      throw new Error(`状态机不允许「${record.status}」→「${to}」`);
    }
    const at = new Date().toISOString();
    record.history.push({ at, from: record.status, to, note });
    record.status = to;
    record.updatedAt = at;
    save(records);
    return { ...record };
  },

  /** 审批记录（不流转状态，附言用途） */
  setReview(id, review) {
    const records = load();
    const record = records.find((r) => r.id === id);
    if (!record) throw new Error(`预约不存在: ${id}`);
    record.review = { ...review, at: new Date().toISOString() };
    record.updatedAt = record.review.at;
    save(records);
    return { ...record };
  },

  setPrinter(id, printerName) {
    const records = load();
    const record = records.find((r) => r.id === id);
    if (!record) throw new Error(`预约不存在: ${id}`);
    record.printer = printerName;
    record.updatedAt = new Date().toISOString();
    save(records);
    return { ...record };
  },

  /**
   * 上传源文件生命周期（2026-10-05 审查批）：终态单（已完成/已取消/已驳回）超过
   * UPLOAD_RETENTION_DAYS 天（默认 30，0=禁用）后清理源文件——磁盘护栏；单据记录
   * 与参数快照永久保留（fileCleaned 标记），打印产物不受影响
   */
  cleanupExpiredUploads(now = Date.now()) {
    const days = Number(process.env.UPLOAD_RETENTION_DAYS || 30);
    if (!days || days <= 0) return { disabled: true, removed: 0 };
    const records = load();
    let removed = 0;
    for (const record of records) {
      if (!['已完成', '已取消', '已驳回'].includes(record.status)) continue;
      if (record.fileCleaned || !record.filePath) continue;
      const age = now - new Date(record.updatedAt || record.createdAt).getTime();
      if (age < days * 24 * 3600 * 1000) continue;
      try {
        fs.unlinkSync(record.filePath);
        record.fileCleaned = true;
        record.fileCleanedAt = new Date(now).toISOString();
        removed++;
      } catch (err) {
        if (err.code === 'ENOENT') { record.fileCleaned = true; } else { console.warn(`[预约存储] 清理源文件失败 ${record.id}:`, err.message); }
      }
    }
    if (removed > 0) save(records);
    return { disabled: false, removed };
  },
};

module.exports = reservationStore;
