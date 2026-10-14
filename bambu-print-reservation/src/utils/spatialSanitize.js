'use strict';

/**
 * spatial 标注字段净化（客户端数据不信任）——唯一权威实现，两端共用（v56 起：
 * 此前内联在训练样本端点，预约提交接入 3D 标注后抽到这里，保证「同一链路」同构）。
 *
 * 白名单形态：point（点）/ axis（两面交线受弯轴线）/ survey（悬垂面普查）/
 * circle（识别孔口环）/ region（面区域染色的面索引集）/ load（载荷标注：力方向 +
 * 受力类型）。只收白名单字段；faces 封顶 20 万；单条标注封顶 200 条。
 */
function cleanP3(arr) {
  return Array.isArray(arr)
    ? arr.slice(0, 3).map((n) => { const v = Number(n); return Number.isFinite(v) ? +v.toFixed(2) : 0; })
    : null;
}

const LOAD_TYPES = ['compression', 'tension', 'shear', 'bending', 'torsion', 'contact'];

function sanitizeSpatial(raw) {
  let spatial = raw;
  return (Array.isArray(spatial) ? spatial : []).slice(0, 200).map((s) => {
    if (!s || !String(s.tool || '').slice(0, 40)) return null;
    const base = { tool: String(s.tool).slice(0, 40) };
    if (s.type === 'load') {
      const pos = cleanP3(s.pos), dir = cleanP3(s.dir);
      const NATURES = ['static', 'fatigue', 'impact', 'vibration'];
      const MAGS = ['light', 'medium', 'heavy'];
      const natureOk = !s.loadNature || NATURES.includes(s.loadNature);
      const magOk = !s.loadMagnitude || MAGS.includes(s.loadMagnitude);
      return pos && dir && LOAD_TYPES.includes(s.loadType) && natureOk && magOk
        ? { ...base, type: 'load', loadType: s.loadType, pos, dir, ...(natureOk && s.loadNature ? { loadNature: s.loadNature } : {}), ...(magOk && s.loadMagnitude ? { loadMagnitude: s.loadMagnitude } : {}) } : null;
    }
    if (s.type === 'axis') {
      const a = cleanP3(s.a), b = cleanP3(s.b), dir = cleanP3(s.dir);
      const note = s.note ? String(s.note).slice(0, 200) : undefined;
      return a && b && dir ? { ...base, type: 'axis', a, b, dir, ...(note ? { note } : {}) } : null;
    }
    if (s.type === 'survey' || s.type === 'region') {
      const faces = Array.isArray(s.faces) ? s.faces.slice(0, 200000).map((n) => Number(n) | 0).filter((n) => n >= 0) : [];
      const supportFaces = Array.isArray(s.supportFaces) ? s.supportFaces.slice(0, 200000).map((n) => Number(n) | 0).filter((n) => n >= 0) : undefined;
      const normal = cleanP3(s.normal) || [0, 0, 0];
      return faces.length > 0 ? { ...base, type: s.type, faces, ...(supportFaces && supportFaces.length ? { supportFaces } : {}), normal, ...(s.seed !== undefined ? { seed: Number(s.seed) || 0 } : {}) } : null;
    }
    if (s.type === 'circle') {
      const c = cleanP3(s.c), n = cleanP3(s.n);
      const r = Number(s.r);
      return c && n && Number.isFinite(r) && r > 0 ? { ...base, type: 'circle', c, n, r: +r.toFixed(2), ...(s.note ? { note: String(s.note).slice(0, 200) } : {}) } : null;
    }
    const pos = cleanP3(s.pos);
    return pos ? { ...base, type: 'point', pos, face: Number(s.face) || 0, ...(s.note ? { note: String(s.note).slice(0, 200) } : {}) } : null;
  }).filter(Boolean);
}

module.exports = { sanitizeSpatial };
