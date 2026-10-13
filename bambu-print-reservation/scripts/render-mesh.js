#!/usr/bin/env node
// ============================================================
// 模型网格软渲染器（2026-10-11 识别验证工具）
//
// 纯 Node z-buffer 渲染：STL/3mf 对象网格 → PNG。默认把「朝下面
// （悬空检测带）」染红、「显著平面片」染蓝、其余按光照着色——
// 目视核对几何体检的悬空/孔/平面识别是否正确。
//
// 用法：node scripts/render-mesh.js <stl|3mf文件> [输出前缀] [--object 名称]
//   3mf 多对象时默认渲染全部（前缀+序号），--object 过滤单个
// 输出：<前缀>-iso.png（等轴测）、<前缀>-front.png（+Y 正视）
// ============================================================

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const mf = require('../src/services/modelFeatures');

const W = 640, H = 640;

// ---------- PNG 编码（无依赖：zlib + 手写 CRC） ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(w, h, rgb) { // rgb: Uint8Array w*h*3
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0; // filter none
    rgb.copy ? rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3)
      : raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1);
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- 渲染 ----------
/** mesh: {positions, faces}；view: 正交方向 {eye, up}；tint: 是否特征染色 */
function render(mesh, view, tint) {
  const { positions, faces } = mesh;
  // 包围盒与相机基
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length / 3; i++) {
    for (let a = 0; a < 3; a++) {
      const v = positions[i * 3 + a];
      if (v < mn[a]) mn[a] = v;
      if (v > mx[a]) mx[a] = v;
    }
  }
  const ctr = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];
  const span = Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) || 1;
  // 相机基：eye=观察方向（指向原点），right/up 正交
  const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
  const fwd = norm(view.eye.map((x) => -x));
  let rgt = norm([fwd[1] * view.up[2] - fwd[2] * view.up[1], fwd[2] * view.up[0] - fwd[0] * view.up[2], fwd[0] * view.up[1] - fwd[1] * view.up[0]]);
  const up = norm([rgt[1] * fwd[2] - rgt[2] * fwd[1], rgt[2] * fwd[0] - rgt[0] * fwd[2], rgt[0] * fwd[1] - rgt[1] * fwd[0]]);
  const scale = (Math.min(W, H) * 0.82) / span;
  const proj = (x, y, z) => {
    const d = [x - ctr[0], y - ctr[1], z - ctr[2]];
    return [W / 2 + (d[0] * rgt[0] + d[1] * rgt[1] + d[2] * rgt[2]) * scale,
      H / 2 - (d[0] * up[0] + d[1] * up[1] + d[2] * up[2]) * scale,
      d[0] * fwd[0] + d[1] * fwd[1] + d[2] * fwd[2]];
  };

  const img = Buffer.alloc(W * H * 3, 0xff); // 白底
  const zbuf = new Float32Array(W * H).fill(Infinity);
  const L = norm([0.35, -0.5, 0.8]); // 光照方向（世界系，照向模型）
  const planar = tint ? findPlanarFaceKeys(mesh) : null;

  for (let t = 0; t < faces.length / 3; t++) {
    const i0 = faces[t * 3] * 3, i1 = faces[t * 3 + 1] * 3, i2 = faces[t * 3 + 2] * 3;
    const ax = positions[i0], ay = positions[i0 + 1], az = positions[i0 + 2];
    const bx = positions[i1], by = positions[i1 + 1], bz = positions[i1 + 2];
    const cx = positions[i2], cy = positions[i2 + 1], cz = positions[i2 + 2];
    const nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
    const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    const nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const nl = Math.hypot(nx, ny, nz) || 1;
    const ux = nx / nl, uy = ny / nl, uz = nz / nl;
    if ((ux - ctr[0]) * 0 !== 0) continue;
    // 屏幕空间三角
    const p0 = proj(ax, ay, az), p1 = proj(bx, by, bz), p2 = proj(cx, cy, cz);
    const minX = Math.max(0, Math.floor(Math.min(p0[0], p1[0], p2[0])));
    const maxX = Math.min(W - 1, Math.ceil(Math.max(p0[0], p1[0], p2[0])));
    const minY = Math.max(0, Math.floor(Math.min(p0[1], p1[1], p2[1])));
    const maxY = Math.min(H - 1, Math.ceil(Math.max(p0[1], p1[1], p2[1])));
    if (maxX < minX || maxY < minY) continue;
    const area = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0]);
    if (Math.abs(area) < 1e-9) continue;
    const lam = Math.max(0, -(ux * L[0] + uy * L[1] + uz * L[2]));
    // 特征染色：朝下面红（悬空带）、显著平面片蓝、其余灰阶
    let R = 90 + 165 * lam, G = 90 + 165 * lam, B = 100 + 155 * lam;
    if (tint) {
      const down = -uz; // >0 朝下（外向网格约定，同 modelFeatures）
      const key = planar && planar.has(t);
      if (down > 0.9) { R = 235; G = 60 + 60 * lam; B = 60; }        // 悬空/贴底带：红
      else if (down > 0.55) { R = 235; G = 140 + 60 * lam; B = 90; } // 斜下：橙
      else if (key) { R = 80; G = 120 + 60 * lam; B = 235; }         // 平面片：蓝
    }
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const w0 = ((p1[0] - x) * (p2[1] - y) - (p1[1] - y) * (p2[0] - x)) / area;
        const w1 = ((p2[0] - x) * (p0[1] - y) - (p2[1] - y) * (p0[0] - x)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * p0[2] + w1 * p1[2] + w2 * p2[2];
        const bi = y * W + x;
        if (z < zbuf[bi]) {
          zbuf[bi] = z;
          img[bi * 3] = R; img[bi * 3 + 1] = G; img[bi * 3 + 2] = B;
        }
      }
    }
  }
  return encodePng(W, H, img);
}

