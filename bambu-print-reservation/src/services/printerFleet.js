// ============================================================
// 打印机机队注册表（2026-10-12 曼波：多品牌多机型隔离）
//
// 机队里打印机品牌不同、构建体积不同——几何链路全机通用，
// 工艺链路必须按机型隔离。机队档案：品牌/构建体积/喷嘴（人工维护，JSON 持久化）。
// （原「机器可信度」评分已随置信度条语义移交给 paramFit.js 一并退役，字段删除。）
// ============================================================

const fs = require('fs');
const path = require('path');

const FILE = process.env.PRINTER_FLEET_FILE || path.join(__dirname, '..', '..', '.printer-fleet.json');

/** 出厂种子（首次无文件时播种；之后以文件为准，人工编辑） */
const SEED = [
  { name: 'Bambu Lab X1C', brand: 'Bambu Lab', model: 'X1 Carbon', buildVolume: [256, 256, 256], nozzle: 0.4, notes: '主力机' },
  { name: 'Bambu Lab P1S', brand: 'Bambu Lab', model: 'P1S', buildVolume: [256, 256, 256], nozzle: 0.4, notes: '' },
  { name: 'Bambu Lab H2D', brand: 'Bambu Lab', model: 'H2D', buildVolume: [350, 320, 325], nozzle: 0.4, notes: '' },
  { name: 'Flashforge Adventurer 5M', brand: 'Flashforge', model: 'AD5M', buildVolume: [220, 220, 220], nozzle: 0.4, notes: '' },
  { name: 'Flashforge Adventurer 5M Pro', brand: 'Flashforge', model: 'AD5M Pro', buildVolume: [220, 220, 220], nozzle: 0.4, notes: '' },
  { name: 'Flashforge Creator 5 Pro', brand: 'Flashforge', model: 'C5 Pro', buildVolume: [256, 256, 256], nozzle: 0.4, notes: '四喷头多色' },
];

function load() {
  try {
    if (fs.existsSync(FILE)) {
      const data = JSON.parse(fs.readFileSync(FILE, 'utf-8'));
      if (Array.isArray(data.machines)) return data.machines;
    }
  } catch (err) {
    console.warn('[机队] 注册表加载失败（用出厂种子）:', err.message);
  }
  save(SEED);
  return SEED.map((m) => ({ ...m }));
}

function save(machines) {
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ savedAt: new Date().toISOString(), machines }, null, 2));
  fs.renameSync(tmp, FILE);
}

function get(name) {
  return load().find((m) => m.name === name) || null;
}

// 注：置信度条语义 2026-10-12 经曼波纠正为「引擎参数 vs 专家切片参数」的
// 拟合度（见 src/services/paramFit.js）——本服务只管机队档案与机型隔离，
// 不再承担评分职责。

module.exports = { load, save, get, FILE };
