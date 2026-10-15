/**
 * STL 几何体检单测（纯逻辑，合成网格断言；2026-10-11 模型特征自拟合批）
 * 用法：node test/model-features-test.js
 */
const assert = require('assert');
const AdmZip = require('adm-zip');
const { analyzeStl, analyze3mf, suggestFromFeatures, fitCircle2d, parseStl, MAX_TRIANGLES, THRESHOLDS } = require('../src/services/modelFeatures');

let failures = 0;
let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`✓ ${name}`);
  } catch (err) {
    failures++;
    console.error(`✗ ${name} — ${err.message}`);
  }
}
const approx = (actual, expected, tol, label) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${label}: 实际 ${actual}，期望 ${expected}±${tol}`);

// ---------- 合成网格工具 ----------

/** 长方体 12 三角（外向一致绕向） */
function boxTris(x0, y0, z0, x1, y1, z1) {
  const p = (x, y, z) => [x, y, z];
  const quads = [
    // [A, B, C] 三角组：每面两张，绕向外
    [p(x0, y0, z1), p(x1, y0, z1), p(x1, y1, z1), p(x0, y1, z1)], // +z
    [p(x0, y0, z0), p(x0, y1, z0), p(x1, y1, z0), p(x1, y0, z0)], // -z
    [p(x1, y0, z0), p(x1, y1, z0), p(x1, y1, z1), p(x1, y0, z1)], // +x
    [p(x0, y0, z0), p(x0, y0, z1), p(x0, y1, z1), p(x0, y1, z0)], // -x
    [p(x0, y1, z0), p(x0, y1, z1), p(x1, y1, z1), p(x1, y1, z0)], // +y
    [p(x0, y0, z0), p(x1, y0, z0), p(x1, y0, z1), p(x0, y0, z1)], // -y
  ];
  const tris = [];
  for (const [a, b, c, d] of quads) { tris.push([a, b, c], [a, c, d]); }
  return tris;
}

/** 环形管（垫圈/套筒）：外径 R 内径 r 高 h，n 边逼近——流形闭合，亏格 1 */
function washerTris(R, r, h, n) {
  const tris = [];
  const pt = (rad, i, z) => [rad * Math.cos((2 * Math.PI * i) / n), rad * Math.sin((2 * Math.PI * i) / n), z];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ob = pt(R, i, 0), ob2 = pt(R, j, 0), ot = pt(R, i, h), ot2 = pt(R, j, h);
    const ib = pt(r, i, 0), ib2 = pt(r, j, 0), it = pt(r, i, h), it2 = pt(r, j, h);
    tris.push([ob, ob2, ot2], [ob, ot2, ot]);              // 外壁朝外
    tris.push([ib, it, it2], [ib, it2, ib2]);              // 内壁朝轴（材料外侧）
    tris.push([ot, ot2, it2], [ot, it2, it]);              // 顶环面朝上
    tris.push([ob, ib2, ob2], [ob, ib, ib2]);              // 底环面朝下（贴底接触）
  }
  return tris;
}

function stlBinary(tris) {
  const buf = Buffer.alloc(84 + tris.length * 50);
  buf.writeUInt32LE(tris.length, 80);
  tris.forEach((t, i) => {
    const off = 84 + i * 50 + 12; // 法线置 0（解析器重算）
    t.flat().forEach((v, k) => buf.writeFloatLE(v, off + k * 4));
  });
  return buf;
}

function stlAscii(tris) {
  const lines = ['solid test'];
  for (const t of tris) {
    lines.push('  facet normal 0 0 0', '    outer loop');
    for (const v of t) lines.push(`      vertex ${v[0]} ${v[1]} ${v[2]}`);
    lines.push('    endloop', '  endfacet');
  }
  lines.push('endsolid test');
  return Buffer.from(lines.join('\n'), 'latin1');
}

// ---------- 圆拟合 ----------

check('Kåsa 圆拟合：标准圆恢复半径与圆心', () => {
  const pts = Array.from({ length: 24 }, (_, i) => {
    const a = (2 * Math.PI * i) / 24;
    return [5 * Math.cos(a) + 2, 5 * Math.sin(a) - 1];
  });
  const fit = fitCircle2d(pts);
  assert.ok(fit);
  approx(fit.r, 5, 0.01, '半径');
  approx(fit.cx, 2, 0.01, '圆心x');
  approx(fit.cy, -1, 0.01, '圆心y');
  assert.ok(fit.maxErr < 0.01, `残差应近零，实际 ${fit.maxErr}`);
});

check('Kåsa 圆拟合：共线点奇异返回 null', () => {
  const pts = [[0, 0], [1, 1], [2, 2], [3, 3], [4, 4], [5, 5]];
  assert.equal(fitCircle2d(pts), null);
});

// ---------- 解析层 ----------

check('二进制/ASCII 两种形态解析同一盒子结果一致', () => {
  const tris = boxTris(0, 0, 0, 20, 20, 4);
  const bin = analyzeStl(stlBinary(tris));
  const asc = analyzeStl(stlAscii(tris));
  assert.equal(bin.ok, true);
  assert.equal(asc.ok, true);
  assert.deepEqual(asc.bbox, bin.bbox);
  approx(bin.volumeCm3, asc.volumeCm3, 0.01, '体积一致');
  approx(bin.contact.areaMm2, asc.contact.areaMm2, 1, '接触面积一致');
});

check('坏输入降级：截断/超限/非 STL 均返回 skipped 不抛', () => {
  assert.ok(analyzeStl(Buffer.from('tiny')).skipped, '过短文件');
  const tris = boxTris(0, 0, 0, 10, 10, 10);
  const buf = stlBinary(tris);
  const truncated = buf.subarray(0, 84 + 6 * 50); // 声明 12 面只给 6 面
  assert.ok(/截断/.test(analyzeStl(truncated).reason), '截断检测');
  const over = Buffer.alloc(84 + (MAX_TRIANGLES + 1) * 50);
  over.writeUInt32LE(MAX_TRIANGLES + 1, 80); // 声明数真实写进头，秒拒不等解析
  assert.ok(/上限/.test(analyzeStl(over).reason), '三角数超限');
  const junk = Buffer.alloc(200); junk.write('not a solid mesh at all...');
  assert.ok(analyzeStl(junk).skipped, '随机字节');
});

// ---------- 特征层：合成网格 ----------

check('垫圈管：亏格 1 + 孔口拟圆 r≈3 + 贴底环面 + 曲面占比', () => {
  const f = analyzeStl(stlBinary(washerTris(10, 3, 4, 32)));
  assert.equal(f.ok, true);
  assert.equal(f.mesh.closed, true, '管件应闭合');
  assert.equal(f.mesh.genus, 1, '通孔亏格应为 1');
  assert.equal(f.holes.count, 1, '孔数应合并为 1（上下对合口去重）');
  assert.ok(f.holes.radii[0] > 2.7 && f.holes.radii[0] < 3.3, `孔半径应≈3，实际 ${f.holes.radii[0]}`);
  assert.ok(Array.isArray(f.holes.circles) && f.holes.circles.length === 1, '应导出圆口候选');
  const circ = f.holes.circles[0];
  assert.ok(Math.abs(circ.r - 3) < 0.3, `圆口半径≈3，实际 ${circ.r}`);
  assert.deepEqual(circ.c.length, 3, '圆心三维');
  assert.equal(f.holes.circles[0].n.length, 3, '法向三维');
  approx(f.volumeCm3, (Math.PI * (100 - 9) * 4) / 1000, 0.08, '体积');
  approx(f.contact.areaMm2, Math.PI * 91, 20, '贴底接触=底环面');
  assert.ok(f.contact.footprintPct > 60, '环面接触占比应高');
  assert.ok(f.overhang.severePct < 2, `贴底面不计悬空，实际 ${f.overhang.severePct}%`);
  assert.ok(f.curvedPct > 25 && f.curvedPct < 50, `内外圆柱算曲面，实际 ${f.curvedPct}%`);
  assert.equal(f.suggestions.selection.hole_comp_z, true, '应建议通孔补偿·Z 向');
  assert.equal(f.suggestions.selection.curved_surface, true, '应建议曲面保护');
  assert.equal(f.suggestions.selection.overhang_heavy, undefined, '不应建议悬空支撑');
  assert.equal(f.suggestions.selection.small_footprint, undefined, '不应建议加裙边');
});

check('平板盒：无孔无悬空无建议（贴底不算悬空）', () => {
  const f = analyzeStl(stlBinary(boxTris(0, 0, 0, 20, 20, 4)));
  assert.equal(f.mesh.genus, 0);
  assert.equal(f.holes.count, 0);
  assert.ok(f.overhang.severePct < 1, `平放盒悬空应≈0，实际 ${f.overhang.severePct}%`);
  approx(f.contact.areaMm2, 400, 2, '整面贴底');
  assert.equal(f.contact.footprintPct, 100);
  assert.deepEqual(f.suggestions.selection, {}, '常规件零打扰');
});

check('细高柱：接触面积小+件高 → 建议加裙边', () => {
  const f = analyzeStl(stlBinary(boxTris(0, 0, 0, 8, 8, 50)));
  assert.equal(f.suggestions.selection.small_footprint, true, '64mm² 接触 × 50mm 高应触发');
  assert.equal(f.suggestions.selection.hole_comp_z, undefined);
});

check('悬臂 L 件（双盒拼合）：上半程悬空 → 建议悬空支撑', () => {
  const tris = [
    ...boxTris(0, 0, 0, 4, 20, 16),   // 立柱
    ...boxTris(4, 0, 12, 20, 20, 16), // 悬臂横臂（底面 z=12 悬空 320mm²）
  ];
  const f = analyzeStl(stlBinary(tris));
  assert.ok(f.overhang.severePct > 10, `横臂底面应计入重悬空，实际 ${f.overhang.severePct}%`);
  assert.ok(f.overhang.upperOverhangPct > 10, '横臂在上半程，悬端占比应显著');
  assert.equal(f.suggestions.selection.overhang_heavy, true);
});

check('法线整体翻转的网格：朝向自愈，接触面仍在底部', () => {
  const tris = boxTris(0, 0, 0, 20, 20, 4).map((t) => [t[0], t[2], t[1]]); // 翻转绕向 → 体积负
  const f = analyzeStl(stlBinary(tris));
  approx(f.contact.areaMm2, 400, 2, '翻转后接触面识别不变');
  assert.ok(f.overhang.severePct < 1);
});

check('4 个几何体检字段规则映射（勾选 → 引擎参数）', () => {
  const processRules = require('../src/services/processRules');
  // 孔补偿已随 2026-10-15 曼波定原则撤出种子（学习型因果一律动态拟合，
  // 从样本库经 ruleFitter 产出进待审池）——此处断言：种子无手写孔补偿
  assert.equal(processRules.applyRules({ hole_comp_z: true }).params.xyHoleComp, 0, '孔补偿不手写（拟合产出）');
  assert.equal(processRules.applyRules({ overhang_heavy: true }).params.supportDensity, 30, '支撑加密');
  assert.equal(processRules.applyRules({ curved_surface: true }).params.supportThresholdAngle, 40, '曲面支撑疤防护');
  const r = processRules.applyRules({ small_footprint: true });
  assert.equal(r.params.brim, true, '加裙边');
  assert.equal(r.params.brimWidth, 5);
  // 与显式规则共存：外观件（priority 100）覆盖曲面保护（60）
  assert.equal(processRules.applyRules({ curved_surface: true, appearance: true }).params.supportThresholdAngle, 45, '显式外观优先于几何默认');
  // 拟合规则可经 feat 条件生效（featureDerive 产出 → applyRules 消费）
  const viaFeat = processRules.applyRules({}, { feat: { holes_z: 2 } });
  assert.equal(typeof viaFeat.params.xyHoleComp, 'number', 'feat 条件通道可用（当前无手写规则命中则保持基线）');
});

// ---------- 建议映射层 ----------

check('suggestFromFeatures：阈值分支与零打扰口径', () => {
  const base = { ok: true, holes: { count: 0, radii: [] }, overhang: { severePct: 0, upperOverhangPct: 0 }, curvedPct: 0, contact: { areaMm2: 400, footprintPct: 100 }, bbox: { z: 4 } };
  assert.deepEqual(suggestFromFeatures(base).selection, {}, '全常规零建议');
  assert.equal(suggestFromFeatures({ ...base, holes: { count: 2, radii: [1.5] } }).selection.hole_comp_z, true);
  assert.equal(suggestFromFeatures({ ...base, overhang: { severePct: 9, upperOverhangPct: 0 } }).selection.overhang_heavy, true, '重悬空达标');
  assert.equal(suggestFromFeatures({ ...base, overhang: { severePct: 0, upperOverhangPct: 6 } }).selection.overhang_heavy, true, '悬端单独达标');
  assert.equal(suggestFromFeatures({ ...base, curvedPct: 35 }).selection.curved_surface, true);
  assert.equal(suggestFromFeatures({ ...base, bbox: { z: 50 }, contact: { areaMm2: 100, footprintPct: 50 } }).selection.small_footprint, true, '绝对值小+件高');
  const skip = suggestFromFeatures({ ok: false, skipped: true, reason: '太大了' });
  assert.deepEqual(skip.selection, {});
  assert.ok(skip.notes[0].includes('太大了'), '跳过原因进说明');
});

check('阈值常量与文档口径一致（防手滑改丢）', () => {
  assert.equal(THRESHOLDS.overhangSeverePct, 8);
  assert.equal(THRESHOLDS.curvedPct, 30);
  assert.equal(THRESHOLDS.contactRatio, 0.15);
});

// ---------- 3mf 几何链路（对象 XML → 逐件分析） ----------

/** 三角面组 → object_*.model XML 文本（顶点表共享索引 + 三角索引表） */
function objectXml(tris) {
  const vmap = new Map();
  const verts = [];
  const faces = [];
  for (const t of tris) {
    const idx = t.map((v) => {
      const key = v.map((n) => Math.round(n * 10000)).join('|');
      if (!vmap.has(key)) { vmap.set(key, verts.length); verts.push(v); }
      return vmap.get(key);
    });
    faces.push(idx);
  }
  const vertLines = verts.map((v) => `<vertex x="${v[0]}" y="${v[1]}" z="${v[2]}"/>`).join('');
  const triLines = faces.map((f) => `<triangle v1="${f[0]}" v2="${f[1]}" v3="${f[2]}"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter"><resources><object id="1" type="model"><mesh><vertices>${vertLines}</vertices><triangles>${triLines}</triangles></mesh></object></resources></model>`;
}

