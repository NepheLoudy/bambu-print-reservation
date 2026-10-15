'use strict';

/**
 * STEP/IGES 解析适配层（2026-10-15 曼波令「支持 step 解析」）：
 * 用 occt-import-js（OpenCASCADE 官方 WASM）把 B-rep CAD 文件网格化，
 * 输出与 modelFeatures.parseStl 同构的索引网格——几何体检 / 3D 标注 / 特征派生
 * 全链零改造复用；切片侧 OrcaSlicer CLI 原生直读 .step 无需转换。
 *
 * 输出形态：{ positions:number[], faces:number[], triangles, vertices, bodies }
 * 多组件 STEP（装配体）合并为单一网格（v1 与 3mf 多零件取首件的策略一致，
 * bodies 记录组件数供展示）。
 */

const path = require('path');

let occtPromise = null;
/** occt WASM 单例（初始化一次，约百毫秒；后续解析同步串行——Node 单线程天然安全） */
function getOcct() {
  if (!occtPromise) {
    const factory = require('occt-import-js');
    occtPromise = Promise.resolve(factory()).catch((err) => {
      occtPromise = null; // 初始化失败允许重试
      throw new Error(`STEP 解析引擎初始化失败: ${err.message}`);
    });
  }
  return occtPromise;
}

/** 是否 STEP 族文件（.step / .stp；IGES 顺手支持 .iges/.igs） */
function isCadFile(fileName) {
  return /\.(step|stp|iges|igs)$/i.test(String(fileName || ''));
}

/**
 * STEP/IGES Buffer → 索引网格（与 parseStl 同构）。
 * @returns {Promise<Object>} { positions, faces, triangles, vertices, bodies } 或 { error }
 */
async function parseCadToParsed(buffer, fileName = '') {
  const occt = await getOcct();
  const bytes = new Uint8Array(buffer);
  const isIges = /\.(iges|igs)$/i.test(fileName);
  const result = isIges ? occt.ReadIgesFile(bytes, null) : occt.ReadStepFile(bytes, null);
  if (!result || !result.success || !Array.isArray(result.meshes) || !result.meshes.length) {
    return { error: 'CAD 文件解析失败（文件损坏、版本不受支持或无可网格化实体——可先用 CAD 软件另存 STL）' };
  }

  // 合并全部组件为单一索引网格
  const positions = [];
  const faces = [];
  let vertexOffset = 0;
  let triangles = 0;
  for (const m of result.meshes) {
    const pos = m.attributes && m.attributes.position && m.attributes.position.array;
    if (!pos || !pos.length) continue;
    const vCount = pos.length / 3;
    for (let i = 0; i < pos.length; i++) positions.push(pos[i]);
    const idx = m.index && m.index.array ? m.index.array : null;
    if (idx) {
      for (let i = 0; i < idx.length; i++) faces.push(idx[i] + vertexOffset);
      triangles += idx.length / 3;
    } else {
      // 无索引：按顶点顺序每 3 顶点一三角形
      for (let i = 0; i < vCount; i++) faces.push(vertexOffset + i);
      triangles += vCount / 3;
    }
    vertexOffset += vCount;
  }
  if (!triangles) return { error: 'CAD 文件网格化结果为空（无面片）' };

  return {
    positions,
    faces,
    triangles: Math.round(triangles),
    vertices: vertexOffset,
    bodies: result.meshes.length,
  };
}

module.exports = { parseCadToParsed, isCadFile };
