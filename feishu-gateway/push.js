/**
 * 统一部署脚本：一条命令完成「代码进 Git + 配置进 NAS + 部署」
 *
 * 用法：
 *   npm run push "提交说明"   提交并部署
 *   npm run push              使用默认提交说明 "update: 代码更新"
 *
 * 说明：
 *   - 本项目位于顶层 monorepo 内，git 步骤只暂存 feishu-gateway/ 自身路径，
 *     推送到顶层仓库远端；push 失败不影响部署（走 SFTP 直传）。
 *   - 代码部署始终走 SFTP 打包直传（网关无独立仓库，NAS 上不拉 git）。
 *   - NAS 连接配置从 .env 读取（NAS_HOST/NAS_PORT/NAS_USER/NAS_PASSWORD），脚本不存任何密钥。
 */
const { spawnSync } = require('child_process');
const { Client } = require('ssh2');
const fs = require('fs');
const os = require('os');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const commitMessage = process.argv[2] || 'update: 代码更新';
const TAR_NAME = 'feishu-gateway-deploy.tar.gz';
const TAR_LOCAL = path.join(os.tmpdir(), TAR_NAME);
const TAR_REMOTE = '/tmp/' + TAR_NAME;
const REMOTE_DIR = '/opt/feishu-gateway';
const PM2_NAME = 'feishu-gateway';

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

// ============ [1/4] 提交推送到顶层 monorepo（只暂存本项目路径） ============
console.log('========== [1/4] 代码提交推送到 GitHub ==========');

// 从当前目录向上找到仓库根（含 .git 的目录）
function findRepoRoot(dir) {
  let cur = dir;
  while (cur !== path.parse(cur).root) {
    if (fs.existsSync(path.join(cur, '.git'))) return cur;
    cur = path.dirname(cur);
  }
  return null;
}

const repoRoot = findRepoRoot(__dirname);
if (repoRoot) {
  const opts = { stdio: 'inherit', cwd: repoRoot };
  const add = spawnSync('git', ['add', 'feishu-gateway'], opts);
  if (add.status !== 0) {
    console.error('git add 失败');
    process.exit(1);
  }
  const hasChanges = spawnSync('git', ['diff', '--cached', '--quiet'], opts).status !== 0;
  if (hasChanges) {
    const commit = spawnSync('git', ['commit', '-m', commitMessage], opts);
    if (commit.status !== 0) {
      console.error('git commit 失败');
      process.exit(1);
    }
  } else {
    console.log('(无待提交改动，跳过 commit)');
  }
  const push = spawnSync('git', ['push'], opts);
  if (push.status === 0) {
    console.log('✓ git push 成功');
  } else {
    console.log('⚠ git push 失败（本地无法访问 GitHub 443），代码部署照常走 SFTP 直传');
  }
} else {
  console.log('⚠ 未找到 git 仓库根，跳过 git 步骤');
}

// ============ [2/4] 打包 SFTP 直传 NAS ============
console.log('\n========== [2/4] 打包并上传代码 ==========');
const pack = spawnSync('tar', [
  '--force-local',
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

const conn = new Client();

conn.on('ready', () => {
  console.log('SSH 连接成功');
  conn.sftp((err, sftp) => {
    if (err) {
      console.error('SFTP 失败:', err.message);
      conn.end();
      process.exit(1);
    }
    sftp.fastPut(TAR_LOCAL, TAR_REMOTE, (err2) => {
      if (err2) {
        console.error('代码上传失败:', err2.message);
        conn.end();
        process.exit(1);
      }
      console.log('✓ 代码包已上传');
      exec('mkdir -p ' + REMOTE_DIR + '; '
        + 'rm -rf ' + REMOTE_DIR + '/.git ' + REMOTE_DIR + '/* ' + REMOTE_DIR + '/.[!.]* 2>/dev/null || true; '
        + 'tar -xzf ' + TAR_REMOTE + ' -C ' + REMOTE_DIR, () => npmInstall());
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

// ============ [3/4] npm install + 上传 .env ============
function npmInstall() {
  console.log('\n========== [3/4] npm install + 上传 .env ==========');
  exec('cd ' + REMOTE_DIR + ' && npm install --production', () => {
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

// ============ [4/4] 重启服务 ============
function restart() {
  console.log('\n========== [4/4] 重启服务 ==========');
  // 注意：网关只收飞书出站长连接 + 本机回环转发，无需开放防火墙端口（与 NAS 系统环境隔离）
  const cmd = 'pm2 restart ' + PM2_NAME + ' --update-env 2>/dev/null || pm2 start ' + REMOTE_DIR + '/src/index.js --name ' + PM2_NAME + '; pm2 save';
  exec(cmd, () => {
    console.log('\n✅ 部署完成，服务状态：');
    conn.exec('pm2 list', (err, stream) => {
      if (err) { conn.end(); return; }
      stream.on('data', (d) => process.stdout.write(d.toString()));
      stream.on('close', () => conn.end());
    });
  });
}

console.log('正在连接 NAS...');
conn.connect(nasConfig);
