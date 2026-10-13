// ============================================================
// 参数拟合度（2026-10-12 曼波纠正置信度语义）
//
// 录入工坊的置信度条 = 「引擎按人工工况算出的参数」与「专家切片产物
// 内嵌参数」的拟合度——衡量当前规则库对这个 case 的覆盖程度：
//   拟合 100% = 规则库已解释专家切法；
//   拟合低   = 差异项就是「可被记忆的参数」——一键转规则候选进待审池，
//              采纳后规则库即学会这个 case（知识覆盖缺口 → 记忆的通路）。
//
// 比较口径：仅白名单参数键；值归一化后比较（'15%'≡15、'true'≡true、
// 数值 3 位小数截断）。engine 侧缺键 = 引擎没覆盖（记 mismatch，reason 无规则）。
// ============================================================

const processRules = require('./processRules');

function normalize(v) {
  if (v === undefined || v === null) return null;
  if (Array.isArray(v)) return v.join('|');
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  const s = String(v).trim();
  if (/^-?\d+(\.\d+)?%$/.test(s)) return String(parseFloat(s));
  if (/^-?\d+(\.\d+)?$/.test(s)) return String(parseFloat(parseFloat(s).toFixed(3)));
  const lower = s.toLowerCase();
  if (lower === 'true' || lower === 'false') return lower;
  return s;
}

/**
 * 拟合度比较。口径：**只在专家声明的键上评估**——专家没写的键 = 接受默认，
 * 不构成分歧（引擎侧多出的键不算罚分）；专家声明而引擎无规则覆盖 = 记
 * mismatch（reason 无规则覆盖），其专家值即「可被记忆的参数」。
 * @param {Object} engineParams applyRules().params（白名单全集）
 * @param {Object} expertParams slicerExtract().params（专家声明的参数）
 * @returns {{score, total, matches, mismatches, rows}} rows: [{key, engine, expert, match}]
 */
function compare(engineParams, expertParams) {
  const E = engineParams || {}, X = expertParams || {};
  const keys = Object.keys(X);
  const rows = [];
  let matches = 0;
  for (const key of keys) {
    const engine = normalize(E[key]);
    const expert = normalize(X[key]);
    const match = engine !== null && expert !== null && engine === expert;
    if (match) matches++;
    rows.push({
      key,
      engine: E[key] === undefined ? null : E[key],
      expert: X[key] === undefined ? null : X[key],
      match,
    });
  }
  rows.sort((a, b) => (a.match === b.match ? a.key.localeCompare(b.key) : a.match ? 1 : -1)); // 差异排前
  const total = rows.length;
  const mismatches = total - matches;
  return { score: total ? Math.round((matches / total) * 100) : null, total, matches, mismatches, rows };
}

/** 从拟合结果提取「可记忆参数」：专家值 ≠ 引擎值的键 → {when, set} 规则候选 */
function memorizable(fit) {
  const set = {};
  for (const r of fit.rows || []) {
    if (!r.match && r.expert !== null) set[r.key] = r.expert;
  }
  return set;
}

module.exports = { compare, memorizable, normalize };
