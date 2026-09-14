// ============================================================
// 本地存储：成员名单（config/members.json，不进 git，权威在部署目标侧）
// 与播报水位（state：lastSentWeekKey 防重复播报 / lastError 供巡检）
// 文件路径可被 .env 覆盖（部署目标上放项目外数据目录）
// ============================================================
const fs = require('fs');
const path = require('path');
const config = require('./config');

function ensureDir(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function loadMembers() {
  try {
    const raw = JSON.parse(fs.readFileSync(config.membersFile, 'utf8'));
    const list = Array.isArray(raw) ? raw : raw.members || [];
    return list.filter((m) => m && m.userid);
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

function saveMembers(list) {
  ensureDir(config.membersFile);
  fs.writeFileSync(config.membersFile, JSON.stringify({ members: list }, null, 2) + '\n');
  return list;
}

// 校验并应用成员增删（返回 {list, error}）
function applyMembersChange({ action, userid, name }) {
  const list = loadMembers();
  if (!userid || typeof userid !== 'string') return { error: 'userid 必填（企微通讯录账号）' };
  if (action === 'add') {
    if (!name || typeof name !== 'string') return { error: 'name 必填（用于周报展示）' };
    if (list.some((m) => m.userid === userid)) return { error: `userid ${userid} 已在名单中` };
    list.push({ userid, name });
  } else if (action === 'remove') {
    const idx = list.findIndex((m) => m.userid === userid);
    if (idx < 0) return { error: `userid ${userid} 不在名单中` };
    list.splice(idx, 1);
  } else {
    return { error: 'action 必须是 add 或 remove' };
  }
  saveMembers(list);
  return { list };
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(config.stateFile, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw e;
  }
}

function saveState(state) {
  ensureDir(config.stateFile);
  fs.writeFileSync(config.stateFile, JSON.stringify(state, null, 2) + '\n');
  return state;
}

module.exports = { loadMembers, saveMembers, applyMembersChange, loadState, saveState };
