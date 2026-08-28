const config = require('../config');
const { requestAPI } = require('./client');

async function sendMessage(cardContent) {
  const webhookUrl = config.bot.webhookUrl;

  if (!webhookUrl) {
    console.warn('未配置机器人 Webhook URL，跳过消息发送');
    return null;
  }

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      msg_type: 'interactive',
      card: cardContent,
    }),
  });

  const data = await res.json();

  if (data.code !== 0 && data.StatusCode !== 0) {
    throw new Error(`发送消息失败: ${JSON.stringify(data)}`);
  }

  return data;
}

async function sendTextMessage(text) {
  const webhookUrl = config.bot.webhookUrl;

  if (!webhookUrl) {
    console.warn('未配置机器人 Webhook URL，跳过消息发送');
    return null;
  }

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      msg_type: 'text',
      content: {
        text: text,
      },
    }),
  });

  const data = await res.json();

  if (data.code !== 0 && data.StatusCode !== 0) {
    throw new Error(`发送消息失败: ${JSON.stringify(data)}`);
  }

  return data;
}

function buildAtTag(userId) {
  if (!userId) return '';
  return `<at id="${userId}"></at>`;
}

function buildReservationAlertCard(reservation) {
  const applicantName = reservation.fields['发起人']?.[0]?.name || '未知用户';
  const applicantId = reservation.fields['发起人']?.[0]?.id || '';
  const startTime = reservation.fields['发起时间'];
  const sliceFile = reservation.fields['切片文件'] && reservation.fields['切片文件'].length > 0 ? reservation.fields['切片文件'][0] : null;
  const fileName = sliceFile?.name || '未指定';
  const isUrgent = reservation.fields['是否加急'];

  return {
    config: {
      wide_screen_mode: true,
      enable_forward: true,
    },
    elements: [
      {
        tag: 'markdown',
        content: `**📋 新的打印预约**`,
      },
      { tag: 'hr' },
      {
        tag: 'markdown',
        content: `${buildAtTag(applicantId)} **发起人**: ${applicantName}`,
      },
      {
        tag: 'markdown',
        content: `**文件**: ${fileName}`,
      },
      {
        tag: 'markdown',
        content: `**发起时间**: ${startTime || '未指定'}`,
      },
      isUrgent ? {
        tag: 'markdown',
        content: `**⚡ 加急**: 是`,
      } : null,
      { tag: 'hr' },
      {
        tag: 'markdown',
        content: `**审批者**: 请在 Bambu Studio 中审查切片文件，确认后在多维表格中填写审批结果`,
      },
    ].filter(Boolean),
    header: {
      template: 'blue',
      title: {
        content: '🖨️ 打印预约通知',
        tag: 'plain_text',
      },
    },
  };
}

function buildReviewResultCard(reservation, result, comment) {
  const applicantName = reservation.fields['发起人']?.[0]?.name || '未知用户';
  const applicantId = reservation.fields['发起人']?.[0]?.id || '';
  const sliceFile = reservation.fields['切片文件'] && reservation.fields['切片文件'].length > 0 ? reservation.fields['切片文件'][0] : null;
  const fileName = sliceFile?.name || '未指定';

  const isApproved = result === config.reviewResult.APPROVED;

  return {
    config: {
      wide_screen_mode: true,
      enable_forward: true,
    },
    elements: [
      {
        tag: 'markdown',
        content: isApproved ? `**✅ 审批通过**` : `**❌ 审批驳回**`,
      },
      { tag: 'hr' },
      {
        tag: 'markdown',
        content: `${buildAtTag(applicantId)} **发起人**: ${applicantName}`,
      },
      {
        tag: 'markdown',
        content: `**文件**: ${fileName}`,
      },
      {
        tag: 'markdown',
        content: `**审批意见**: ${comment || '无'}`,
      },
      { tag: 'hr' },
      {
        tag: 'markdown',
        content: isApproved
          ? '📝 系统将自动上传文件并排队打印，请等待打印机就绪'
          : '📝 请修改切片文件后重新提交预约',
      },
    ],
    header: {
      template: isApproved ? 'green' : 'red',
      title: {
        content: '🖨️ 审批结果通知',
        tag: 'plain_text',
      },
    },
  };
}

function buildPrintStatusCard(printerName, status, progress, currentFile) {
  let statusColor = 'gray';
  let statusIcon = '🔵';
  
  if (status === config.printerStatus.IDLE) {
    statusColor = 'green';
    statusIcon = '🟢';
  } else if (status === config.printerStatus.PRINTING) {
    statusColor = 'orange';
    statusIcon = '🟠';
  } else if (status === config.printerStatus.FAULT) {
    statusColor = 'red';
    statusIcon = '🔴';
  }

  return {
    config: {
      wide_screen_mode: true,
      enable_forward: true,
    },
    elements: [
      {
        tag: 'markdown',
        content: `**${statusIcon} ${printerName} 状态更新**`,
      },
      { tag: 'hr' },
      {
        tag: 'markdown',
        content: `**状态**: ${status}`,
      },
      {
        tag: 'markdown',
        content: `**当前任务**: ${currentFile || '无'}`,
      },
      {
        tag: 'markdown',
        content: `**进度**: ${progress !== null && progress !== undefined ? `${progress}%` : '未知'}`,
      },
    ],
    header: {
      template: statusColor,
      title: {
        content: '🖨️ 打印机状态',
        tag: 'plain_text',
      },
    },
  };
}

async function sendTextToChat(chatId, text) {
  const res = await requestAPI(
    'POST',
    '/im/v1/messages?receive_id_type=chat_id',
    {
      receive_id: chatId,
      msg_type: 'text',
      content: JSON.stringify({ text }),
    }
  );

  if (res.code !== 0) {
    throw new Error(`发送群消息失败: ${res.msg} (code: ${res.code})`);
  }

  return res.data;
}

async function sendTextToUser(openId, text) {
  const res = await requestAPI(
    'POST',
    '/im/v1/messages?receive_id_type=open_id',
    {
      receive_id: openId,
      msg_type: 'text',
      content: JSON.stringify({ text }),
    }
  );

  if (res.code !== 0) {
    throw new Error(`发送私聊消息失败: ${res.msg} (code: ${res.code})`);
  }

  return res.data;
}

async function sendCardToChat(chatId, cardContent) {
  const res = await requestAPI(
    'POST',
    '/im/v1/messages?receive_id_type=chat_id',
    {
      receive_id: chatId,
      msg_type: 'interactive',
      content: JSON.stringify(cardContent),
    }
  );

  if (res.code !== 0) {
    throw new Error(`发送群卡片消息失败: ${res.msg} (code: ${res.code})`);
  }

  return res.data;
}

module.exports = {
  sendMessage,
  sendTextMessage,
  buildReservationAlertCard,
  buildReviewResultCard,
  buildPrintStatusCard,
  sendTextToChat,
  sendTextToUser,
  sendCardToChat,
};
