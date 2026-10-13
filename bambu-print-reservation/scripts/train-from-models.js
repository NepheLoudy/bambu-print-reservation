#!/usr/bin/env node
// ============================================================
// 模型文件批量识别压测脚本（2026-10-11 二批；曼波纠偏：这不是训练）
//
// 「机器学人」的前提是有人工标注。本脚本做的是**无标注的识别能力压测
// + 数据采集**：扫一个目录里的模型文件，全部过几何体检与切片参数提取，
// 产出——
//   ① JSONL 数据集（每行一个文件记录；3mf 按零件拆对象）落
//      bambu-data/training/，作为识别基准与将来补标注的底料；
//   ② 「几何 when × 专家参数 diff」配对展示——⚠️ 在没有人工工况标注
//      的前提下，这只是识别输出与切片器 profile 的相关性，不是监督
//      样本；--commit 入池后也必须人工复核（审核闸门强制）；
//   ③ 控制台报告：建议触发分布、特征分位数、配对清单。
//
// 真正的训练数据只有两个来源：
//   ① 预约单本身——提交时的人工勾选 × 模型文件 = 天然标注对；
//   ② 人工对数据集批量补标注（未来做标注工具）。
//
// 用法：node scripts/train-from-models.js [目录] [--commit] [--out 输出目录]
//   默认目录 = ~/Downloads；默认输出 = C:/home/qianli/bambu-data/training
//   不带 --commit 只出报告与数据集，绝不写建议池。
// 注意：--commit 直接写待审池文件，与在线服务存在理论写竞态——挑服务
// 空闲时跑（凌晨/刚重启后），跑完在页面待审池人工复核。
// ============================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const modelFeatures = require('../src/services/modelFeatures');
const slicerExtract = require('../src/services/slicerExtract');

// 建议池在 --commit 时才加载（避免无谓打开存储文件）
const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const outIdx = args.indexOf('--out');
const OUT_DIR = outIdx >= 0 ? path.resolve(args[outIdx + 1]) : 'C:/home/qianli/bambu-data/training';
const dirArg = args.find((a, i) => !a.startsWith('--') && i !== outIdx + 1);
const SCAN_DIR = path.resolve(dirArg || path.join(os.homedir(), 'Downloads'));

const MODEL_EXTS = new Set(['.stl', '.3mf', '.step', '.stp', '.obj']);
const PENDING_EXTS = new Set(['.step', '.stp', '.obj']); // v2 B-rep 批处理

function walk(dir, depth = 0, acc = []) {
  if (depth > 3) return acc; // Downloads 浅层足够，防全盘扫描
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, depth + 1, acc);
    else if (MODEL_EXTS.has(path.extname(e.name).toLowerCase())) acc.push(full);
  }
  return acc;
}

function md5(buf) { return crypto.createHash('md5').update(buf).digest('hex'); }

