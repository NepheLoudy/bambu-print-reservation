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
const APPROVAL_CHAT_ID = 'oc_1ea53731a8772400450da6ab107f8331';
const DEFAULT_MESSAGE_ROUTES = [
  // 审批群：任何 / 指令直接交给 approval-bot（无需 @，网关代回复）
  { match: { chatId: APPROVAL_CHAT_ID, prefix: '/' }, target: 'approval', mode: 'command' },
  { match: { prefix: '/approval' }, target: 'approval', mode: 'command' },
  { match: { prefix: '/print' }, target: 'bambu', mode: 'command' },
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
  eventTypes: parseList(process.env.EVENT_TYPES).length
    ? parseList(process.env.EVENT_TYPES)
    : ['im.message.receive_v1', 'drive.file.bitable_record_changed_v1'],
  verificationToken: process.env.FEISHU_VERIFICATION_TOKEN || '',
  consumers: envConsumers.length ? envConsumers : parseConsumers(DEFAULT_CONSUMERS.join(';')),
  messageRoutes: parseJsonArray(process.env.MESSAGE_ROUTES, DEFAULT_MESSAGE_ROUTES),
  defaultTarget: process.env.DEFAULT_TARGET || 'hub',
  // 多维表格事件广播目标，留空 = 全部消费者（各机器人按 table_id 自行过滤）
  bitableTargets: parseList(process.env.BITABLE_TARGETS),
  // 需要订阅记录变更的云文档 appToken（bitable 记录变更事件的前置条件）
  docSubscribes: parseList(process.env.DOC_SUBSCRIBES),
};
