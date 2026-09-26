const config = require('../config');
const reservationService = require('./reservation');
const printerManager = require('../printer/manager');
const dispatcher = require('./dispatcher');

// ============================================================
// 指令服务（2026-09-25 对话铁律收口）：本仓不消费消息事件、不直接回复对话，
// 指令统一由 hub 经 POST /api/chat/command 转发进来（executeCommand 出口）。
// 旧版 processChatMessage 直连链（im.message.receive_v1 → 直接回复）已删除。
// ============================================================

const STATUS_ICONS = {
  '空闲': '🟢', '打印中': '🟠', '准备中': '🟠', '切片中': '🟠',
  '暂停': '🟡', '已完成': '✅', '故障': '🔴', '未连接': '⚫',
};

async function handleHelpCommand() {
  const botName = config.bot.name || '爆米花机';
  return `🖨️ ${botName} - 3D打印预约指令帮助

打印预约指令：
  /print-help     显示打印相关帮助
  /print-status   查看打印机状态
  /print-list     查看预约列表
  /print-pending  查看待审批预约

使用方式：
  • 群聊中请先 @${botName} 再发送指令
  • 示例：@${botName} /print-status`;
}

async function handlePrintHelpCommand() {
  return `🖨️ 3D打印预约系统 - 指令帮助

📋 查询指令：
  /print-status    查看打印机状态（含 AMS 耗材与打印队列）
  /print-ams       查看所有打印机装载的耗材明细
  /print-list      查看当前所有预约记录
  /print-pending   查看待审批的预约（需审批者处理）

⚙️ 管理指令：
  /print-dispatch <申请编号> <打印机名>  手动指定打印机分发

📝 预约流程（在飞书审批多维表格中操作）：
  • 填写发起人、切片文件(3mf)、材料类型、颜色、是否加急
  • 审批者审查切片文件后填写审批结果
  • 审批通过秒级入队，按打印机 AMS 装料自动匹配并开始打印

示例：
  @爆米花机-对话型 /print-status
  @爆米花机-对话型 /print-dispatch 20260903001 X1C-01`;
}

async function handlePrintStatusCommand() {
  const printers = printerManager.getAllPrinterStates();

  if (printers.length === 0) {
    return '🖨️ 暂无配置的打印机';
  }

  const queue = dispatcher.getQueueSnapshot();
  const lines = ['🖨️ 打印机状态', ''];

  printers.forEach((printer, i) => {
    lines.push(`${i + 1}. ${STATUS_ICONS[printer.status] || '🔵'} ${printer.name} (${printer.model})`);
    if (printer.activeTask) {
      lines.push(`   当前任务: ${printer.activeTask.applicationNo || ''} ${printer.activeTask.fileName || ''}`);
    } else if (printer.currentJob) {
      lines.push(`   当前文件: ${printer.currentJob}`);
    }
    if (printer.status === '打印中' || printer.status === '暂停') {
      // remainingMinutes 本身就是分钟（mc_remaining_time），直接展示
      const remain = printer.remainingMinutes ? `，剩余 ${printer.remainingMinutes} 分钟` : '';
      lines.push(`   进度: ${printer.progress}%${remain}`);
    }
    const ams = (printer.ams || []).filter((t) => t.type);
    if (ams.length > 0) {
      lines.push(`   耗材: ${ams.map((t) => `${t.type}${t.colorHex ? '·' + t.colorHex : ''}${t.active ? '◉' : ''}`).join('、')}`);
    } else if (printer.autoDispatch) {
      lines.push('   耗材: （未获取到 AMS 数据）');
    }
    if (!printer.autoDispatch) {
      lines.push('   ⚙️ 非 Bambu 机型：仅登记，分发需人工（/print-dispatch 指定后手动上传）');
    }
    lines.push('');
  });

  if (queue.length > 0) {
    lines.push(`📋 打印队列（${queue.length} 单待分发）:`);
    queue.slice(0, 5).forEach((t) => {
      lines.push(`  ${t.position}. ${t.applicationNo || ''} ${t.fileName || ''} [${t.materialType || '任意'}×${t.color || '任意'}]${t.isUrgent ? ' ⚡' : ''}（${t.applicant}）`);
    });
    if (queue.length > 5) lines.push(`  …共 ${queue.length} 单`);
  }

  return lines.join('\n');
}

