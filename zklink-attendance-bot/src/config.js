const path = require('path');

const ROOT = path.join(__dirname, '..');
// 运行时数据目录默认在项目内（本地开发），部署目标 .env 里指向项目外 /home/qianli/zklink-attendance-data
//（顶层 AGENTS「运行时数据保护」：状态文件不放项目内，防 push 覆盖/误删）
const DATA_DIR = process.env.ZK_ATT_DATA_DIR || ROOT;

const config = {
  port: Number(process.env.PORT || 3017),
  timezone: process.env.ZK_ATT_TIMEZONE || 'Asia/Shanghai',
  cron: process.env.ZK_ATT_BROADCAST_CRON || '30 9 * * 1',
  // 数据源：import=ZKLink 网页端导出打卡明细上传（默认——http 通道端点未校准前静默切过去
  // 只会周周告警，同 wecom-attendance-bot v9 方案4 的取舍）；http=ZKLink 接口直拉
  dataSource: (process.env.ZKLINK_DATA_SOURCE || 'import') === 'http' ? 'http' : 'import',

  // ---- ZKLink 平台（考勤组/规则已在平台侧配好）----
  zklinkBaseUrl: (process.env.ZKLINK_BASE_URL || 'https://zklink.zktecoiot.com').replace(/\/+$/, ''),
  zklinkUsername: process.env.ZKLINK_USERNAME || '',
  zklinkPassword: process.env.ZKLINK_PASSWORD || '',
  // 候选端点：zklink.zktecoiot.com 是 qiankun 微前端壳（考勤模块 zkbio_att 动态挂载），
  // 登录/拉数真实路径未经凭据验证——凭据到位后跑 scripts/zklink-probe.js 校准回填
  zklinkLoginPath: process.env.ZKLINK_LOGIN_PATH || '/oauth/token',
  zklinkTransactionPath: process.env.ZKLINK_TRANSACTION_PATH || '/zkbio_att/api/attendance/transaction/list',
  zklinkAttGroupId: process.env.ZKLINK_ATT_GROUP_ID || '',

  // ---- 播报通道：值日群自定义机器人 webhook ----
  feishuWebhookUrl: process.env.FEISHU_WEBHOOK_URL || '',
  feishuWebhookSecret: process.env.FEISHU_WEBHOOK_SECRET || '',

  // ---- 云文档留档（飞书应用身份 docx API）----
  feishuAppId: process.env.FEISHU_APP_ID || '',
  feishuAppSecret: process.env.FEISHU_APP_SECRET || '',
  archiveDocToken: process.env.ARCHIVE_DOC_TOKEN || '',

  apiToken: process.env.ZK_ATT_API_TOKEN || '',

  membersFile: process.env.ZK_ATT_MEMBERS_FILE || path.join(ROOT, 'config', 'members.json'),
  stateFile: process.env.ZK_ATT_STATE_FILE || path.join(DATA_DIR, '.zklink-attendance-state.json'),
  exportsDir: process.env.ZK_ATT_EXPORTS_DIR || path.join(DATA_DIR, 'exports'),
  archiveDir: process.env.ZK_ATT_ARCHIVE_DIR || path.join(DATA_DIR, 'archive'),
};

config.cronParts = parseCron(config.cron);

// 只支持标准 5 字段「分 时 日 月 周」且 日/月 为 *（周播/日播类）；解析不出回退周一 09:30
//（补发判定需要知道"发送日=周几、几点几分"，周报窗口=发送日往前整 7 天）
function parseCron(expr) {
  const fallback = { minute: 30, hour: 9, dow: 1, parsed: false };
  const f = String(expr || '').trim().split(/\s+/);
  if (f.length !== 5) return fallback;
  if (!/^\d{1,2}$/.test(f[0]) || !/^\d{1,2}$/.test(f[1])) return fallback;
  if (f[2] !== '*' || f[3] !== '*') return fallback;
  if (f[4] !== '*' && !/^\d{1,2}$/.test(f[4])) return fallback;
  const minute = Number(f[0]);
  const hour = Number(f[1]);
  const dow = f[4] === '*' ? null : Number(f[4]) % 7; // 0/7 都算周日
  if (minute > 59 || hour > 23) return fallback;
  return { minute, hour, dow, parsed: true };
}

module.exports = config;
