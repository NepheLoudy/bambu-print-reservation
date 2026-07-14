const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function parseArrayConfig(value) {
  if (!value) return [];
  return value.split(',').map(v => v.trim()).filter(v => v);
}

const printerHosts = parseArrayConfig(process.env.PRINTER_HOSTS);
const printerAccessCodes = parseArrayConfig(process.env.PRINTER_ACCESS_CODES);
const printerSerials = parseArrayConfig(process.env.PRINTER_SERIALS);
const printerNames = parseArrayConfig(process.env.PRINTER_NAMES);
const printerModels = parseArrayConfig(process.env.PRINTER_MODELS);

const printers = printerHosts.map((host, index) => ({
  id: index + 1,
  name: printerNames[index] || `打印机${index + 1}`,
  model: printerModels[index] || 'P1S',
  host: host,
  accessCode: printerAccessCodes[index] || '',
  serial: printerSerials[index] || '',
}));

module.exports = {
  port: process.env.PORT || 3001,
  
  feishu: {
    appId: process.env.APP_ID || '',
    appSecret: process.env.APP_SECRET || '',
  },
  
  bitable: {
    appToken: process.env.BITABLE_APP_TOKEN || '',
    reservationTableId: process.env.BITABLE_RESERVATION_TABLE_ID || '',
    printerTableId: process.env.BITABLE_PRINTER_TABLE_ID || '',
    reviewTableId: process.env.BITABLE_REVIEW_TABLE_ID || '',
  },
  
  feishuEvent: {
    verificationToken: process.env.FEISHU_VERIFICATION_TOKEN || '',
    encryptKey: process.env.FEISHU_ENCRYPT_KEY || '',
    useLongConnection: process.env.FEISHU_USE_LONG_CONNECTION !== 'false',
  },
  
  bot: {
    name: process.env.BOT_NAME || '爆米花机-对话型',
    webhookUrl: process.env.BOT_WEBHOOK_URL || '',
    chatId: process.env.BOT_CHAT_ID || '',
  },
  
  printers,
  
  reviewers: parseArrayConfig(process.env.REVIEWERS),
  
  status: {
    PENDING_REVIEW: '待审查',
    REVIEW_APPROVED: '审查通过',
    REVIEW_REJECTED: '审查驳回',
    QUEUED: '排队中',
    PRINTING: '打印中',
    COMPLETED: '已完成',
    CANCELLED: '已取消',
  },
  
  reviewResult: {
    APPROVED: '通过',
    REJECTED: '驳回',
  },
  
  printerStatus: {
    IDLE: '空闲',
    PRINTING: '打印中',
    FAULT: '故障',
    MAINTENANCE: '维护中',
  },
};
