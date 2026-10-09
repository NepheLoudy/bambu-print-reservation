const express = require('express');
const { requireApiToken, requireUser, parseCookies } = require('./auth');
const authStore = require('./services/authStore');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const config = require('./config');
const reservationService = require('./services/reservation');
const reservationStore = require('./services/reservationStore');
const processRules = require('./services/processRules');
const dispatcher = require('./services/dispatcher');
const printerManager = require('./printer/manager');
// 指令唯一出口：hub 经 POST /api/chat/command 转发（对话铁律——本仓不消费消息事件）
const { executeCommand } = require('./services/chatService');

// 2026-10-05 路线 A（断飞书审批链）：审批实例/任务/表格事件消费 + 审批对账整体退役
// （approvalService/eventSubscription 已随 v46 遗留清理批删除）；预约真相源改为本地存储
// （reservationStore），审批动作为本服务 HTTP 端点，飞书仅剩群 webhook 播报。

const app = express();

app.use(cors());
// 审批事件/表单可能较大（AGENTS.md 通用坑：express.json 放宽到 2mb）
app.use(express.json({ limit: '2mb' }));

// 前端页面（同源伺服，public/index.html）；HTML 不缓存——页面迭代后浏览器不得吃旧版
app.use(express.static(path.join(__dirname, '..', 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  },
}));

