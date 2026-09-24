const path = require('path');

const ROOT = path.join(__dirname, '..');
// 运行时数据目录默认在项目内（本地开发），部署目标 .env 里指向项目外 /home/qianli/wecom-attendance-data
//（顶层 AGENTS「运行时数据保护」：状态文件不放项目内，防 push 覆盖/误删）
const DATA_DIR = process.env.ATTENDANCE_DATA_DIR || ROOT;

const config = {
  port: Number(process.env.PORT || 3007),
  timezone: process.env.ATTENDANCE_TIMEZONE || 'Asia/Shanghai',
  cron: process.env.ATTENDANCE_BROADCAST_CRON || '30 9 * * 1',
  // 数据源（方案4，2026-09-16）：import=人肉周导报表（当前生产口径，env 缺失时也落在此档——
  // api=企微打卡接口需可信IP门槛，家宽部署不可行，静默切过去只会周周告警）
  dataSource: (process.env.ATTENDANCE_DATA_SOURCE || 'import') === 'api' ? 'api' : 'import',
  corpId: process.env.WECOM_CORP_ID || '',
  secret: process.env.WECOM_ATTENDANCE_SECRET || '',
  webhookKey: process.env.WECOM_WEBHOOK_KEY || '',
  feishuWebhookUrl: process.env.FEISHU_WEBHOOK_URL || '',
  feishuWebhookSecret: process.env.FEISHU_WEBHOOK_SECRET || '',
  feishuAppId: process.env.FEISHU_APP_ID || '',
  feishuAppSecret: process.env.FEISHU_APP_SECRET || '',
  feishuCsvChatId: process.env.FEISHU_CSV_CHAT_ID || '',
  apiToken: process.env.ATTENDANCE_API_TOKEN || '',
  membersFile: process.env.ATTENDANCE_MEMBERS_FILE || path.join(ROOT, 'config', 'members.json'),
  stateFile: process.env.ATTENDANCE_STATE_FILE || path.join(DATA_DIR, '.attendance-state.json'),
  exportsDir: process.env.ATTENDANCE_EXPORTS_DIR || path.join(DATA_DIR, 'exports'),
};

config.cronParts = parseCron(config.cron);

// 只支持标准 5 字段「分 时 日 月 周」且 日/月 为 *（周播/日播类）；解析不出回退周一 09:30
// （补发判定需要知道"发送日=周几、几点几分"，周报窗口=发送日往前整 7 天）
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
