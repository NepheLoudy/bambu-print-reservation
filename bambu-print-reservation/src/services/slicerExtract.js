// ============================================================
// 3mf 切片参数提取器（2026-10-05 学习链路冷启动）
//
// 「机器学人」的起点：专家手工切好的 3mf 就是标注数据——提取其中
// 与本仓参数白名单可映射的核心参数，与 baseline 做 diff 生成候选规则
// 草稿（必须经待审池人工确认后转正，本模块不做任何自动生效）。
//
// 3mf = zip。提取优先级：
//   ① Metadata/project_settings.config（JSON，Bambu Studio 工程导出）
//   ② Metadata/plate_*.gcode 头部「; key = value」注释键值（切片产物）
// ⚠️ 字段名按 Bambu Studio 常见导出编写；真实文件若对不上，以 raw 键值
//    兜底展示人工核对——映射表首次真机使用时校准。
// ============================================================

const AdmZip = require('adm-zip');
const processRules = require('./processRules');

// Bambu Studio 参数名 → 本仓 PARAM_NAMES 映射
const BAMBU_PARAM_MAP = {
  layer_height: { param: 'layerHeight', num: true },
  initial_layer_print_height: null, // 忽略
  wall_loops: { param: 'wallLoops', num: true },
  sparse_infill_density: { param: 'infillDensity', pct: true },
  sparse_infill_pattern: {
    param: 'infillPattern',
    enum: { grid: 'grid', gyroid: 'gyroid', cubic: 'cubic', line: 'lines', lines: 'lines', zigzag: 'grid', honeycomb: 'grid' },
  },
  seam_position: {
    param: 'seamPosition',
    enum: { aligned: 'aligned', nearest: 'nearest', back: 'hidden', rear: 'hidden' },
  },
  xy_hole_compensation: { param: 'xyHoleComp', num: true },
  xy_contour_compensation: { param: 'xyContourComp', num: true },
  enable_support: { param: 'supportType', enum: { '1': 'auto', 'true': 'auto', '0': 'none', 'false': 'none' } },
  ironing_type: { param: 'ironing', enum: { none: 'false' } }, // 其余任何非 none 值 → true
  brim_type: { param: 'brim', enum: { none: 'false', no_brim: 'false' } }, // 其余非空值 → true
};

/** 单值清洗：'40%' → 40、'0.16' → 0.16、布尔语义 */
function coerce(raw, def) {
  let v = String(raw).trim().toLowerCase();
  if (def.pct) v = v.replace(/%$/, '');
  if (def.num || def.pct) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (def.enum) {
    if (v in def.enum) return def.enum[v];
    if (def.param === 'ironing' || def.param === 'brim') return 'true'; // 非 none 值
    return null;
  }
  return null;
}

/** 从解包后的文件内容提取键值对（JSON 优先，gcode 头部注释兜底） */
function extractRawParams(files) {
  const raw = {};
  let source = 'none';

  // ① project_settings.config（JSON）
  const ps = files.find((f) => /metadata\/project_settings\.config$/i.test(f.entryName));
  if (ps) {
    try {
      const obj = JSON.parse(ps.getData().toString('utf8'));
      for (const [k, v] of Object.entries(obj)) raw[k] = String(v);
      source = 'project_settings';
    } catch { /* 损坏则走 gcode 兜底 */ }
  }

  // ② plate_*.gcode 头部注释键值（读前 96KB 足够覆盖头部参数块）
  if (source === 'none') {
    const gcode = files.find((f) => /metadata\/plate_\d+.*\.gcode$/i.test(f.entryName));
    if (gcode) {
      const head = gcode.getData().subarray(0, 96 * 1024).toString('utf8');
      for (const m of head.matchAll(/^;\s*([a-z_][a-z0-9_]*)\s*=\s*(\S+)\s*$/gim)) {
        if (!(m[1] in raw)) raw[m[1]] = m[2];
      }
      source = 'gcode';
    }
  }
  return { raw, source };
}

/**
 * 提取 3mf（Buffer）→ 可映射参数 + 与 baseline 的 diff（候选规则 set 草稿）
 * @returns {{ source, params: Object, raw: Object, diff: Object }}
 */
function extractFrom3mf(buffer) {
  const zip = new AdmZip(buffer);
  const files = zip.getEntries();
  const { raw, source } = extractRawParams(files);

  const params = {};
  for (const [bambuKey, def] of Object.entries(BAMBU_PARAM_MAP)) {
    if (!def || !(bambuKey in raw)) continue;
    const v = coerce(raw[bambuKey], def);
    if (v !== null && v !== undefined && v !== '') params[def.param] = v;
  }
  // 白名单过滤（防御映射表过期引入未知参数）
  for (const k of Object.keys(params)) {
    if (!processRules.PARAM_NAMES.includes(k)) delete params[k];
  }

  // 与 baseline 的 diff：值不同的参数构成候选 set
  const diff = {};
  for (const [k, v] of Object.entries(params)) {
    if (JSON.stringify(processRules.BASELINE[k]) !== JSON.stringify(v)) diff[k] = v;
  }

  return { source, params, raw, diff };
}

module.exports = { extractFrom3mf, BAMBU_PARAM_MAP };
