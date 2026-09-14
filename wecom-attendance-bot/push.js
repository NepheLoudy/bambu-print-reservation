/**
 * 统一部署脚本：一条命令完成「代码进 Git + 配置进部署目标 + 部署」
 * （复制 feishu-gateway 版（repo:top 模式：本项目在顶层 monorepo 内，无独立远端），
 *   按 qianli-deploy 链路改：TAR_NAME / REMOTE_DIR / PM2_NAME；
 *   私有配置守卫复制 duty-bot 版）
 *
 * 用法：
 *   npm run push "提交说明"   提交并部署
 *   npm run push              使用默认提交说明 "update: 代码更新"
 *
 * 流程：
 *   [0]   部署前测试闸门（测试不过不部署；SKIP_TESTS=1 可跳过）
 *   [1/4] 代码提交推送顶层 monorepo（只暂存 wecom-attendance-bot/ 路径；push 失败不阻断）
 *   [2/4] SFTP 打包直传部署目标（小电脑 DESKTOP-FE1MIGI）
 *   [3/4] npm install + 上传 .env + config/members.json（备份+守卫）
 *   [4/4] pm2 重启（不存在则首启）+ pm2 save
 *
 * NAS_* 变量为历史命名，语义=部署目标。
 */
const { spawnSync } = require('child_process');
const { Client } = require('ssh2');
const os = require('os');
const path = require('path');
const fs = require('fs');

require('dotenv').config({ path: path.join(__dirname, '.env') });

// ---------- [0] 部署前测试闸门（顶层 AGENTS「全局工程规则」：行为改动必须过桩测试） ----------
function runTestGate() {
  if (process.env.SKIP_TESTS === '1') {
    console.log('SKIP_TESTS=1，跳过部署前测试');
    return true;
  }
  console.log('[测试闸门] 运行: npm run test');
  const r = spawnSync('npm run test', { shell: true, stdio: 'inherit', cwd: __dirname });
  if (r.status !== 0) {
    console.error('部署前测试未通过（SKIP_TESTS=1 可跳过），中止部署');
    return false;
  }
  console.log('[测试闸门] 通过');
  return true;
}
if (!runTestGate()) process.exit(1);

const commitMessage = process.argv[2] || 'update: 代码更新';
const TAR_NAME = 'wecom-attendance-deploy.tar.gz';
// 打包用相对文件名 + cwd 指向临时目录，避免 Windows GNU tar 把 "C:" 当远程主机
const TAR_LOCAL = path.join(os.tmpdir(), TAR_NAME);
const TAR_REMOTE = '/c/qianli/' + TAR_NAME;
const TAR_REMOTE_WIN = 'C:/qianli/' + TAR_NAME;
const REMOTE_DIR = '/c/qianli/opt/wecom-attendance-bot';
const REMOTE_DIR_WIN = 'C:/qianli/opt/wecom-attendance-bot';
const PM2_NAME = 'wecom-attendance';

// 【运行时数据保护】成员名单含真实企微 userid/姓名，不进 git；
// 权威编辑路径在部署目标侧（定制窗口直写），本地只是种子：
// 上传前先备份现网版本；本地条目数少于现网时跳过上传（PUSH_FORCE_PRIVATE=1 强制覆盖）。
const PRIVATE_CONFIG_FILES = ['config/members.json'];
const DATA_DIR = '/c/home/qianli/wecom-attendance-data';
const DATA_DIR_WIN = 'C:/home/qianli/wecom-attendance-data';

/** 估算配置里的条目数（数组字段长度求和；解析失败按内容字节数/100 估） */
function countEntries(content) {
  if (!content || !content.trim()) return 0;
  try {
    const obj = JSON.parse(content);
    const arrays = Object.values(obj).filter((v) => Array.isArray(v));
    if (arrays.length) return arrays.reduce((sum, a) => sum + a.length, 0);
    return Object.keys(obj).length;
  } catch {
    return Math.floor(content.length / 100);
  }
}