/** 对象级特征 → 建议汇总（对象数加权） */
function aggregateSuggestions(objects) {
  const sel = {};
  for (const o of objects) {
    for (const [k, v] of Object.entries((o.suggestions && o.suggestions.selection) || {})) {
      if (v === true) sel[k] = true;
    }
  }
  return sel;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

// ---------- 主流程 ----------
const files = walk(SCAN_DIR);
if (files.length === 0) {
  console.log(`在 ${SCAN_DIR} 没找到模型文件（.stl/.3mf/.step/.stp/.obj）`);
  process.exit(0);
}
console.log(`扫描 ${SCAN_DIR}：模型文件 ${files.length} 个\n`);

const records = [];
const seenHashes = new Map();
let dupCount = 0;
const candidates = []; // { when, set, reason, sourceRef }

for (const filePath of files) {
  const ext = path.extname(filePath).toLowerCase();
  const base = path.basename(filePath);
  let buf;
  try { buf = fs.readFileSync(filePath); } catch (err) {
    records.push({ file: base, ext, kind: 'error', error: `读取失败: ${err.message}` });
    continue;
  }
  const hash = md5(buf);
  if (seenHashes.has(hash)) { dupCount++; records.push({ file: base, ext, kind: 'duplicate', duplicateOf: seenHashes.get(hash) }); continue; }
  seenHashes.set(hash, base);

  if (PENDING_EXTS.has(ext)) {
    records.push({ file: base, ext, kind: 'pending', sizeBytes: buf.length, md5: hash, reason: 'STEP/OBJ 几何解析在 v2 B-rep 批', analyzedAt: new Date().toISOString() });
    continue;
  }

  const rec = {
    file: base,
    ext,
    sizeBytes: buf.length,
    md5: hash,
    analyzedAt: new Date().toISOString(),
    expertParams: null,
    paramDiff: null,
    estMinutes: null,
    objects: [],
  };

  // 3mf：几何（逐零件）+ 专家切片参数（工程级）
  if (ext === '.3mf') {
    try {
      const extracted = slicerExtract.extractFrom3mf(buf);
      rec.expertParams = extracted.params;
      rec.paramDiff = extracted.diff;
      rec.estMinutes = extracted.estMinutes;
      rec.sliceSource = extracted.source;
    } catch (err) {
      rec.paramExtractError = err.message;
    }
    const geo = modelFeatures.analyze3mf(buf);
    if (geo.ok) {
      rec.kind = 'geometry-3mf';
      rec.objects = geo.objects;
      rec.skippedObjects = geo.skippedObjects;
      // 成对样本：几何建议（when）× 专家参数 diff（set）→ 候选规则
      // （收集与 COMMIT 解耦：报告模式也要能看到候选，入池才由 --commit 决定）
      const sel = aggregateSuggestions(geo.objects);
      if (Object.keys(sel).length > 0 && rec.paramDiff && Object.keys(rec.paramDiff).length > 0) {
        candidates.push({
          when: sel,
          set: rec.paramDiff,
          reason: `训练批注（${base}）：模型检出 ${Object.keys(sel).join('/')}，专家切片相对基线改了 ${Object.keys(rec.paramDiff).join('/')}`,
          sourceRef: base,
        });
      }
    } else if (rec.expertParams) {
      rec.kind = 'sliced-3mf'; // 已切片 gcode.3mf：只有参数没有对象网格
    } else {
      rec.kind = 'error';
      rec.error = geo.reason;
    }
  } else if (ext === '.stl') {
    const geo = modelFeatures.analyzeStl(buf);
    if (geo.ok) {
      rec.kind = 'geometry-stl';
      rec.objects = [{ name: path.basename(base, '.stl'), ...geo }];
    } else {
      rec.kind = 'error';
      rec.error = geo.reason;
    }
  }
  records.push(rec);
}

// ---------- 数据集落盘 ----------
fs.mkdirSync(OUT_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outFile = path.join(OUT_DIR, `dataset-${stamp}.jsonl`);
fs.writeFileSync(outFile, records.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf-8');

// ---------- 报告 ----------
const byKind = {};
for (const r of records) byKind[r.kind] = (byKind[r.kind] || 0) + 1;
const analyzed = records.filter((r) => r.objects && r.objects.length > 0);
const allObjects = analyzed.flatMap((r) => r.objects);

console.log('════════ 训练批报告 ════════');
console.log(`文件分布: ${JSON.stringify(byKind)}${dupCount ? `（去重 ${dupCount} 个）` : ''}`);
console.log(`数据集: ${outFile}（${records.length} 行）`);
console.log(`可训练对象: ${allObjects.length} 个（来自 ${analyzed.length} 个文件）\n`);

if (allObjects.length > 0) {
  const sugCount = { through_holes: 0, overhang_heavy: 0, curved_surface: 0, small_footprint: 0 };
  const severeDist = [], curvedDist = [], contactDist = [], holeRadii = [];
  for (const o of allObjects) {
    const sel = (o.suggestions && o.suggestions.selection) || {};
    for (const k of Object.keys(sugCount)) if (sel[k]) sugCount[k]++;
    severeDist.push(o.overhang.severePct);
    curvedDist.push(o.curvedPct);
    contactDist.push(o.contact.footprintPct);
    if (o.holes.radii[0] !== undefined) holeRadii.push(o.holes.radii[0]);
  }
  const pct = (a) => a.slice().sort((x, y) => x - y);
  console.log('── 建议触发分布（当前阈值下） ──');
  for (const [k, n] of Object.entries(sugCount)) console.log(`  ${k}: ${n}/${allObjects.length}`);
  console.log('── 特征分位数（P25/P50/P75/P90） ──');
  console.log(`  重悬空%: ${[25, 50, 75, 90].map((p) => percentile(pct(severeDist), p)).join(' / ')}`);
  console.log(`  曲面%:   ${[25, 50, 75, 90].map((p) => percentile(pct(curvedDist), p)).join(' / ')}`);
  console.log(`  接触占比%: ${[25, 50, 75, 90].map((p) => percentile(pct(contactDist), p)).join(' / ')}`);
  if (holeRadii.length) console.log(`  检出孔: ${holeRadii.length} 个对象带孔，最小半径 P50 = ${percentile(pct(holeRadii), 50)}mm\n`);
}

const estFiles = records.filter((r) => r.estMinutes);
if (estFiles.length) {
  console.log('── 专家切片预估时长（estMinutes，队列 ETA 校准料） ──');
  for (const r of estFiles) console.log(`  ${r.file}: ${r.estMinutes} 分钟`);
  console.log('');
}

console.log('── 逐文件明细 ──');
for (const r of records) {
  if (r.kind === 'duplicate') { console.log(`  ⏭ ${r.file}（与 ${r.duplicateOf} 内容相同）`); continue; }
  if (r.kind === 'pending') { console.log(`  ⏳ ${r.file}（${r.reason}）`); continue; }
  if (r.kind === 'error') { console.log(`  ✗ ${r.file}（${r.error}）`); continue; }
  const objLine = r.objects.map((o) => {
    const sel = Object.keys((o.suggestions && o.suggestions.selection) || {}).join('+') || '常规';
    return `${o.name}[${o.triangles}面 ${o.bbox.x}×${o.bbox.y}×${o.bbox.z}mm → ${sel}]`;
  }).join(' ');
  const diffLine = r.paramDiff && Object.keys(r.paramDiff).length
    ? ` 专家diff: ${Object.entries(r.paramDiff).map(([k, v]) => k + '=' + v).join(' ')}`
    : '';
  console.log(`  ✓ ${r.file}（${r.kind}）\n      ${objLine}${diffLine}`);
}

console.log(`\n候选规则（几何 when × 专家 set 配对，原始）: ${candidates.length} 条`);

// 配置噪声过滤：切片器全局 profile 的常量参数（如 ironing=true、brim=true 人人都有）
// 不是特征相关的决策——同参数同值出现在 ≥80% 候选里即视为 profile 常量，从 set 剥离
const freq = new Map(); // `${param}=${value}` → 出现次数
for (const c of candidates) {
  for (const [k, v] of Object.entries(c.set)) {
    const key = `${k}=${JSON.stringify(v)}`;
    freq.set(key, (freq.get(key) || 0) + 1);
  }
}
const noiseKeys = new Set();
for (const [key, n] of freq) {
  if (candidates.length >= 2 && n / candidates.length >= 0.8) noiseKeys.add(key);
}
for (const c of candidates) {
  for (const k of Object.keys(c.set)) {
    if (noiseKeys.has(`${k}=${JSON.stringify(c.set[k])}`)) delete c.set[k];
  }
  c.dropped = c.rawSet = null;
}
const realCandidates = candidates.filter((c) => Object.keys(c.set).length > 0);
const stripped = candidates.length - realCandidates.length;
console.log(`剥掉 profile 常量（${[...noiseKeys].map((k) => k.replace('=', ':')).join('、') || '无'}）后剩 ${realCandidates.length} 条${stripped ? `（${stripped} 条 set 被剥空弃用）` : ''}`);
for (const c of realCandidates) console.log(`  [${c.sourceRef}] when: ${JSON.stringify(c.when)} → set: ${JSON.stringify(c.set)}`);
if (realCandidates.length > 0) console.log('⚠️ 以上是「识别输出 × 切片器配置」的相关性展示——这些文件没有人工工况标注，不构成训练样本；--commit 入池后也必须人工逐条复核');
if (COMMIT && realCandidates.length > 0) {
  const ruleSuggestions = require('../src/services/ruleSuggestions');
  let merged = 0;
  for (const c of realCandidates) {
    const r = ruleSuggestions.add({
      when: c.when,
      set: c.set,
      reason: c.reason,
      source: 'extraction',
      sourceRef: c.sourceRef,
      suggestedBy: 'train-from-models',
    });
    if (r.merged) merged++;
  }
  console.log(`已写入待审池 ${realCandidates.length} 条（其中 ${merged} 条与既有建议聚合计数）——请到页面学习链路人工复核采纳`);
}
