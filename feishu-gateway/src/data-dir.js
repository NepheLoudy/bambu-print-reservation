// ============================================================
// 运行时数据目录解析（usage.js 与 bitable-sync.js 共用，单一事实来源）：
// - GATEWAY_DATA_DIR 优先；默认 /home/qianli/feishu-gateway-data——必须在项目外
//   （部署 tar 会清空项目目录），POSIX 形式路径在 Windows 部署目标解析到当前盘根
// - 目录不存在则 recursive 创建（幂等）；写不了系统目录（本地开发等）退回项目内
//   src/（不入 git，.gitignore 已覆盖相应文件名）
// ============================================================
const fs = require('fs');
const path = require('path');

function resolveDataDir() {
  const dir = process.env.GATEWAY_DATA_DIR || '/home/qianli/feishu-gateway-data';
  try {
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  } catch (err) {
    return __dirname; // 本地开发等写不了系统目录时退回项目内（不入 git）
  }
}

module.exports = { resolveDataDir };
