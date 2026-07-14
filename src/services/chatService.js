const config = require('../config');
const reservationService = require('./reservation');
const printerManager = require('../printer/manager');
const { sendTextMessage, sendCardToChat, buildPrintStatusCard, buildReservationAlertCard } = require('../feishu/bot');

const processedMessageIds = new Set();

function isMentionedBot(message) {
  if (!message) return false;

  const chatType = message.chat_type;
  if (chatType === 'p2p') return true;

  if (!message.mentions || message.mentions.length === 0) return false;

  const botName = config.bot.name || '爆米花机';
  return message.mentions.some(m => {
    if (m.id === 'self') return true;
    if (m.name === botName) return true;
    return false;
  });
}

function extractTextWithoutMention(message) {
  let text = '';
  
  if (message.content) {
    try {
      const content = typeof message.content === 'string' ? JSON.parse(message.content) : message.content;
      text = content.text || '';
    } catch (e) {
      text = message.content.toString() || '';
    }
  } else if (message.text) {
    text = message.text;
  }

  const botName = config.bot.name || '爆米花机';

  return text
    .replace(new RegExp(`@${botName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'g'), '')
    .replace(/@_user_\d+\s*/g, '')
    .replace(/@_bot_\d+\s*/g, '')
    .replace(/@_everyone\s*/g, '')
    .trim();
}

function parseCommand(text) {
  if (!text || !text.startsWith('/')) return null;
  
  const parts = text.split(/\s+/);
  const command = parts[0].toLowerCase();
  const args = parts.slice(1);
  
  return { command, args, raw: text };
}

async function handleHelpCommand() {
  const botName = config.bot.name || '爆米花机';
  return `🖨️ ${botName} - 3D打印预约指令帮助

打印预约指令：
  /print-help     显示打印相关帮助
  /print-status   查看打印机状态
  /print-list     查看预约列表
  /print-pending  查看待审查预约
  /print-add      创建打印预约（需在多维表格中操作）

使用方式：
  • 群聊中请先 @${botName} 再发送指令
  • 示例：@${botName} /print-status`;
}

async function handlePrintHelpCommand() {
  return `🖨️ 3D打印预约系统 - 指令帮助

📋 查询指令：
  /print-status   查看所有打印机状态（在线/打印中/空闲）
  /print-list     查看当前所有预约记录
  /print-pending  查看待审查的预约（需审查者处理）

🖨️ 打印机控制：
  /print-start <ID> <文件路径>  开始打印
  /print-pause <ID>            暂停打印
  /print-resume <ID>           恢复打印
  /print-stop <ID>             停止打印

📝 预约管理（需在多维表格中操作）：
  • 预约表：填写申请人、时间、文件、打印机
  • 审查者在Bambu Studio中审查切片文件
  • 审查通过后自动上传并排队打印

示例：
  @爆米花机 /print-status
  @爆米花机 /print-list`;
}

async function handlePrintStatusCommand() {
  const printers = printerManager.getAllPrinterStates();
  
  if (printers.length === 0) {
    return '🖨️ 暂无配置的打印机';
  }

  const lines = ['🖨️ 打印机状态', ''];
  
  printers.forEach((printer, i) => {
    let statusIcon = '🔵';
    let statusText = printer.status;
    
    if (printer.status === 'idle' || printer.status === 'connected') {
      statusIcon = '🟢';
      statusText = '空闲';
    } else if (printer.status === 'printing') {
      statusIcon = '🟠';
      statusText = '打印中';
    } else if (printer.status === 'paused') {
      statusIcon = '🟡';
      statusText = '已暂停';
    } else if (printer.status === 'fault') {
      statusIcon = '🔴';
      statusText = '故障';
    }

    lines.push(`${i + 1}. ${statusIcon} ${printer.name} (${printer.model})`);
    lines.push(`   IP: ${printer.host}`);
    lines.push(`   状态: ${statusText}`);
    
    if (printer.currentJob) {
      lines.push(`   当前任务: ${printer.currentJob}`);
    }
    
    if (printer.progress > 0) {
      lines.push(`   进度: ${printer.progress}%`);
    }
    
    const temps = [];
    if (printer.nozzleTemp) temps.push(`喷嘴 ${printer.nozzleTemp}°C`);
    if (printer.bedTemp) temps.push(`热床 ${printer.bedTemp}°C`);
    if (printer.chamberTemp) temps.push(`腔室 ${printer.chamberTemp}°C`);
    if (temps.length > 0) {
      lines.push(`   温度: ${temps.join(', ')}`);
    }
    
    lines.push('');
  });
  
  return lines.join('\n');
}

async function handlePrintListCommand() {
  const reservations = await reservationService.getAllReservations();
  
  if (reservations.length === 0) {
    return '📋 暂无打印预约记录';
  }

  const lines = ['📋 打印预约列表', ''];
  
  reservations.forEach((res, i) => {
    let statusIcon = '📋';
    
    switch (res.status) {
      case config.status.PENDING_REVIEW:
        statusIcon = '⏳';
        break;
      case config.status.REVIEW_APPROVED:
        statusIcon = '✅';
        break;
      case config.status.REVIEW_REJECTED:
        statusIcon = '❌';
        break;
      case config.status.QUEUED:
        statusIcon = '📝';
        break;
      case config.status.PRINTING:
        statusIcon = '🖨️';
        break;
      case config.status.COMPLETED:
        statusIcon = '🎉';
        break;
      case config.status.CANCELLED:
        statusIcon = '🚫';
        break;
    }

    lines.push(`${i + 1}. ${statusIcon} ${res.fileName || '未命名文件'}`);
    lines.push(`   申请人: ${res.applicant?.name || '未知'}`);
    lines.push(`   打印机: ${res.printer || '未指定'}`);
    lines.push(`   状态: ${res.status}`);
    
    if (res.startTime && res.endTime) {
      lines.push(`   时间: ${res.startTime} ~ ${res.endTime}`);
    }
    
    if (res.printProgress > 0) {
      lines.push(`   打印进度: ${res.printProgress}%`);
    }
    
    if (res.reviewComment) {
      lines.push(`   审查意见: ${res.reviewComment}`);
    }
    
    lines.push('');
  });
  
  return lines.join('\n');
}

async function handlePrintPendingCommand() {
  const reservations = await reservationService.getPendingReviewReservations();
  
  if (reservations.length === 0) {
    return '✅ 暂无待审查的预约';
  }

  const lines = ['⏳ 待审查预约列表', ''];
  
  reservations.forEach((res, i) => {
    lines.push(`${i + 1}. 📋 ${res.fileName || '未命名文件'}`);
    lines.push(`   申请人: ${res.applicant?.name || '未知'}`);
    lines.push(`   打印机: ${res.printer || '未指定'}`);
    lines.push(`   时间: ${res.startTime} ~ ${res.endTime}`);
    lines.push('');
  });
  
  lines.push('💡 提示：请在Bambu Studio中审查切片文件，确认后在多维表格中填写审查结果');
  
  return lines.join('\n');
}

async function handlePrintStartCommand(args) {
  const printerId = parseInt(args[0]);
  const filePath = args.slice(1).join(' ');
  
  if (!printerId || !filePath) {
    return '❌ 参数错误，格式：/print-start <打印机ID> <文件路径>';
  }

  try {
    await printerManager.startPrintOnPrinter(printerId, filePath);
    return `✅ 已向打印机 ${printerId} 发送打印命令：${filePath}`;
  } catch (err) {
    return `❌ 打印失败：${err.message}`;
  }
}

async function handlePrintPauseCommand(args) {
  const printerId = parseInt(args[0]);
  
  if (!printerId) {
    return '❌ 参数错误，格式：/print-pause <打印机ID>';
  }

  try {
    await printerManager.pausePrintOnPrinter(printerId);
    return `✅ 已暂停打印机 ${printerId} 的打印任务`;
  } catch (err) {
    return `❌ 暂停失败：${err.message}`;
  }
}

async function handlePrintResumeCommand(args) {
  const printerId = parseInt(args[0]);
  
  if (!printerId) {
    return '❌ 参数错误，格式：/print-resume <打印机ID>';
  }

  try {
    await printerManager.resumePrintOnPrinter(printerId);
    return `✅ 已恢复打印机 ${printerId} 的打印任务`;
  } catch (err) {
    return `❌ 恢复失败：${err.message}`;
  }
}

async function handlePrintStopCommand(args) {
  const printerId = parseInt(args[0]);
  
  if (!printerId) {
    return '❌ 参数错误，格式：/print-stop <打印机ID>';
  }

  try {
    await printerManager.stopPrintOnPrinter(printerId);
    return `✅ 已停止打印机 ${printerId} 的打印任务`;
  } catch (err) {
    return `❌ 停止失败：${err.message}`;
  }
}

const commandHandlers = {
  '/help': handleHelpCommand,
  '/print-help': handlePrintHelpCommand,
  '/print-status': handlePrintStatusCommand,
  '/print-list': handlePrintListCommand,
  '/print-pending': handlePrintPendingCommand,
  '/print-start': handlePrintStartCommand,
  '/print-pause': handlePrintPauseCommand,
  '/print-resume': handlePrintResumeCommand,
  '/print-stop': handlePrintStopCommand,
};

async function handleNormalChat(senderName) {
  const botName = config.bot.name || '爆米花机';
  return `你好${senderName ? '，' + senderName : ''}！我是🖨️${botName}。

我是3D打印预约助手，你可以通过以下方式与我互动：

• 发送 /print-help 查看打印相关指令
• 发送 /print-status 查看打印机状态
• 发送 /print-list 查看预约列表
• @我 可以触发对话和指令

有什么需要帮忙的吗？`;
}

async function processChatMessage(event) {
  const message = event.message;
  if (!message) return { handled: false, reason: '无消息内容' };

  const chatType = message.chat_type || message.chatMode;
  const isGroup = chatType === 'group';

  console.log('[对话服务] 收到消息 - chat_type:', chatType, 'mentions:', JSON.stringify(message.mentions || []), 'message_id:', message.message_id);

  if (isGroup && !isMentionedBot(message)) {
    console.log('[对话服务] 跳过 - 群聊未@机器人');
    return { handled: false, reason: '群聊未@机器人' };
  }

  if (message.message_id) {
    if (processedMessageIds.has(message.message_id)) {
      console.log('[对话服务] 跳过重复消息:', message.message_id);
      return { handled: true, skipped: true, reason: '重复消息' };
    }
    processedMessageIds.add(message.message_id);
    if (processedMessageIds.size > 500) {
      const firstKey = processedMessageIds.values().next().value;
      processedMessageIds.delete(firstKey);
    }
  }

  const text = extractTextWithoutMention(message);
  console.log('[对话服务] 收到消息:', text, '(chat_id:', message.chat_id, ')');

  const senderId = event.sender?.sender_id?.open_id || event.sender?.sender_id?.user_id || '';
  const senderName = event.sender?.sender_id?.name || '';

  let replyText = '';

  const cmd = parseCommand(text);
  if (cmd) {
    console.log('[对话服务] 解析到指令:', cmd.command, '参数:', cmd.args);
    const handler = commandHandlers[cmd.command];
    if (handler) {
      try {
        replyText = await handler(cmd.args);
      } catch (err) {
        console.error('[对话服务] 指令执行失败:', err);
        replyText = `❌ 指令执行失败：${err.message}`;
      }
    } else {
      replyText = `❌ 未知指令：${cmd.command}\n发送 /help 查看可用指令`;
    }
  } else {
    replyText = await handleNormalChat(senderName);
  }

  if (replyText) {
    try {
      await sendTextMessage(replyText);
      console.log('[对话服务] 已回复消息');
    } catch (err) {
      console.error('[对话服务] 回复消息失败:', err.message);
    }
  }

  return {
    handled: true,
    isCommand: !!cmd,
    command: cmd?.command || null,
    senderId,
    chatId: message.chat_id,
  };
}

module.exports = {
  processChatMessage,
  isMentionedBot,
  parseCommand,
};
