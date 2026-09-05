const lark = require('@larksuiteoapi/node-sdk');
const config = require('../config');

let client = null;
let tenantAccessToken = '';
let tokenExpireTime = 0;

function getClient() {
  if (!client) {
    client = new lark.Client({
      appId: config.feishu.appId,
      appSecret: config.feishu.appSecret,
      appType: lark.AppType.SelfBuild,
      domain: lark.Domain.FeiShu,
    });
  }
  return client;
}

async function getTenantAccessToken() {
  const now = Date.now();
  if (tenantAccessToken && now < tokenExpireTime - 60000) {
    return tenantAccessToken;
  }

  const client = getClient();
  const res = await client.auth.tenantAccessToken.internal({
    data: {
      app_id: config.feishu.appId,
      app_secret: config.feishu.appSecret,
    },
  });

  if (res.code !== 0) {
    throw new Error(`获取 tenant_access_token 失败: ${res.msg}`);
  }

  tenantAccessToken = res.tenant_access_token;
  tokenExpireTime = now + res.expire * 1000;
  return tenantAccessToken;
}

async function requestAPI(method, path, params = {}) {
  const token = await getTenantAccessToken();
  const url = `https://open.feishu.cn/open-apis${path}`;

  const options = {
    method,
    // 无超时的 fetch 一旦挂起会把分发引擎的串行匹配段永久卡死
    signal: AbortSignal.timeout(20000),
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
  };

  if (method === 'GET') {
    const query = new URLSearchParams(params).toString();
    const fullUrl = query ? `${url}?${query}` : url;
    const res = await fetch(fullUrl, options);
    return res.json();
  } else {
    const res = await fetch(url, {
      ...options,
      body: JSON.stringify(params),
    });
    return res.json();
  }
}

async function downloadFile(fileToken) {
  const token = await getTenantAccessToken();
  const url = `https://open.feishu.cn/open-apis/drive/v1/medias/${fileToken}/download`;

  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
    },
    // 3mf 切片文件可能几十 MB，给长一些但有限的超时
    signal: AbortSignal.timeout(120000),
  });

  if (!res.ok) {
    throw new Error(`下载文件失败: ${res.status} ${res.statusText}`);
  }

  return res.arrayBuffer();
}

/**
 * 下载官方审批表单里的附件（attachment_id 与 drive file_token 不同，走审批专用端点）
 */
async function downloadApprovalAttachment(attachmentId, name) {
  const token = await getTenantAccessToken();
  const query = new URLSearchParams({ name: name || 'attachment', user_id_type: 'open_id' });
  const url = `https://open.feishu.cn/open-apis/approval/v4/attachments/${attachmentId}?${query}`;

  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` },
    signal: AbortSignal.timeout(120000),
  });

  if (!res.ok) {
    throw new Error(`下载审批附件失败: ${res.status} ${res.statusText}`);
  }

  return res.arrayBuffer();
}

/**
 * 同意审批任务（以 user_id（该任务的审批人）身份执行）
 */
async function approveTask({ approvalCode, instanceCode, taskId, userId, comment }) {
  return requestAPI('POST', '/approval/v4/tasks/approve?user_id_type=open_id', {
    approval_code: approvalCode,
    instance_code: instanceCode,
    task_id: taskId,
    user_id: userId,
    comment: comment || '',
  });
}

/**
 * 拒绝审批任务
 */
async function rejectTask({ approvalCode, instanceCode, taskId, userId, comment }) {
  return requestAPI('POST', '/approval/v4/tasks/reject?user_id_type=open_id', {
    approval_code: approvalCode,
    instance_code: instanceCode,
    task_id: taskId,
    user_id: userId,
    comment: comment || '',
  });
}

module.exports = {
  getClient,
  getTenantAccessToken,
  requestAPI,
  downloadFile,
  downloadApprovalAttachment,
  approveTask,
  rejectTask,
};
