const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// 下游机器人消费者默认清单（可用 CONSUMERS 环境变量整体覆盖）
// 格式：名称|事件回调URL|指令转发URL(可选)|标记(可选, legacy=按旧版事件结构转发)
const DEFAULT_CONSUMERS = [
  'hub|http://localhost:3000/api/feishu/event',
  'approval|http://localhost:3002/api/feishu/event|http://localhost:3002/api/chat/command',
  'bambu|http://localhost:3001/api/feishu/event|http://localhost:3001/api/chat/command|legacy',
  'ticket|http://localhost:3003/api/feishu/event',
];

// 消息事件路由默认规则（可用 MESSAGE_ROUTES 环境变量整体覆盖）
// 按顺序匹配，命中即停；全部未命中转发给 defaultTarget（event 模式）
//
// ⚠️ qianli 架构铁律：除工单接单监听外，所有对话/指令逻辑统一由
// 对话型机器人（hub = knowledge-tracker / 爆米花机-对话型）触发，
// 由它转发给专项服务（/approval-* → approval-bot、/print-* → bambu）。
// 专项机器人只提供 /api/chat/command 指令端点，不直接消费对话。
const DEFAULT_MESSAGE_ROUTES = [
  // 例外：工单域消息由 ticket-bot 处理（接单监听 + 工单指令）
  { match: { prefix: '/ticket' }, target: 'ticket', mode: 'event' },
  { match: { contains: '接单', mention: true }, target: 'ticket', mode: 'event' },
];

function parseConsumers(raw) {
  return String(raw || '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const [name, eventUrl, commandUrl, flag] = entry.split('|').map((p) => p.trim());
      return { name, eventUrl, commandUrl: commandUrl || '', legacy: flag === 'legacy' };
    })
    .filter((c) => c.name && c.eventUrl);
}

function parseList(raw) {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseJsonArray(raw, fallback) {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch (err) {
    console.warn('[配置] MESSAGE_ROUTES 解析失败，使用默认路由:', err.message);
    return fallback;
  }
}

const envConsumers = parseConsumers(process.env.CONSUMERS);

module.exports = {
  port: process.env.PORT || 3010,
  feishu: {
    appId: process.env.APP_ID || '',
    appSecret: process.env.APP_SECRET || '',
  },
  // 长连接订阅的事件类型（逗号分隔），接入新事件类型在这里加
  // approval_instance = 审批实例状态变更（官方审批事件，秒级；表格同步镜像有半小时延迟，不能作触发源）
  eventTypes: parseList(process.env.EVENT_TYPES).length
    ? parseList(process.env.EVENT_TYPES)
    : ['im.message.receive_v1', 'drive.file.bitable_record_changed_v1', 'approval_instance'],
  verificationToken: process.env.FEISHU_VERIFICATION_TOKEN || '',
  consumers: envConsumers.length ? envConsumers : parseConsumers(DEFAULT_CONSUMERS.join(';')),
  messageRoutes: parseJsonArray(process.env.MESSAGE_ROUTES, DEFAULT_MESSAGE_ROUTES),
  defaultTarget: process.env.DEFAULT_TARGET || 'hub',
  // 多维表格事件广播目标，留空 = 全部消费者（各机器人按 table_id 自行过滤）
  bitableTargets: parseList(process.env.BITABLE_TARGETS),
  // 审批实例事件转发目标，留空 = bambu（打印分发以审批状态为准）
  approvalTargets: parseList(process.env.APPROVAL_TARGETS).length
    ? parseList(process.env.APPROVAL_TARGETS)
    : ['bambu'],
  // 需要订阅记录变更的云文档 appToken（bitable 记录变更事件的前置条件）
  docSubscribes: parseList(process.env.DOC_SUBSCRIBES),
};
