/**
 * 统一部署脚本：SFTP 直传部署到 NAS（本项目位于顶层 monorepo 内，无独立 git 远端，跳过 git 步骤）
 *
 * 用法：
 *   npm run push
 *
 * 流程：
 *   [1/3] 打包代码 SFTP 直传 NAS
 *   [2/3] 上传 .env 到 NAS（含飞书密钥，只单独进 NAS，绝不进 git）
 *   [3/3] npm install + 重启服务
 *
 * NAS 连接配置从 .env 读取（NAS_HOST/NAS_PORT/NAS_USER/NAS_PASSWORD），脚本不存任何密钥。
 */
const { spawnSync } = require('child_process');
const { Client } = require('ssh2');
const os = require('os');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '.env') });
// ---------- [0] 部署前测试闸门（2026-09-13 R4）：测试不过不部署；SKIP_TESTS=1 可跳过 ----------
function runTestGate() {
  if (process.env.SKIP_TESTS === '1') {
    console.log('SKIP_TESTS=1，跳过部署前测试');
    return true;
  }
  const { spawnSync } = require('child_process');
  const cmd = 'node test/dispatcher-test.js && node test/dispatcher-persist-test.js && node test/dispatcher-manual-race-test.js && node test/approval-test.js';
  if (!cmd) { console.log('[测试闸门] 无测试命令，跳过'); return true; }
  console.log('[测试闸门] 运行:', cmd);
  const r = spawnSync(cmd, { shell: true, stdio: 'inherit', cwd: __dirname });
  if (r.status !== 0) {
    console.error('部署前测试未通过（SKIP_TESTS=1 可跳过），中止部署');
    return false;
  }
  console.log('[测试闸门] 通过');
  return true;
}
if (!runTestGate()) process.exit(1);

const TAR_NAME = 'bambu-print-server-deploy.tar.gz';
const TAR_LOCAL = path.join(os.tmpdir(), TAR_NAME);
const TAR_REMOTE = '/tmp/' + TAR_NAME;
const REMOTE_DIR = '/opt/bambu-print-server';
const PM2_NAME = 'bambu-print-server';

const nasConfig = {
  host: process.env.NAS_HOST,
  port: Number(process.env.NAS_PORT || 22),
  username: process.env.NAS_USER,
  password: process.env.NAS_PASSWORD,
};
if (!nasConfig.host || !nasConfig.password) {
  console.error('缺少 NAS 部署配置：请在 .env 中配置 NAS_HOST/NAS_PORT/NAS_USER/NAS_PASSWORD');
  process.exit(1);
}

// ============ [1/3] 打包并直传代码 ============
console.log('========== [1/3] 打包代码 ==========');
const pack = spawnSync('tar', [
  '-czf', TAR_NAME,
  '--exclude=node_modules',
  '--exclude=.git',
  '--exclude=.env',
  '--exclude=logs',
  '--exclude=*.log',
  '--exclude=' + TAR_NAME,
  '-C', __dirname,
  '.',
], { stdio: 'inherit', cwd: os.tmpdir() });
if (pack.status !== 0) {
  console.error('打包失败');
  process.exit(1);
}
console.log('打包完成:', TAR_LOCAL);

// ============ 连接 NAS ============
const conn = new Client();

conn.on('ready', () => {
  console.log('SSH 连接成功');
  conn.sftp((err, sftp) => {
    if (err) {
      console.error('SFTP 失败:', err.message);
      conn.end();
      process.exit(1);
    }
    console.log('上传代码包到 NAS...');
    sftp.fastPut(TAR_LOCAL, TAR_REMOTE, (err2) => {
      if (err2) {
        console.error('代码上传失败:', err2.message);
        conn.end();
        process.exit(1);
      }
      console.log('✓ 代码包已上传');
      deployCode();
    });
  });
});

conn.on('error', (err) => {
  console.error('SSH 连接失败:', err.message);
  process.exit(1);
});

function exec(cmd, cb) {
  console.log('>', cmd);
  conn.exec(cmd, (err, stream) => {
    if (err) {
      console.error('执行失败:', err.message);
      conn.end();
      process.exit(1);
    }
    stream.on('data', (d) => process.stdout.write(d.toString()));
    stream.stderr.on('data', (d) => process.stderr.write(d.toString()));
    stream.on('close', (code) => {
      if (code !== 0) {
        console.error(`命令失败 (退出码 ${code})`);
        conn.end();
        process.exit(code);
      }
      cb();
    });
  });
}

// ============ [2/3] 解压 + 上传 .env ============
function deployCode() {
  // 首次部署需建目录：/opt 需要 sudo 建目录并授权（与其它 qianli 项目一致）
  const sudo = (cmd) => `echo "${nasConfig.password}" | sudo -S ${cmd}`;
  const cmd = sudo('mkdir -p ' + REMOTE_DIR) + ' && ' + sudo('chown -R qianli:qianli ' + REMOTE_DIR) + '; '
    + 'rm -rf ' + REMOTE_DIR + '/.git ' + REMOTE_DIR + '/* ' + REMOTE_DIR + '/.[!.]* 2>/dev/null || true; '
    + 'tar -xzf ' + TAR_REMOTE + ' -C ' + REMOTE_DIR;
  exec(cmd, () => {
    console.log('\n========== [2/3] 上传 .env 到 NAS ==========');
    conn.sftp((err, sftp) => {
      if (err) {
        console.error('SFTP 失败:', err.message);
        conn.end();
        process.exit(1);
      }
      sftp.fastPut(path.join(__dirname, '.env'), REMOTE_DIR + '/.env', (err2) => {
        if (err2) {
          console.error('.env 上传失败:', err2.message);
          conn.end();
          process.exit(1);
        }
        console.log('✓ .env 已上传到 NAS（含飞书密钥，仅存于 NAS）');
        restart();
      });
    });
  });
}

// ============ [3/3] 安装依赖 + 重启 ============
function restart() {
  console.log('\n========== [3/3] npm install + 重启服务 ==========');
  exec('cd ' + REMOTE_DIR + ' && npm install --production', () => {
    const cmd = 'pm2 restart ' + PM2_NAME + ' --update-env 2>/dev/null || pm2 start ' + REMOTE_DIR + '/src/index.js --name ' + PM2_NAME + '; pm2 save';
    exec(cmd, () => {
      console.log('\n✅ 部署完成，服务状态：');
      conn.exec('pm2 list', (err, stream) => {
        if (err) { conn.end(); return; }
        stream.on('data', (d) => process.stdout.write(d.toString()));
        stream.on('close', () => conn.end());
      });
    });
  });
}

console.log('正在连接 NAS...');
conn.connect(nasConfig);
