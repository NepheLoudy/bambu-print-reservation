// ============================================================
// 云文档留档编排
//
// 留档双层（缺一层的兜底关系）：
// 1. 本地 archive/ 目录：每周报落 考勤周报_<weekKey>.json（全量记录+聚合）与
//    .csv（日明细）——发送/云文档通道全挂也有底档（exports/ 的 CSV 是播报附件口径，
//    本目录是「本次所有记录」留档口径）；
// 2. 飞书云文档（docx API，应用身份）：把周报（汇总+全部打卡记录）追加到
//    ARCHIVE_DOC_TOKEN 指向的文档末尾，每周一节。
//
// ARCHIVE_DOC_TOKEN 兼容两种形态（2026-10-07 曼波给的是 wiki 节点链接）：
//   - wiki 节点 token（URL /wiki/ 后段）：先经 wiki get_node API 换算出真实
//     obj_type/obj_token（应用需 wiki:wiki:readonly 权限），解析结果缓存；
//   - docx document token（URL /docx/ 后段）：直接用。
// ============================================================
const fs = require('fs');
const path = require('path');
const config = require('./config');
const feishu = require('./feishu');
const report = require('./report');

let wikiResolveCache = { token: '', objToken: '', objType: '', resolvedAt: 0 };

// wiki 节点 token → 真实 docx token；非 wiki token（get_node 报节点不存在）原样返回按 docx 处理
async function resolveDocToken(token) {
  if (wikiResolveCache.token === token && wikiResolveCache.objToken) return wikiResolveCache;
  try {
    const t = await feishu.getTenantToken();
    const res = await fetch(`https://open.feishu.cn/open-apis/wiki/v2/spaces/get_node?token=${encodeURIComponent(token)}`, {
      signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${t}` },
    });
    const j = await res.json();
    if (j.code === 0 && j.data && j.data.node && j.data.node.obj_token) {
      wikiResolveCache = {
        token,
        objToken: j.data.node.obj_token,
        objType: j.data.node.obj_type || '',
        resolvedAt: Date.now(),
      };
      return wikiResolveCache;
    }
    // 节点不存在/无 wiki 权限：当 docx token 原样尝试（错误在写入时带出，提示更准确）
    console.warn(`[留档] wiki 节点解析未命中（code=${j.code} ${j.msg || ''}），按 docx token 直接使用`);
  } catch (e) {
    console.warn(`[留档] wiki 节点解析异常（${e.message}），按 docx token 直接使用`);
  }
  return { token, objToken: token, objType: 'docx', resolvedAt: Date.now() };
}

// 本地留档（JSON 全量 + CSV 日明细）；失败仅 warn 不阻塞播报
function archiveLocal(win, agg, records, extra = {}) {
  const result = { files: [], error: null };
  try {
    fs.mkdirSync(config.archiveDir, { recursive: true });
    const base = path.join(config.archiveDir, `考勤周报_${win.key}`);
    const jsonPath = `${base}.json`;
    fs.writeFileSync(jsonPath, JSON.stringify({
      window: { key: win.key, label: win.label, start: win.start, end: win.end },
      dataSource: extra.dataSource || config.dataSource,
      generatedAt: new Date().toISOString(),
      totals: agg.totals,
      users: agg.users,
      records,
    }, null, 2) + '\n');
    const csvPath = `${base}.csv`;
    fs.writeFileSync(csvPath, report.renderCsv(win, agg));
    result.files = [jsonPath, csvPath];
  } catch (e) {
    result.error = e.message;
    console.warn('[留档] 本地留档失败（不影响播报）:', e.message);
  }
  return result;
}

// 云文档块序列：heading2 周标题节 + 口径/汇总 + 每人一行 + 全部打卡记录逐条
function buildDocBlocks(win, agg, records, extra = {}) {
  const blocks = [
    feishu.headingBlock(2, `⏱ 打卡时长周报（${win.label}）`),
    feishu.textBlock(`生成时间：${new Date().toISOString().slice(0, 19).replace('T', ' ')} · 数据源：${extra.dataSource || config.dataSource}（ZKLink 云考勤${extra.groupLabel ? ` · 考勤组：${extra.groupLabel}` : ''}）`),
    feishu.textBlock(`口径：按人按上海挂钟日聚合，单日 ≥2 条打卡记「末卡 − 首卡」为当日时长，恰 1 条记 0（孤条），周合计。`),
    feishu.textBlock(`合计：打卡 ${agg.totals.punches} 条 · 总时长 ${report.fmtDuration(agg.totals.totalMs)} · 涉及 ${agg.totals.users} 人（有打卡 ${agg.totals.punchUsers} 人） · 孤条 ${agg.totals.lonelyDays} 天`),
    feishu.headingBlock(3, '本周汇总'),
  ];
  for (const u of agg.users) {
    const lonely = u.lonelyDays ? ` · 孤条 ${u.lonelyDays} 天` : '';
    blocks.push(feishu.textBlock(`• ${u.name}（${u.userid}）：${u.punchDays} 天 · ${report.fmtDuration(u.totalMs)}${lonely}`));
  }
  blocks.push(feishu.headingBlock(3, `打卡明细（全部 ${records.length} 条记录）`));
  for (const r of records) {
    const name = (agg.userNames && agg.userNames.get(r.userid)) || r._name || r.userid;
    const meta = [r.checkin_type, r.exception_type && `异常:${r.exception_type}`, r.groupname].filter(Boolean).join(' · ');
    blocks.push(feishu.textBlock(`• ${report.fmtTime(r.checkin_time * 1000)} ${name}（${r.userid}）${meta ? ` — ${meta}` : ''}`));
  }
  if (!records.length) blocks.push(feishu.textBlock('• （本窗口无打卡记录）'));
  return blocks;
}

// 追加到云文档末尾（自动解析 wiki 节点）；返回追加块数
async function archiveToDoc(win, agg, records, extra = {}) {
  const resolved = await resolveDocToken(config.archiveDocToken);
  const blocks = buildDocBlocks(win, agg, records, extra);
  const appended = await feishu.appendDocBlocks(resolved.objToken, blocks);
  return { appended, objToken: resolved.objToken, objType: resolved.objType };
}

module.exports = { archiveLocal, buildDocBlocks, archiveToDoc, resolveDocToken };