/** 与 modelFeatures 同口径的显著平面片成员表（tint 用） */
function findPlanarFaceKeys(mesh) {
  const { positions, faces } = mesh;
  const triangles = faces.length / 3;
  const clusters = new Map();
  const q = (v) => (Object.is(Math.round(v), -0) ? 0 : Math.round(v));
  for (let t = 0; t < triangles; t++) {
    const a = faces[t * 3] * 3, b = faces[t * 3 + 1] * 3, c = faces[t * 3 + 2] * 3;
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len === 0) continue;
    nx /= len; ny /= len; nz /= len;
    if (nx + ny + nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const d = nx * positions[a] + ny * positions[a + 1] + nz * positions[a + 2];
    const key = `${q(nx * 100)}_${q(ny * 100)}_${q(nz * 100)}_${q(d * 10)}`;
    let cl = clusters.get(key);
    if (!cl) { cl = { area: 0, faces: [] }; clusters.set(key, cl); }
    // 面积近似略过（渲染染色不需要精确）
    cl.faces.push(t);
  }
  const sig = new Set();
  for (const cl of clusters.values()) { if (cl.faces.length >= 3) for (const f of cl.faces) sig.add(f); }
  return sig;
}

// ---------- 主流程 ----------
const file = process.argv[2];
if (!file) { console.error('用法: node scripts/render-mesh.js <stl|3mf> [输出前缀] [--object 名称]'); process.exit(1); }
const prefix = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : path.basename(file).replace(/\.[^.]+$/, '');
const objIdx = process.argv.indexOf('--object');
const objFilter = objIdx >= 0 ? process.argv[objIdx + 1] : null;

const buf = fs.readFileSync(file);
let targets = [];
const feats = { stl: null, objects: [] };
if (/\.3mf$/i.test(file)) {
  const r = mf.analyze3mf(buf);
  if (!r.ok) { console.error('3mf 分析失败: ' + (r.reason || '')); process.exit(1); }
  feats.objects = r.objects;
  targets = r.objects.filter((o) => !objFilter || o.name.includes(objFilter));
} else {
  const r = mf.analyzeStl(buf);
  if (!r.ok) { console.error('STL 分析失败: ' + (r.reason || '')); process.exit(1); }
  feats.stl = r;
  const parsed = mf.parseStl(buf);
  targets = [{ name: prefix, ...parsed }];
}

for (const t of targets) {
  const f = t.suggestions ? t : { ...t, ...mf.analyzeMesh(t) };
  const tag = targets.length > 1 ? `${prefix}-${t.name.replace(/[^\w-]/g, '_')}` : prefix;
  const views = [['iso', { eye: [1, -1.2, 0.9], up: [0, 0, 1] }], ['front', { eye: [0, -1, 0], up: [0, 0, 1] }]];
  for (const [vn, view] of views) {
    const out = `${tag}-${vn}.png`;
    fs.writeFileSync(out, render(t, view, true));
    console.log(`渲染 ${out}（${f.triangles} 面，bbox ${f.bbox.x}×${f.bbox.y}×${f.bbox.z}mm，建议: ${Object.keys((f.suggestions && f.suggestions.selection) || {}).join('+') || '常规'}）`);
  }
}