// 上传目录预建
fs.mkdirSync(reservationStore.UPLOAD_DIR, { recursive: true });
const MODEL_EXT_RE = /\.(stl|step|stp|3mf|obj)$/i; // 模型/切片扩展名白名单（审查批：拒任意文件）
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, reservationStore.UPLOAD_DIR),
    filename: (req, file, cb) =>
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e6)}${path.extname(file.originalname || '')}`),
  }),
  fileFilter: (req, file, cb) => {
    if (MODEL_EXT_RE.test(file.originalname || '')) return cb(null, true);
    cb(new Error('仅接受 .stl / .step / .stp / .3mf / .obj 模型文件'));
  },
  limits: { fileSize: 200 * 1024 * 1024 }, // 模型/切片文件上限 200MB
});

// multer/busby 编码实测（2026-10-05，干净进程 codepoint 插桩定案）：
//   file.originalname 按 latin1 解（需显式还原 UTF-8）；
//   multipart 文本字段 busboy 已按 UTF-8 解好——勿二次转换（否则中文反而乱码）

/** 取消/删除权限：本人（按提交时账号 id，displayName 非唯一键）或 reviewer/admin */
function assertCanManage(user, reservation) {
  if (!reservation) {
    const err = new Error('预约记录不存在');
    err.statusCode = 404;
    throw err;
  }
  if (reservation.submittedBy === user.id || ['reviewer', 'admin'].includes(user.role)) return;
  const err = new Error('只能操作自己的预约');
  err.statusCode = 403;
  throw err;
}

app.get('/api/health', (req, res) => {
  // 数据面文件状态（运维可见性：部署漏配项目外路径时在这里一眼看出）
  const fs = require('fs');
  const fileState = (p) => { try { return fs.existsSync(p) ? fs.statSync(p).size : null; } catch { return 'err'; } };
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    version: require('../package.json').version,
    phase: 'local-webapp', // 路线 A 自建前后端（2026-10-05）
    printers: config.printers.length,
    quietHours: require('./utils/quietHours').getStatus(),
    stores: {
      reservations: fileState(reservationStore.STORE_FILE),
      uploadsDir: fs.existsSync(reservationStore.UPLOAD_DIR),
      auth: fileState(require('./services/authStore').AUTH_FILE),
      rules: fileState(require('./services/processRules').getRulesSnapshot().rulesFile),
      ruleSuggestions: fileState(require('./services/ruleSuggestions').FILE),
      backup: (() => {
        const b = require('./services/backup').getLastRun();
        return b ? { lastCopied: b.copied.length, dir: b.dir } : null;
      })(),
    },
  });
});

// ---------- 账号体系（2026-10-05 第二批：防止未授权使用） ----------
// 注册开放（首位注册者自动 admin，之后均 member）；审批人由 admin 在页面升权。

app.post('/api/auth/register', (req, res) => {
  try {
    const { username, password, displayName, inviteCode } = req.body || {};
    res.json(authStore.register({ username, password, displayName, inviteCode }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/auth/login', (req, res) => {
  try {
    const { username, password } = req.body || {};
    const user = authStore.login(username, password);
    const token = authStore.createSession(user.id);
    res.setHeader('Set-Cookie',
      `bambu_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${30 * 24 * 3600}`);
    res.json(user);
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

app.post('/api/auth/logout', (req, res) => {
  const token = parseCookies(req).bambu_session;
  if (token) authStore.destroySession(token);
  res.setHeader('Set-Cookie', 'bambu_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0');
  res.json({ success: true });
});

app.get('/api/auth/me', (req, res) => {
  const user = authStore.resolveSession(parseCookies(req).bambu_session);
  if (!user) return res.status(401).json({ error: '未登录' });
  res.json(user);
});

// 修改密码（登录态 + 旧密码验证；api-token 通道无改密语义，明确拒绝）
app.post('/api/auth/change-password', (req, res) => {
  const user = authStore.resolveSession(parseCookies(req).bambu_session);
  if (!user || user.id === 'api-token') return res.status(401).json({ error: '未登录' });
  try {
    const { oldPassword, newPassword } = req.body || {};
    authStore.changePassword(user.id, oldPassword, newPassword);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 用户管理（admin）：名册 + 角色升降
app.get('/api/auth/users', requireUser('admin'), (req, res) => {
  res.json(authStore.listUsers());
});

app.post('/api/auth/users/:id/role', requireUser('admin'), (req, res) => {
  try {
    res.json(authStore.setRole(req.params.id, (req.body || {}).role));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------- 定制窗口（规则见顶层 AGENTS「机器人后端定制窗口」）：定制项全景只读 ----------

app.get('/api/print/policy', (req, res) => {
  let queue = null;
  try { queue = dispatcher.getQueueSnapshot(); } catch (err) { queue = null; }
  let printing = null;
  try { printing = dispatcher.getPrintingSnapshot(); } catch (err) { printing = null; }
  res.json({
    bot: { name: config.bot?.name || 'bambu-print-reservation', port: config.port },
    printers: {
      configured: config.printers.length,
      list: config.printers.map((p) => ({ id: p.id, name: p.name, model: p.model })),
      available: (() => { try { return printerManager.getAvailablePrinters().length; } catch { return null; } })(),
    },
    approval: {
      primaryChannel: false, // 2026-10-05 路线 A 退役：审批走自建页面，事件/对账链路已下线（字段保留仅供旧面板兼容）
      approvalCodeConfigured: Boolean(config.approval.approvalCode),
      autoApprove: false,
      reconcileMinutes: config.approval.reconcileMinutes,
      reconcileWindowMinutes: config.approval.reconcileWindowMinutes,
      retired: true,
    },
    dispatch: {
      colorDistanceThreshold: config.dispatch.colorDistanceThreshold,
      reconcileMinutes: config.dispatch.reconcileMinutes,
      materialRemindMinutes: config.dispatch.materialRemindMinutes,
      useAms: config.dispatch.useAms,
      maxRetries: config.dispatch.maxRetries,
      retryCooldownMs: config.dispatch.retryCooldownMs,
      givenUpCount: (() => { try { return dispatcher.listGivenUp().length; } catch { return null; } })(),
    },
    queue: { waiting: Array.isArray(queue) ? queue.length : null, printingCount: printing ? (Array.isArray(printing) ? printing.length : Object.keys(printing).length) : null },
    reviewResult: config.reviewResult,
  });
});

// 需求标签池窗口（「勾选 → 规则引擎 → 切片」体系第一层，只读全景）：
// 标签定义/映射提示/冲突规则，供运维台展示与「打标指南」文档页取数
app.get('/api/print/taxonomy', (req, res) => {
  res.json(require('./services/taxonomy').getTaxonomy());
});

// 颜色字典窗口（2026-10-08 只读）：提交页颜色栏 datalist 数据源 + 未识别色名提示依据
// （字典外颜色在选机时按「任意颜色」放行——此处把可匹配色集显式暴露给前端校验）
app.get('/api/print/colors', (req, res) => {
  res.json({
    colorNames: Object.keys(config.colorReference),
    threshold: config.dispatch.colorDistanceThreshold,
  });
});

// ---------- 工艺映射规则库窗口（体系第二层：标签 → 切片参数） ----------
// 读窗口：基线参数/白名单/规则集全景（含版本，进切片产物缓存 key）
app.get('/api/print/process-rules', (req, res) => {
  res.json(require('./services/processRules').getRulesSnapshot());
});
// 写窗口（管理端点，X-API-Token 鉴权）：热改规则，内存即时生效并写回规则文件
// body: { op: 'upsert' | 'remove' | 'reset', rule?, id? }
app.post('/api/print/process-rules', requireApiToken, (req, res) => {
  const { op, rule, id } = req.body || {};
  const rules = require('./services/processRules');
  let result;
  if (op === 'upsert') result = rules.upsertRule(rule);
  else if (op === 'remove') result = rules.removeRule(id);
  else if (op === 'reset') result = rules.resetRules();
  else return res.status(400).json({ error: 'op 必须是 upsert/remove/reset' });
  res.status(result.ok ? 200 : 400).json(result);
});

// ---------- 学习链路（2026-10-05 第三批）：预览 / 修正建议池 / 专家 3mf 导入 ----------

// 参数实时预览（登录用户）：提交页勾选变化即调，让用户/审批人提交前看到「本单会怎么切」
app.post('/api/print/process-rules/preview', requireUser(), (req, res) => {
  const { selection, material } = req.body || {};
  res.json(processRules.applyRules(selection || {}, { material }));
});

// 修正建议池（登录用户可提交——使用/审批中发现参数不合适即可提；待审池聚合，reviewer 采纳）
app.post('/api/print/rule-suggestions', requireUser(), (req, res) => {
  try {
    const { when, set, reason, source, sourceRef } = req.body || {};
    const result = require('./services/ruleSuggestions').add({
      when, set, reason, source, sourceRef, suggestedBy: req.user.displayName,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message, details: err.details });
  }
});

app.get('/api/print/rule-suggestions', requireUser('reviewer', 'admin'), (req, res) => {
  res.json(require('./services/ruleSuggestions').list(req.query.status));
});

app.post('/api/print/rule-suggestions/:id/adopt', requireUser('reviewer', 'admin'), (req, res) => {
  try {
    const { priority } = req.body || {};
    res.json(require('./services/ruleSuggestions').adopt(req.params.id, req.user.displayName, priority));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/print/rule-suggestions/:id/reject', requireUser('reviewer', 'admin'), (req, res) => {
  try {
    res.json(require('./services/ruleSuggestions').reject(req.params.id, req.user.displayName));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 专家 3mf 作品导入（reviewer+）：提取参数 diff 生成候选草稿——不入库，前端确认后走建议池
app.post('/api/print/slicer-extract', requireUser('reviewer', 'admin'), upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '缺少 3mf 文件（multipart 字段名 file）' });
    if (!/\.3mf$/i.test(req.file.originalname || '')) {
      try { fs.unlinkSync(req.file.path); } catch { /* 已不存在 */ }
      return res.status(400).json({ error: '仅接受 .3mf（专家切片产物/工程导出）' });
    }
    const result = require('./services/slicerExtract').extractFrom3mf(fs.readFileSync(req.file.path));
    try { fs.unlinkSync(req.file.path); } catch { /* 已不存在 */ }
    res.json(result);
  } catch (err) {
    if (req.file) { try { fs.unlinkSync(req.file.path); } catch { /* 已不存在 */ } }
    res.status(400).json({ error: `3mf 解析失败: ${err.message}` });
  }
});

app.get('/api/reservations', requireUser(), async (req, res) => {
  try {
    const reservations = await reservationService.getAllReservations();
    res.json(reservations);
  } catch (err) {
    console.error('获取预约列表失败:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/reservations/:id', requireUser(), async (req, res) => {
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

// 提交预约（登录用户）：**双通道分流（2026-10-05 曼波定）**——
//   .stl/.step/.stp = 需求链路：标签勾选 → 规则引擎定档切片参数（未来接服务端切片）；
//   .3mf = 审批直通：切片参数/AMS 映射已内嵌文件，引擎不定档不越俎代庖，审批后直接分发；
// 发起人取登录身份；硬冲突仅需求链路拦截（3mf 无标签冲突概念）
app.post('/api/reservations', requireUser(), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '缺少文件（multipart 字段名 file）' });
    const body = req.body || {};
    const fileName = Buffer.from(req.file.originalname || 'unnamed', 'latin1').toString('utf8');
    const isSliced = /\.3mf$/i.test(fileName); // 3mf = 已切片产物 → 审批直通

    let selection = {};
    if (!isSliced) {
      try {
        selection = body.selection ? JSON.parse(body.selection) : {};
      } catch {
        return res.status(400).json({ error: 'selection 不是合法 JSON' });
      }
    }

    // 需求链路才定档；3mf 直通（参数内嵌，快照置空并在页面标注）
    let applied = null;
    if (!isSliced) {
      applied = processRules.applyRules(selection, { material: body.materialType });
      if (applied.blocked) {
        try { fs.unlinkSync(req.file.path); } catch { /* 已不存在 */ }
        return res.status(400).json({ error: '需求勾选存在硬冲突', details: applied.errors, warnings: applied.warnings });
      }
    }

    // 3mf 审批透明化（2026-10-06）：提取文件内嵌切片参数摘要随单存档——审批人
    // 不用下载文件开 Bambu Studio 就能看参数。提取失败不阻塞提交（摘要置空）；
    // 大于 50MB 跳过提取（adm-zip 需整文件进内存，大文件会拖垮提交请求）
    let embeddedParams = null;
    let estMinutes = null;
    if (isSliced) {
      if (req.file.size > 50 * 1024 * 1024) {
        console.log(`[提交] 3mf 过大（${Math.round(req.file.size / 1048576)}MB），跳过参数提取`);
      } else {
        try {
          const extracted = require('./services/slicerExtract').extractFrom3mf(fs.readFileSync(req.file.path));
          embeddedParams = { source: extracted.source, params: extracted.params, estMinutes: extracted.estMinutes };
          estMinutes = extracted.estMinutes; // 预计时长随单入档（队列 ETA 用）
        } catch (err) {
          console.warn(`[提交] 3mf 参数提取失败（不影响提交）: ${err.message}`);
        }
      }
    }

    // 指定打印机校验（2026-10-08）：自由文本填错名字此前会静默走自动匹配或永远排队——
    // 显式指定的值必须命中登记清单，拼错当场打回
    if (String(body.assignedPrinter || '').trim()) {
      const wanted = String(body.assignedPrinter).trim();
      const valid = config.printers.some((p) => p.name === wanted);
      if (!valid) {
        try { fs.unlinkSync(req.file.path); } catch { /* 已不存在 */ }
        return res.status(400).json({
          error: `指定打印机「${wanted}」未登记，请从下拉选择（已登记：${config.printers.map((p) => p.name).join('、') || '无——先在 .env PRINTER_HOSTS 登记'}）`,
        });
      }
    }

    const reservation = await reservationService.createReservation({
      applicant: req.user.displayName, // 发起人 = 登录身份（防冒名），body.applicant 忽略
      submittedBy: req.user.id,        // 归属判定键（本人取消等）
      // 仅文件名需 latin1→UTF-8 还原（文本字段 busboy 已按 UTF-8 解好）
      fileName,
      filePath: req.file.path,
      fileSize: req.file.size,
      materialType: body.materialType,
      color: body.color,
      assignedPrinter: body.assignedPrinter,
      // 高速打印标签联动加急排队（仅需求链路；3mf 加急走表单 isUrgent）
      isUrgent: body.isUrgent === 'true' || body.isUrgent === '1' || selection.fast_mode === true,
      quantity: body.quantity,
      selection,
      processParams: applied ? applied.params : null,
      appliedRules: applied ? applied.applied : [],
      embeddedParams, // 3mf 内嵌参数摘要（审批透明化；需求链路单为 null）
      estMinutes,     // 3mf 内嵌预估时长（队列 ETA；需求链路单为 null）
    });

    reservationService.notifyReviewers(reservation).catch(() => {}); // fire-and-forget
    require('./services/usageReport').reportUsage(req.user.username, 'print-submit').catch(() => {});
    res.json(reservation);
  } catch (err) {
    console.error('提交预约失败:', err);
    if (req.file) { try { fs.unlinkSync(req.file.path); } catch { /* 已不存在 */ } }
    res.status(400).json({ error: err.message, details: err.details, warnings: err.details?.warnings || [] });
  }
});

app.put('/api/reservations/:id', requireUser('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ error: '状态不能为空' });
    }

    const reservation = reservationStore.get(id);
    if (!reservation) {
      return res.status(404).json({ error: '预约记录不存在' });
    }

    if (status === config.status.REVIEW_APPROVED) {
      await reservationService.approveReservation(id, 'HTTP', '');
    } else if (status === config.status.CANCELLED) {
      await reservationService.cancelReservation(id);
    } else {
      reservationStore.updateStatus(id, status, 'HTTP 状态变更（状态机校验）');
    }

    res.json(reservationStore.get(id));
  } catch (err) {
    console.error('更新预约失败:', err);
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/reservations/:id', requireUser(), async (req, res) => {
  try {
    const { id } = req.params;
    assertCanManage(req.user, reservationStore.get(id));
    await reservationService.cancelReservation(id);
    res.json({ success: true });
  } catch (err) {
    console.error('取消预约失败:', err);
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

// ---------- 审批动作（reviewer 及以上；运维台 X-API-Token 走 admin 通道不受影响） ----------

app.post('/api/reservations/:id/approve', requireUser('reviewer', 'admin'), async (req, res) => {
  try {
    const { comment } = req.body || {};
    const result = await reservationService.approveReservation(req.params.id, req.user.displayName, comment);
    require('./services/usageReport').reportUsage(req.user.username, 'print-approve').catch(() => {});
    res.json(result);
  } catch (err) {
    console.error('审批通过失败:', err);
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/reservations/:id/reject', requireUser('reviewer', 'admin'), async (req, res) => {
  try {
    const { comment } = req.body || {};
    const result = await reservationService.rejectReservation(req.params.id, req.user.displayName, comment);
    require('./services/usageReport').reportUsage(req.user.username, 'print-reject').catch(() => {});
    res.json(result);
  } catch (err) {
    console.error('审批驳回失败:', err);
    res.status(400).json({ error: err.message });
  }
});

// 兼容旧端点：/review 按结果转发 approve/reject
app.post('/api/reservations/:id/review', requireUser('reviewer', 'admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { reviewResult, reviewComment } = req.body;
    if (!reviewResult) {
      return res.status(400).json({ error: '审查结果不能为空' });
    }
    const result = reviewResult === config.reviewResult.APPROVED
      ? await reservationService.approveReservation(id, req.user.displayName, reviewComment)
      : await reservationService.rejectReservation(id, req.user.displayName, reviewComment);
    res.json(result);
  } catch (err) {
    console.error('处理审查结果失败:', err);
    res.status(400).json({ error: err.message });
  }
});

// 复刻（2026-10-08）：已完成单一键带参重提（打坏了重打/帮同学打同款）——
// 服务端复制源文件免重传；需求链路单按当前规则库重新定档；新单走完整审批流
app.post('/api/reservations/:id/reprint', requireUser(), async (req, res) => {
  try {
    const reservation = await reservationService.reprintReservation(req.params.id, req.user, req.body || {});
    reservationService.notifyReviewers(reservation).catch(() => {}); // fire-and-forget
    require('./services/usageReport').reportUsage(req.user.username, 'print-reprint').catch(() => {});
    res.json(reservation);
  } catch (err) {
    console.error('复刻预约失败:', err);
    res.status(400).json({ error: err.message, details: err.details, warnings: err.details?.warnings || [] });
  }
});

// 取消：本人取消自己的单，或 reviewer/admin 代管（用户自助取消）
app.post('/api/reservations/:id/cancel', requireUser(), async (req, res) => {
  try {
    assertCanManage(req.user, reservationStore.get(req.params.id));
    res.json(await reservationService.cancelReservation(req.params.id));
  } catch (err) {
    console.error('取消预约失败:', err);
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

app.get('/api/reservations/status/pending-review', requireUser(), async (req, res) => {
  try {
    const reservations = await reservationService.getPendingReviewReservations();
    res.json(reservations);
  } catch (err) {
    console.error('获取待审批预约失败:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/reservations/status/printing', requireUser(), async (req, res) => {
  try {
    const reservations = await reservationService.getPrintingReservations();
    res.json(reservations);
  } catch (err) {
    console.error('获取打印中预约失败:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/reservations/status/completed', requireUser(), async (req, res) => {
  try {
    const reservations = await reservationService.getCompletedReservations();
    res.json(reservations);
  } catch (err) {
    console.error('获取已完成预约失败:', err);
    res.status(500).json({ error: err.message });
  }
});

// 打印机实时状态（含内网 IP/温度/AMS，登录可见——不放匿名面；stateStale=报文过期失联标注）
app.get('/api/printers', requireUser(), (req, res) => {
  try {
    const printers = printerManager.getApiStates();
    res.json(printers);
  } catch (err) {
    console.error('获取打印机状态失败:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/printers/available', requireUser(), (req, res) => {
  try {
    const printers = printerManager.getAvailablePrinters();
    res.json(printers);
  } catch (err) {
    console.error('获取可用打印机失败:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 真机联调核对面（admin）：raw state 报文全量 + 连接/新鲜度元信息——AMS 报文形状、
// gcodeState 序列等「待真机核对」假设出错时，用它区分「报文假设错了」还是「解析错了」
app.get('/api/printers/:id/debug', requireUser('admin'), (req, res) => {
  const debug = printerManager.getPrinterDebug(parseInt(req.params.id));
  if (!debug) return res.status(404).json({ error: '打印机不存在' });
  res.json(debug);
});

app.get('/api/printers/:id', requireUser(), (req, res) => {
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

app.post('/api/printers/:id/print', requireUser('admin'), async (req, res) => {
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

app.post('/api/printers/:id/pause', requireUser('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    await printerManager.pausePrintOnPrinter(parseInt(id));
    res.json({ success: true });
  } catch (err) {
    console.error('暂停打印失败:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/printers/:id/resume', requireUser('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    await printerManager.resumePrintOnPrinter(parseInt(id));
    res.json({ success: true });
  } catch (err) {
    console.error('恢复打印失败:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/printers/:id/stop', requireUser('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    await printerManager.stopPrintOnPrinter(parseInt(id));
    res.json({ success: true });
  } catch (err) {
    console.error('停止打印失败:', err);
    res.status(500).json({ error: err.message });
  }
});

// /api/feishu/event 端点已随 2026-10-05 路线 A 退役（审批实例/任务/表格事件不再消费）；
// url_verification 握手随事件订阅一并成为历史。

app.post('/api/chat/command', async (req, res) => {
  try {
    const { command, args } = req.body;

    if (!command) {
      return res.status(400).json({ error: '指令不能为空' });
    }

    const reply = await executeCommand(command, args || []);
    res.json({ reply });
  } catch (err) {
    console.error('处理指令失败:', err);
    res.json({ reply: `❌ 指令执行失败：${err.message}` });
  }
});

// ---------- 分发引擎 ----------

app.get('/api/dispatch/queue', requireUser(), (req, res) => {
  res.json({
    queue: dispatcher.getQueueSnapshot(),
    printing: dispatcher.getPrintingSnapshot(),
    givenUp: dispatcher.listGivenUp(), // 重试耗尽待人工恢复（页面黄条 + 恢复按钮消费）
  });
});

app.post('/api/dispatch/manual', requireUser('reviewer', 'admin'), async (req, res) => {
  try {
    const { recordId, printerName } = req.body;
    if (!recordId || !printerName) {
      return res.status(400).json({ error: 'recordId 和 printerName 不能为空' });
    }
    const result = await dispatcher.manualDispatch(recordId, printerName);
    res.json(result);
  } catch (err) {
    console.error('手动分发失败:', err);
    res.status(500).json({ error: err.message });
  }
});

// multer 校验失败（扩展名白名单/超限）等中间件错误 → 统一 JSON 400（而非默认 500 HTML）
app.use((err, req, res, next) => {
  if (!err) return next();
  console.error('[HTTP] 请求处理失败:', err.message);
  res.status(400).json({ error: err.message || '请求处理失败' });
});

function startServer() {
  const server = app.listen(config.port, () => {
    console.log(`🚀 拓竹3D打印预约系统（自建前后端）运行在 http://localhost:${config.port}`);
    console.log(`📚 API 健康检查: http://localhost:${config.port}/api/health`);
    console.log(`🖨️ 打印机数量: ${config.printers.length}`);
    if (!config.bitable.appToken) console.log('ℹ️ 未配置 BITABLE_APP_TOKEN（路线 A 已不依赖表格，保持空即可）');
  });

  // 2026-10-05 路线 A：startEventSubscription()（审批/表格事件订阅 + 审批对账）已退役；
  // 2026-10-10 修复：当时把 dispatcher.start() 一并弄丢（原挂在事件订阅启动里），
  // 分发引擎此后从未启动——队列恢复、jobEvent 完成收尾/失败重排/份数续打、幽灵巡检、
  // 退出冲刷全是死代码，且被「真机未接入 + 桩测试直调方法」双重掩盖。这里接回。
  require('./services/dispatcher').start();

  // 晚间静默：启动时若有积压通知，按当前时点调度补发（过点立即、未过点等到窗口结束整点）
  require('./utils/quietHours').initQuietHoursFlush();

  // 上传源文件生命周期：启动清一轮 + 每 6h 一轮（终态单超保留期的源文件，0=禁用）
  const retentionCleanup = () => {
    try {
      const r = reservationStore.cleanupExpiredUploads();
      if (r.removed > 0) console.log(`[存储维护] 已清理 ${r.removed} 个过期上传源文件`);
    } catch (err) {
      console.warn('[存储维护] 清理失败:', err.message);
    }
  };
  retentionCleanup();
  setInterval(retentionCleanup, 6 * 3600 * 1000);

  // 数据面每日快照（预约/账号/规则/建议四 JSON，保留 14 天；uploads 不备份）
  require('./services/backup').scheduleBackup();

  process.on('SIGINT', async () => {
    console.log('\n正在关闭服务器...');
    await printerManager.cleanupFileSessions();
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
module.exports.startServer = startServer; // 桩测试/运维脚本用（生产走 require.main 分支）
