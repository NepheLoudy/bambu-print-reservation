// ============================================================
// 规则建议待审池（2026-10-05 学习链路落地）
//
// 「机器学人」的日常回路：复核/使用中发现参数不合适 → 提交修正建议
// （自动携带该单的需求标签组合）→ 待审池；相同「标签组合+参数集」的
// 建议自动聚合计数（高频修正浮到顶部，审核负担不随修正次数增长）。
// 审核闸门（强制）：所有建议不直接生效，reviewer 及以上点头才转正为
// 生效规则（processRules.upsertRule）——脏数据不污染工艺库。
//
// 来源：
//   correction = 使用/审批修正回路
//   extraction = 专家 3mf 作品导入（冷启动）
// ============================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const processRules = require('./processRules');

const FILE = process.env.RULE_SUGGESTIONS_FILE || path.join(__dirname, '..', '..', '.rule-suggestions.json');
const STATUSES = ['pending', 'adopted', 'rejected'];

function load() {
  try {
    if (!fs.existsSync(FILE)) return [];
    const data = JSON.parse(fs.readFileSync(FILE, 'utf-8'));
    return Array.isArray(data.suggestions) ? data.suggestions : [];
  } catch (err) {
    console.warn('[规则建议] 加载失败（按空启动）:', err.message);
    return [];
  }
}

function save(list) {
  const tmp = FILE + '.tmp';
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify({ savedAt: new Date().toISOString(), suggestions: list }, null, 2));
  fs.renameSync(tmp, FILE);
}

/** 聚合键：when + set 规范化（键排序）后 hash——相同建议合并计数 */
function suggestKey(when, set) {
  const norm = (obj) => {
    const out = {};
    for (const k of Object.keys(obj || {}).sort()) out[k] = obj[k];
    return out;
  };
  return crypto.createHash('md5').update(JSON.stringify([norm(when), norm(set)])).digest('hex').slice(0, 12);
}

/** 校验建议体：when 引用池内字段、set 过 processRules.validateRule 同款校验 */
function validateSuggestion({ when, set, reason }) {
  const probe = { id: 'probe', priority: 1, when, set, reason };
  return processRules.validateRule(probe);
}

/**
 * when 归一化：规则库 when 形态 = { field: [值数组] }，而单据 selection 是
 * 标准化形态（single 单值 / bool / multi 数组）——修正建议自动携带 selection，
 * 这里统一转成 when 形态（false/空剔除），两种形态都接受
 */
function normalizeWhen(when) {
  const out = {};
  for (const [fieldId, v] of Object.entries(when || {})) {
    if (v === true) out[fieldId] = [true];
    else if (v === false || v === undefined || v === null || v === '') continue;
    else if (Array.isArray(v)) { if (v.length > 0) out[fieldId] = v; }
    else out[fieldId] = [v];
  }
  return out;
}

const ruleSuggestions = {
  FILE,

  /**
   * 提交建议（pending）；when 接受规则形态或单据 selection 形态（自动归一化）；
   * 相同 when+set 自动聚合 count+1
   * @returns {{merged: boolean, suggestion: Object}}
   */
  add({ when: rawWhen, set, reason, source = 'correction', sourceRef = '', suggestedBy = '' }) {
    const when = normalizeWhen(rawWhen);
    const problems = validateSuggestion({ when, set, reason });
    if (problems.length > 0) {
      const err = new Error(problems.join('；'));
      err.details = problems;
      throw err;
    }
    const key = suggestKey(when, set);
    const list = load();
    const now = new Date().toISOString();

    const existing = list.find((s) => s.key === key && s.status === 'pending');
    if (existing) {
      existing.count += 1;
      existing.lastSeenAt = now;
      existing.lastSuggestedBy = suggestedBy;
      if (sourceRef && !existing.sourceRefs.includes(sourceRef)) existing.sourceRefs.push(sourceRef);
      save(list);
      return { merged: true, suggestion: existing };
    }

    const suggestion = {
      // id 独立生成（2026-10-08 修复）：沿用 sug-<key> 会与已采纳的同 key 建议
      // 撞 id——adopt 的 list.find 永远先命中旧条目报「不可重复处理」，新建议成死单。
      // key 仅作聚合键，不再承担 id 语义
      id: `sug-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`,
      key,
      when,            // 需求标签组合（taxonomy 字段断言）
      set,             // 参数覆盖集（白名单内）
      reason: String(reason || ''),
      source,          // correction | extraction
      sourceRefs: sourceRef ? [sourceRef] : [],
      count: 1,
      status: 'pending',
      suggestedBy,
      createdAt: now,
      lastSeenAt: now,
      decidedAt: null,
      decidedBy: null,
      ruleId: null,
    };
    list.push(suggestion);
    save(list);
    return { merged: false, suggestion };
  },

  list(status) {
    const list = load();
    if (!status) return list;
    return list.filter((s) => s.status === status);
  },

  /** 采纳转正：pending → 生效规则（priority 可指定，默认 120=介于外观(100)与高速(200)之间） */
  adopt(id, decidedBy, priority = 120) {
    const list = load();
    const s = list.find((x) => x.id === id);
    if (!s) throw new Error('建议不存在');
    if (s.status !== 'pending') throw new Error(`建议已是 ${s.status}，不可重复处理`);
    const problems = validateSuggestion(s);
    if (problems.length > 0) throw new Error(`建议校验失败: ${problems.join('；')}`);

    const result = processRules.upsertRule({
      id: `sug-${s.key}`,
      priority: Number(priority) || 120,
      when: s.when,
      set: s.set,
      reason: s.reason,
    });
    if (!result.ok) throw new Error(`转正失败: ${result.errors.join('；')}`);

    s.status = 'adopted';
    s.decidedAt = new Date().toISOString();
    s.decidedBy = decidedBy;
    s.ruleId = result.rule.id;
    save(list);
    return s;
  },

  reject(id, decidedBy) {
    const list = load();
    const s = list.find((x) => x.id === id);
    if (!s) throw new Error('建议不存在');
    if (s.status !== 'pending') throw new Error(`建议已是 ${s.status}，不可重复处理`);
    s.status = 'rejected';
    s.decidedAt = new Date().toISOString();
    s.decidedBy = decidedBy;
    save(list);
    return s;
  },

  /** 已采纳的规则被手改/删除后，同步建议池状态标记（简单起见仅查询用） */
  _loadForTest: load,
};

module.exports = ruleSuggestions;
