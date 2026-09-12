const { tenantToken } = require('./usage');

// ============================================================
// 多维表格最小客户端（动态广场看板「网关活跃」三表专用）：
// 只需要 search / create / update 三个动作，复用 usage 的 tenant token。
// ============================================================

const BASE = 'https://open.feishu.cn/open-apis';

async function api(method, p, body) {
  const token = await tenantToken();
  if (!token) throw new Error('无可用 tenant token（应用凭证未配置）');
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(`${p} -> ${data.code}: ${data.msg}`);
  return data.data;
}

/** 整表拉取（自动翻页），返回 [{record_id, fields}]——upsert 的内存比对数据源
 *  （records/search 的过滤条件对 Date 字段不可用，实测全部 InvalidFilter，故不做服务端过滤） */
async function listAllRecords(appToken, tableId) {
  const records = [];
  let pageToken = '';
  do {
    const qs = new URLSearchParams({ page_size: '500' });
    if (pageToken) qs.set('page_token', pageToken);
    const data = await api('GET', `/bitable/v1/apps/${appToken}/tables/${tableId}/records?${qs.toString()}`);
    for (const item of data.items || []) records.push({ record_id: item.record_id, fields: item.fields });
    pageToken = data.has_more ? data.page_token || '' : '';
  } while (pageToken);
  return records;
}

async function createRecord(appToken, tableId, fields) {
  const data = await api('POST', `/bitable/v1/apps/${appToken}/tables/${tableId}/records`, { fields });
  return data.record;
}

async function updateRecord(appToken, tableId, recordId, fields) {
  await api('PUT', `/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`, { fields });
}

module.exports = { listAllRecords, createRecord, updateRecord };
