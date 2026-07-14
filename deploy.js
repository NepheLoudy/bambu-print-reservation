const { Client } = require('ssh2');

const config = {
  host: '10.253.33.233',
  port: 8500,
  username: 'qianli',
  password: 'cquqianli2026'
};

const commands = [
  { cmd: 'mkdir -p /opt/bambu-print-server', sudo: true },
  { cmd: 'chown -R qianli:qianli /opt/bambu-print-server', sudo: true },
  { cmd: 'cd /opt/bambu-print-server && if [ -d .git ]; then git fetch origin main && git reset --hard origin/main; else git init && git remote add origin https://github.com/NepheLoudy/bambu-print-reservation.git && git fetch origin main && git reset --hard origin/main; fi', sudo: false },
  { cmd: 'cd /opt/bambu-print-server && npm install --production', sudo: false },
  { cmd: `cat > /opt/bambu-print-server/.env << 'ENVEOF'
PORT=3001
APP_ID=cli_aac7e6f6cdf8dcc0
APP_SECRET=Z11s3UBWL2pivBCcc1zJnfJInKWmaYjN
BITABLE_APP_TOKEN=
BITABLE_RESERVATION_TABLE_ID=
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

const conn = new Client();

conn.on('ready', () => {
  console.log('SSH连接成功！');
  executeNextCommand(0);
});

conn.on('error', (err) => {
  console.error('SSH连接失败:', err.message);
  process.exit(1);
});

conn.on('end', () => {
  console.log('SSH连接已关闭');
});

function executeNextCommand(index) {
  if (index >= commands.length) {
    console.log('\n所有命令执行完成！');
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
        executeNextCommand(index + 1);
      } else {
        console.error(`命令执行失败 (退出码: ${code})`);
        conn.end();
      }
    });
  });
}

console.log('正在连接到 NAS...');
conn.connect(config);