function make3mf(objects) { // objects: [{ name, tris }]；tris=null → 空网格对象
  const zip = new AdmZip();
  for (const o of objects) {
    zip.addFile(`3D/Objects/${o.name}.model`, Buffer.from(o.tris ? objectXml(o.tris) : '<model><resources><object id="1" type="model"/></resources></model>', 'utf8'));
  }
  return zip.toBuffer();
}

check('3mf 单零件盒：几何链路与 STL 同口径', () => {
  const f = analyze3mf(make3mf([{ name: 'box', tris: boxTris(0, 0, 0, 20, 20, 4) }]));
  assert.equal(f.ok, true);
  assert.equal(f.objectCount, 1);
  assert.deepEqual(f.objects[0].bbox, { x: 20, y: 20, z: 4 });
  assert.equal(f.objects[0].mesh.genus, 0);
  assert.equal(f.objects[0].holes.count, 0);
  assert.deepEqual(f.objects[0].suggestions.selection, {});
});

check('3mf 双零件工程：逐件独立分析（盒 + 垫圈），各归各特征', () => {
  const f = analyze3mf(make3mf([
    { name: 'box', tris: boxTris(0, 0, 0, 20, 20, 4) },
    { name: 'washer', tris: washerTris(10, 3, 4, 32) },
  ]));
  assert.equal(f.ok, true);
  assert.equal(f.objectCount, 2);
  const box = f.objects.find((o) => o.name === 'box');
  const washer = f.objects.find((o) => o.name === 'washer');
  assert.equal(box.holes.count, 0, '盒件无孔');
  assert.equal(washer.mesh.genus, 1, '垫圈件亏格 1');
  assert.equal(washer.holes.count, 1);
  assert.ok(washer.holes.radii[0] > 2.7 && washer.holes.radii[0] < 3.3, `垫圈孔径应≈3，实际 ${washer.holes.radii[0]}`);
  assert.equal(washer.suggestions.selection.hole_comp_z, true, '垫圈件应建议通孔补偿·Z 向');
  assert.deepEqual(box.suggestions.selection, {}, '盒件零打扰');
});

check('3mf 空对象降级：好对象照常分析，坏对象进 skippedObjects', () => {
  const f = analyze3mf(make3mf([
    { name: 'empty', tris: null },
    { name: 'box', tris: boxTris(0, 0, 0, 10, 10, 10) },
  ]));
  assert.equal(f.ok, true);
  assert.equal(f.objectCount, 1);
  assert.equal(f.objects[0].name, 'box');
  assert.equal(f.skippedObjects.length, 1);
  assert.equal(f.skippedObjects[0].name, 'empty');
});

check('3mf 非 zip 输入降级不抛', () => {
  const f = analyze3mf(Buffer.from('this is not a zip file at all'));
  assert.equal(f.ok, false);
  assert.ok(f.skipped);
});

console.log(failures === 0 ? `\n全部通过（${passed} 项）` : `\n${failures} 项失败（共 ${passed + failures} 项）`);
process.exit(failures === 0 ? 0 : 1);
