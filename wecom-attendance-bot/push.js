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

/** 估算配置里的条目数（数组字段长度求和）；返回 null = JSON 损坏（不可按字节猜——
 *  此前的 content.length/100 估算会把损坏文件当「超条数现网」误触发回填/恢复，duty v40 同款修） */
function countEntries(content) {
  if (!content || !content.trim()) return 0;
  try {
    const obj = JSON.parse(content);
    const arrays = Object.values(obj).filter((v) => Array.isArray(v));
    if (arrays.length) return arrays.reduce((sum, a) => sum + a.length, 0);
    return Object.keys(obj).length;
  } catch {
    return null;
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
  // 本地私有环境覆盖（.env 上传单独走 SFTP，2026-09-27 补洞）
  '--exclude=.env.local',
  '--exclude=.env.*.local',
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
// plan 形如 { 'config/members.json': { action: 'upload'|'restore', remoteContent? } }；
// 迭代完整 PRIVATE_CONFIG_FILES（不要求本地存在，duty-bot 同款）：本地缺文件而远端有条目时
// localCount=0 → 备份 + 远端内容回填本地 + restore（否则远端名册被 rm -rf 后无人恢复）
function planPrivateConfig(i, plan, done) {
  if (i >= PRIVATE_CONFIG_FILES.length) {
    console.log('✓ 私有配置现网状态盘点完毕（备份/守卫判定前置于代码目录替换）');
    return done(plan);
  }
  const f = PRIVATE_CONFIG_FILES[i];
  conn.sftp((err, sftp) => {
    if (err) {
      console.error('SFTP 失败:', err.message);
      conn.end();
      process.exit(1);
    }
    const remotePath = REMOTE_DIR_WIN + '/' + f;
    sftp.readFile(remotePath, 'utf8', (readErr, remoteContent) => {
      if (readErr && readErr.code !== 'ENOENT' && readErr.code !== 2) {
        // 读现网失败 ≠ 现网为空：把其他错误也当「远端为空」会让备份+条数守卫整体
        // 失效（2026-09-12 duty-bot 白名单事故的变种路径）。只有 ENOENT 按空处理——注意
        // ssh2 原生 SFTP 对文件不存在抛的是数字码 2（SSH_FX_NO_SUCH_FILE，message 'No
        // such file'），不是字符串 'ENOENT'；其余错误一律中止部署，人工确认后再推。
        console.error(`[私有配置保护] 读取现网 ${f} 失败（${readErr.code || '无错误码'} ${readErr.message}），无法确认现网内容，中止部署。`);
        console.error('  请人工检查部署目标上该文件的可读性/网络后重跑；本中止不受 PUSH_FORCE_PRIVATE 影响。');
        conn.end();
        process.exit(1);
      }
      const hasLocal = fs.existsSync(path.join(__dirname, f));
      const localContent = hasLocal ? fs.readFileSync(path.join(__dirname, f), 'utf8') : '';
      const remoteCount = readErr ? 0 : countEntries(remoteContent);
      if (!readErr && remoteCount === null) {
        // 现网 JSON 损坏（2026-09-27 同 duty）：不再按字节估算条数误触发「回填本地/恢复」，
        // 直接中止部署，人工确认现网内容后再推（本中止不受 PUSH_FORCE_PRIVATE 影响）
        console.error(`[私有配置保护] 现网 ${f} JSON 损坏（解析失败），无法可靠盘点条数，中止部署。`);
        console.error('  请人工检查部署目标上该文件内容（必要时从数据目录 backup/ 恢复）后重跑。');
        conn.end();
        process.exit(1);
      }
      const localCount = countEntries(localContent);
      if (hasLocal && localCount === null) {
        console.error(`[私有配置保护] 本地 ${f} JSON 损坏（解析失败），无法可靠比对条数，中止部署。`);
        conn.end();
        process.exit(1);
      }

      if (readErr && !hasLocal) {
        // 远端没有、本地也没有：无事可做
        return planPrivateConfig(i + 1, plan, done);
      }
      if (remoteCount > localCount && process.env.PUSH_FORCE_PRIVATE !== '1') {
        // 本地种子过期（含本地缺文件）：跳过上传，且把现网内容回填本地 + 记入 plan 待 rm 后回写远端（防 rm 丢失）
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
        plan[f] = { action: hasLocal ? 'upload' : 'restore', remoteContent: hasLocal ? undefined : remoteContent };
        return planPrivateConfig(i + 1, plan, done);
      });
    });
  });
}

// 阶段二（解压之后）：按 plan 执行——upload 传本地种子；restore 把盘点到的现网内容写回去
// （代码目录被 rm -rf 全量替换过，跳过上传的文件必须显式恢复，否则现网权威数据丢失）。
// 同样迭代完整清单：plan 里没有的条目（远端本地都没有）直接跳过
function applyPrivateConfig(i, plan, done) {
  if (i >= PRIVATE_CONFIG_FILES.length) {
    console.log('✓ 私有配置处理完毕（成员名单权威在部署目标侧，push 仅在种子不落后时上传）');
    return done();
  }
  const f = PRIVATE_CONFIG_FILES[i];
  const entry = plan[f];
  if (!entry) return applyPrivateConfig(i + 1, plan, done);
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
      // 覆盖前重读二次判定（2026-09-27 同 duty）：盘点（rm -rf 前）与覆盖之间有时间窗——
      // SFTP 直传路径该文件已被 rm -rf 清掉（ENOENT → 按盘点结果直传）；期间现网若又被
      // 人工编辑（条数反超本地种子）则改恢复现网，不覆盖。
      sftp.readFile(remotePath, 'utf8', (rErr, rContent) => {
        if (!rErr) {
          const rc = countEntries(rContent);
          if (rc === null) {
            console.error(`[私有配置保护] 覆盖前重读：现网 ${f} JSON 损坏（解析失败），中止部署，请人工确认后重跑。`);
            conn.end();
            process.exit(1);
          }
          const lc = countEntries(fs.readFileSync(path.join(__dirname, f), 'utf8'));
          if (rc > lc && process.env.PUSH_FORCE_PRIVATE !== '1') {
            console.warn(`⚠ [私有配置保护] 覆盖前重读：${f} 现网 ${rc} 条 > 本地 ${lc} 条（盘点后现网又被编辑），改恢复现网版本。`);
            fs.writeFileSync(path.join(__dirname, f), rContent);
            return sftp.writeFile(remotePath, rContent, (wErr) => {
              if (wErr) {
                console.error(`${f} 现网内容回写失败:`, wErr.message);
                conn.end();
                process.exit(1);
              }
              console.log(`✓ ${f} 已按现网版本恢复（覆盖前重读判定本地种子过期）`);
              applyPrivateConfig(i + 1, plan, done);
            });
          }
        } else if (rErr.code !== 'ENOENT' && rErr.code !== 2) {
          // 重读失败 ≠ 现网为空：非 ENOENT（ssh2 对不存在文件抛数字码 2）一律中止
          console.error(`[私有配置保护] 覆盖前重读 ${f} 失败（${rErr.code || '无错误码'} ${rErr.message}），无法确认现网状态，中止部署。`);
          conn.end();
          process.exit(1);
        }
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
  });
}

// ============ [4/4] 重启服务 ============
function restart() {
  console.log('\n========== [4/4] 重启服务 ==========');
  // 只收出站 API/webhook + 本机回环 HTTP 窗口，无需开放防火墙端口
  // PATH 显式带 node 目录：小电脑 SSH 非交互 shell 默认 PATH 不含 node/pm2（同 npmInstall）
  // delete+start（而非 restart）：pm2 进程首次启动的环境快照/cwd 会随 restart 永久保留——
  // 首启曾挂在用户目录导致 cwd 异常（R13①）；应用目录内启动修正 cwd，并清掉旧环境快照
  const cmd = 'export PATH=/c/tools/node-v22.10.0-win-x64:/mingw64/bin:/usr/local/bin:/usr/bin:/bin:$PATH; '
    + 'pm2 delete ' + PM2_NAME + ' 2>/dev/null; cd ' + REMOTE_DIR + ' && pm2 start src/index.js --name ' + PM2_NAME + ' && pm2 save';
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
