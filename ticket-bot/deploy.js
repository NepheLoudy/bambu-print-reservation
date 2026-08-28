const { Client } = require('ssh2');
const { execSync } = require('child_process');

const config = {
  host: '10.253.33.233',
  port: 8500,
  username: 'qianli',
  password: 'cquqianli2026'
};

const REMOTE_DIR = '/opt/ticket-bot';
const PM2_NAME = 'ticket-bot';
const PORT = 3003;
const GITHUB_REPO = 'https://github.com/NepheLoudy/ticket-bot.git';

function runGitCommands() {
  console.log('\n=== 步骤1: 提交代码到 GitHub ===');

  try {
    console.log('检查 git 状态...');
    const status = execSync('git status --porcelain').toString().trim();
    if (!status) {
      console.log('❌ 没有需要提交的更改');
      return false;
    }

    console.log('添加所有文件...');
    execSync('git add -A');

    console.log('提交更改...');
    execSync('git commit -m "chore: 自动部署更新"');

    console.log('推送代码到 GitHub...');
    execSync('git push origin main');

    console.log('✅ 代码已推送到 GitHub');
    return true;
  } catch (err) {
    console.error('❌ Git 操作失败:', err.message);
    return false;
  }
}

const envTemplate = `PORT=${PORT}
APP_ID=
APP_SECRET=
# 源表（工单录入表）
BITABLE_APP_TOKEN=
SOURCE_TABLE_ID=
# 目标表（整理后的工单表）
TARGET_BITABLE_APP_TOKEN=
TARGET_TABLE_ID=
# 字段映射
FIELD_MAPPING=
SYNC_KEY_FIELD=源记录ID
# 群播报路由
ROUTE_FIELD=工单分类
GROUP_ROUTES=
DEFAULT_CHAT_ID=
TITLE_FIELD=工单标题
STATUS_FIELD=工单状态
PENDING_STATUS=待处理
WATCHED_FIELDS=
BROADCAST_ON=create,update
# 事件订阅
FEISHU_USE_LONG_CONNECTION=true
FEISHU_VERIFICATION_TOKEN=
FEISHU_ENCRYPT_KEY=
BOT_NAME=工单机器人
# 每日汇总
CRON_SCHEDULE=
`;

const commands = [
  { cmd: `mkdir -p ${REMOTE_DIR}`, sudo: true },
  { cmd: `chown -R qianli:qianli ${REMOTE_DIR}`, sudo: true },
  { cmd: `cd ${REMOTE_DIR} && if [ -d .git ]; then git fetch origin main && git reset --hard origin/main; else git init && git remote add origin ${GITHUB_REPO} && git fetch origin main && git reset --hard origin/main; fi`, sudo: false },
  { cmd: `cd ${REMOTE_DIR} && npm install --production`, sudo: false },
  { cmd: `cat > ${REMOTE_DIR}/.env << 'ENVEOF'\n${envTemplate}ENVEOF`, sudo: false },
  { cmd: `pm2 delete ${PM2_NAME} 2>/dev/null || true`, sudo: false },
  { cmd: `pm2 start ${REMOTE_DIR}/src/index.js --name ${PM2_NAME}`, sudo: false },
  { cmd: 'pm2 save', sudo: false },
  { cmd: `ufw allow ${PORT}/tcp`, sudo: true }
];

function deployToNAS() {
  const conn = new Client();

  conn.on('ready', () => {
    console.log('\nSSH连接成功！');
    executeNextCommand(conn, 0);
  });

  conn.on('error', (err) => {
    console.error('SSH连接失败:', err.message);
    process.exit(1);
  });

  conn.on('end', () => {
    console.log('SSH连接已关闭');
  });

  console.log('\n=== 步骤2: 部署到 NAS ===');
  console.log('正在连接到 NAS...');
  conn.connect(config);
}

function executeNextCommand(conn, index) {
  if (index >= commands.length) {
    console.log('\n✅ 所有命令执行完成！');
    conn.end();
    return;
  }

  const { cmd, sudo } = commands[index];
  const displayCmd = cmd.substring(0, 60) + (cmd.length > 60 ? '...' : '');
  console.log(`\n[${index + 1}/${commands.length}] 执行${sudo ? '(sudo)' : ''}: ${displayCmd}`);

  const execCmd = sudo ? `echo "cquqianli2026" | sudo -S ${cmd}` : cmd;

  conn.exec(execCmd, (err, stream) => {
    if (err) {
      console.error('命令执行失败:', err.message);
      conn.end();
      return;
    }

    stream.on('data', (data) => {
      const output = data.toString().trim();
      if (output && !output.includes('[sudo] password') && !output.includes('cquqianli2026')) {
        console.log(output);
      }
    });

    stream.stderr.on('data', (data) => {
      const error = data.toString().trim();
      if (error && !error.includes('[sudo] password') && !error.includes('cquqianli2026')) {
        console.error('错误:', error);
      }
    });

    stream.on('close', (code) => {
      if (code === 0) {
        console.log(`命令执行成功 (退出码: ${code})`);
        executeNextCommand(conn, index + 1);
      } else {
        console.error(`命令执行失败 (退出码: ${code})`);
        conn.end();
      }
    });
  });
}

async function main() {
  const hasChanges = runGitCommands();

  if (!hasChanges) {
    console.log('\n=== 跳过部署 ===');
    process.exit(0);
  }

  deployToNAS();
}

main();
