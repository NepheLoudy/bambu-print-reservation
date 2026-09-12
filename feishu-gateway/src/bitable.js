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

/** 按条件查记录（conditions: [{field_name, value}]，operator=is），返回 [{record_id, fields}] */
async function searchRecords(appToken, tableId, conditions) {
  const data = await api('POST', `/bitable/v1/apps/${appToken}/tables/${tableId}/records/search?page_size=500`, {
    filter: { conjunction: 'and', conditions: conditions.map((c) => ({ field_name: c.field_name, operator: 'is', value: [String(c.value)] })) },
  });
  return data.items || [];
}

async function createRecord(appToken, tableId, fields) {
  const data = await api('POST', `/bitable/v1/apps/${appToken}/tables/${tableId}/records`, { fields });
  return data.record;
}

async function updateRecord(appToken, tableId, recordId, fields) {
  await api('PUT', `/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`, { fields });
}

module.exports = { searchRecords, createRecord, updateRecord };