const nasConfig = {
  host: process.env.NAS_HOST,
  port: Number(process.env.NAS_PORT || 22),
  username: process.env.NAS_USER,
  password: process.env.NAS_PASSWORD,
};
if (!nasConfig.host || !nasConfig.password) {
  console.error('缺少部署配置：请在 .env 中配置 NAS_HOST/NAS_PORT/NAS_USER/NAS_PASSWORD');
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
  const add = spawnSync('git', ['add', 'wecom-attendance-bot'], opts);
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

// ============ [2/4] 打包 SFTP 直传部署目标 ============
console.log('\n========== [2/4] 打包并上传代码 ==========');
const pack = spawnSync('tar', [
  '--force-local',
  '-czf', TAR_NAME,
  '--exclude=node_modules',
  '--exclude=.git',
  '--exclude=.env',
  '--exclude=config/members.json',
  '--exclude=.attendance-state.json',
  '--exclude=exports',
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
    sftp.fastPut(TAR_LOCAL, TAR_REMOTE_WIN, (err2) => {
      if (err2) {
        console.error('代码上传失败:', err2.message);
        conn.end();
        process.exit(1);
      }
      console.log('✓ 代码包已上传');
      // 【运行时数据保护】守卫必须在 rm -rf 之前读现网文件：
      // 备份现网版本 + 判断本地种子是否过期（否则 rm 之后现网永远是空，守卫形同虚设，
      // 正是 2026-09-12 duty-bot 白名单覆盖事故的复现路径）
      planPrivateConfig(0, {}, (plan) => {
        // 代码目录全量替换；运行时数据在项目外数据目录（state/exports/backup），不受影响
        exec('mkdir -p ' + REMOTE_DIR + '; '
          + 'rm -rf ' + REMOTE_DIR + '/.git ' + REMOTE_DIR + '/* ' + REMOTE_DIR + '/.[!.]* 2>/dev/null || true; '
          + 'tar -xzf ' + TAR_REMOTE + ' -C ' + REMOTE_DIR + '; '
          + 'mkdir -p ' + DATA_DIR + '/exports ' + DATA_DIR + '/backup', () => npmInstall(plan));
      });
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

// ============ [3/4] npm install + 上传 .env 与私有配置 ============
function npmInstall(plan) {
  console.log('\n========== [3/4] npm install + 上传 .env 与成员名单 ==========');
  // PATH 里显式带上 node 目录（小电脑 pm2 环境的既有做法）
  exec('export PATH=/c/tools/node-v22.10.0-win-x64:/mingw64/bin:/usr/local/bin:/usr/bin:/bin:/Windows/System32:$PATH; cd ' + REMOTE_DIR + ' && npm install --omit=dev', () => {
    conn.sftp((err, sftp) => {
      if (err) {
        console.error('SFTP 失败:', err.message);
        conn.end();
        process.exit(1);
      }
      sftp.fastPut(path.join(__dirname, '.env'), REMOTE_DIR_WIN + '/.env', (err2) => {
        if (err2) {
          console.error('.env 上传失败:', err2.message);
          conn.end();
          process.exit(1);
        }
        console.log('✓ .env 已上传（含企微密钥，仅存于部署目标）');
        applyPrivateConfig(0, plan, restart);
      });
    });
  });
}

// 阶段一（rm -rf 之前）：读现网私有配置 → 有内容且与本地不同先备份 → 判断本地种子是否过期。
// plan 形如 { 'config/members.json': { action: 'upload'|'restore', remoteContent } }
function planPrivateConfig(i, plan, done) {
  const files = PRIVATE_CONFIG_FILES.filter((f) => fs.existsSync(path.join(__dirname, f)));
  if (i >= files.length) {
    console.log('✓ 私有配置现网状态盘点完毕（备份/守卫判定前置于代码目录替换）');
    return done(plan);
  }
  const f = files[i];
  conn.sftp((err, sftp) => {
    if (err) {
      console.error('SFTP 失败:', err.message);
      conn.end();
      process.exit(1);
    }
    const remotePath = REMOTE_DIR_WIN + '/' + f;
    sftp.readFile(remotePath, 'utf8', (readErr, remoteContent) => {
      const localContent = fs.readFileSync(path.join(__dirname, f), 'utf8');
      const remoteCount = readErr ? 0 : countEntries(remoteContent);
      const localCount = countEntries(localContent);

      if (remoteCount > localCount && process.env.PUSH_FORCE_PRIVATE !== '1') {
        // 本地种子过期：跳过上传，且把现网内容回填本地 + 记入 plan 待 rm 后回写远端（防 rm 丢失）
        console.warn(`⚠ [私有配置保护] 将跳过 ${f} 上传：本地 ${localCount} 条 < 现网 ${remoteCount} 条（本地种子过期，权威在部署目标侧）。`);
        console.warn('  确认要用本地覆盖请设 PUSH_FORCE_PRIVATE=1 重跑；现网内容已回填本地以防丢失。');
        fs.writeFileSync(path.join(__dirname, f), remoteContent);
        plan[f] = { action: 'restore', remoteContent };
        return planPrivateConfig(i + 1, plan, done);
      }

      const backupThen = (next) => {
        if (readErr || !remoteContent.trim() || remoteContent === localContent) return next();
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const backupPath = DATA_DIR_WIN + '/backup/' + f.replace(/\//g, '_') + '.' + ts + '.bak';
        return exec('mkdir -p ' + DATA_DIR + '/backup', () => {
          sftp.writeFile(backupPath, remoteContent, (err3) => {
            if (err3) console.warn(`⚠ ${f} 现网备份失败（继续上传）:`, err3.message);
            else console.log(`✓ ${f} 现网版本已备份: ${backupPath}`);
            next();
          });
        });
      };

      backupThen(() => {
        plan[f] = { action: 'upload' };
        planPrivateConfig(i + 1, plan, done);
      });
    });
  });
}

// 阶段二（解压之后）：按 plan 执行——upload 传本地种子；restore 把盘点到的现网内容写回去
// （代码目录被 rm -rf 全量替换过，跳过上传的文件必须显式恢复，否则现网权威数据丢失）
function applyPrivateConfig(i, plan, done) {
  const files = PRIVATE_CONFIG_FILES.filter((f) => fs.existsSync(path.join(__dirname, f)));
  if (i >= files.length) {
    console.log('✓ 私有配置处理完毕（成员名单权威在部署目标侧，push 仅在种子不落后时上传）');
    return done();
  }
  const f = files[i];
  const entry = plan[f] || { action: 'upload' };
  conn.sftp((err, sftp) => {
    if (err) {
      console.error('SFTP 失败:', err.message);
      conn.end();
      process.exit(1);
    }
    const remotePath = REMOTE_DIR_WIN + '/' + f;
    const mkdirThen = (next) => exec('mkdir -p ' + REMOTE_DIR + '/' + path.dirname(f), next);
    if (entry.action === 'restore') {
      return mkdirThen(() => {
        sftp.writeFile(remotePath, entry.remoteContent, (err2) => {
          if (err2) {
            console.error(`${f} 现网内容回写失败:`, err2.message);
            conn.end();
            process.exit(1);
          }
          console.log(`✓ ${f} 已按现网版本恢复（本地种子过期，未覆盖）`);
          applyPrivateConfig(i + 1, plan, done);
        });
      });
    }
    return mkdirThen(() => {
      sftp.fastPut(path.join(__dirname, f), remotePath, (err2) => {
        if (err2) {
          console.error(`${f} 上传失败:`, err2.message);
          conn.end();
          process.exit(1);
        }
        console.log(`✓ ${f} 已上传`);
        applyPrivateConfig(i + 1, plan, done);
      });
    });
  });
}

// ============ [4/4] 重启服务 ============
function restart() {
  console.log('\n========== [4/4] 重启服务 ==========');
  // 只收出站 API/webhook + 本机回环 HTTP 窗口，无需开放防火墙端口
  // PATH 显式带 node 目录：小电脑 SSH 非交互 shell 默认 PATH 不含 node/pm2（同 npmInstall）
  const cmd = 'export PATH=/c/tools/node-v22.10.0-win-x64:/mingw64/bin:/usr/local/bin:/usr/bin:/bin:$PATH; '
    + 'pm2 restart ' + PM2_NAME + ' --update-env 2>/dev/null || pm2 start ' + REMOTE_DIR + '/src/index.js --name ' + PM2_NAME + '; pm2 save';
  exec(cmd, () => {
    console.log('\n✅ 部署完成，服务状态：');
    conn.exec('export PATH=/c/tools/node-v22.10.0-win-x64:$PATH; pm2 list', (err, stream) => {
      if (err) { conn.end(); return; }
      stream.on('data', (d) => process.stdout.write(d.toString()));
      stream.on('close', () => conn.end());
    });
  });
}

console.log('正在连接部署目标（NAS_* 变量，语义=部署目标）...');
conn.connect(nasConfig);
