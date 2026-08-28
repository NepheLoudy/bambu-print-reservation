const { Client } = require('ssh2');
const { execSync } = require('child_process');

const config = {
  host: '10.253.33.233',
  port: 8500,
  username: 'qianli',
  password: 'cquqianli2026'
};

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

const commands = [
  { cmd: 'mkdir -p /opt/bambu-print-server', sudo: true },
  { cmd: 'chown -R qianli:qianli /opt/bambu-print-server', sudo: true },
  { cmd: 'cd /opt/bambu-print-server && if [ -d .git ]; then git fetch origin main && git reset --hard origin/main; else git init && git remote add origin https://github.com/NepheLoudy/bambu-print-reservation.git && git fetch origin main && git reset --hard origin/main; fi', sudo: false },
  { cmd: 'cd /opt/bambu-print-server && npm install --production', sudo: false },
  { cmd: `cat > /opt/bambu-print-server/.env << 'ENVEOF'
PORT=3001
APP_ID=cli_aac7e6f6cdf8dcc0
APP_SECRET=Z11s3UBWL2pivBCcc1zJnfJInKWmaYjN
BITABLE_APP_TOKEN=FKAQbYvILa1cYesZTmUcEi8lnvc
BITABLE_RESERVATION_TABLE_ID=tblOmBl6tzeJKrIg
BITABLE_PRINTER_TABLE_ID=
FEISHU_VERIFICATION_TOKEN=
FEISHU_ENCRYPT_KEY=
FEISHU_USE_LONG_CONNECTION=true
BOT_NAME=爆米花机-对话型
BOT_WEBHOOK_URL=https://open.feishu.cn/open-apis/bot/v2/hook/86aaf3f6-5536-498a-9355-7f3c18bcbb22
BOT_CHAT_ID=oc_4994e3f0ca73f76b1243b38622637f47
PRINTER_HOSTS=
PRINTER_ACCESS_CODES=
PRINTER_SERIALS=
PRINTER_NAMES=
PRINTER_MODELS=
REVIEWERS=
ENVEOF`, sudo: false },
  { cmd: 'pm2 delete bambu-print-server 2>/dev/null || true', sudo: false },
  { cmd: 'pm2 start /opt/bambu-print-server/src/index.js --name bambu-print-server', sudo: false },
  { cmd: 'pm2 save', sudo: false },
  { cmd: 'ufw allow 3001/tcp', sudo: true }
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