async function handlePrintAmsCommand() {
  const printers = printerManager.getAllPrinterStates();
  const lines = ['🧵 打印机耗材总览', ''];

  let any = false;
  for (const printer of printers) {
    const ams = (printer.ams || []).filter((t) => t.type);
    if (!ams.length) continue;
    any = true;
    lines.push(`▸ ${printer.name}（${printer.model}）`);
    ams.forEach((t) => {
      lines.push(`   ${t.slot}: ${t.type} ${t.colorHex || ''}${t.active ? ' ◉在用' : ''}`);
    });
    lines.push('');
  }
  if (!any) lines.push('（暂无 AMS 数据，打印机可能未连接）');

  return lines.join('\n');
}

async function handlePrintDispatchCommand(args) {
  const [target, printerName] = args;
  if (!target || !printerName) {
    const names = printerManager.getAllPrinterStates().map((p) => p.name).join('、');
    return `用法: /print-dispatch <申请编号或记录ID> <打印机名>\n可用打印机: ${names || '（无）'}`;
  }

  try {
    const result = await dispatcher.manualDispatch(target, printerName);
    return result.manualOnly
      ? `📝 ${result.message}`
      : `✅ ${result.message}`;
  } catch (err) {
    return `❌ ${err.message}`;
  }
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
    lines.push(`   发起人: ${res.applicant?.name || '未知'}`);
    lines.push(`   状态: ${res.status}`);
    
    if (res.applicationNo) {
      lines.push(`   申请编号: ${res.applicationNo}`);
    }
    
    if (res.startTime) {
      lines.push(`   发起时间: ${res.startTime}`);
    }
    
    if (res.isUrgent) {
      lines.push(`   ⚡ 加急`);
    }
    
    if (res.isInternalProject) {
      lines.push(`   📌 千里内部项目`);
    }
    
    lines.push('');
  });
  
  return lines.join('\n');
}

async function handlePrintPendingCommand() {
  const reservations = await reservationService.getPendingReviewReservations();
  
  if (reservations.length === 0) {
    return '✅ 暂无待审批的预约';
  }

  const lines = ['⏳ 待审批预约列表', ''];
  
  reservations.forEach((res, i) => {
    lines.push(`${i + 1}. 📋 ${res.fileName || '未命名文件'}`);
    lines.push(`   发起人: ${res.applicant?.name || '未知'}`);
    if (res.applicationNo) {
      lines.push(`   申请编号: ${res.applicationNo}`);
    }
    if (res.startTime) {
      lines.push(`   发起时间: ${res.startTime}`);
    }
    if (res.isUrgent) {
      lines.push(`   ⚡ 加急`);
    }
    lines.push('');
  });
  
  lines.push('💡 提示：请在Bambu Studio中审查切片文件，确认后在多维表格中填写审批结果');
  
  return lines.join('\n');
}

const commandHandlers = {
  '/help': handleHelpCommand,
  '/print-help': handlePrintHelpCommand,
  '/print-status': handlePrintStatusCommand,
  '/print-ams': handlePrintAmsCommand,
  '/print-list': handlePrintListCommand,
  '/print-pending': handlePrintPendingCommand,
  '/print-dispatch': handlePrintDispatchCommand,
};

/**
 * 统一指令执行入口（hub 经网关 /api/chat/command 转发的唯一对话出口）
 * @returns {Promise<string>} 回复文本
 */
async function executeCommand(command, args) {
  const handler = commandHandlers[command];
  if (!handler) {
    return `❌ 未知指令：${command}\n发送 /print-help 查看可用指令`;
  }
  return handler(args || []);
}

module.exports = {
  executeCommand,
  handlePrintHelpCommand,
  handlePrintStatusCommand,
  handlePrintAmsCommand,
  handlePrintListCommand,
  handlePrintPendingCommand,
  handlePrintDispatchCommand,
};
