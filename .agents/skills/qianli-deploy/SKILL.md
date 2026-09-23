---
name: qianli-deploy
description: qianli 工作区飞书机器人项目的统一部署与开发链路。凡是要部署/推送/上线 qianli 下的机器人项目（feishu-gateway、ticket-bot、approval-bot、project-management-robot、duty-bot、bambu-print-reservation）、改完代码要传到部署目标、排查部署失败、或新建机器人项目接入部署时使用——即使用户只说"推上去"、"发一下"、"部署一下"也要用本 skill，不要手写 ssh/scp 命令。
---

# qianli 机器人统一部署链路

七个项目（六个飞书 + 一个企业微信考勤播报）共用同一条链路口径：**项目根目录 `npm run push "提交说明"` 一条命令完成 提交→推送→部署→上传 .env→重启**。不要手写 SSH/SCP 部署命令，不要恢复任何独立 deploy 脚本。（实现形态有三种：approval-bot / pm-robot / ticket-bot 独立仓库 git push + 部署目标同步；gateway 只暂存自身路径推顶层远端、部署走 SFTP；bambu 纯 SFTP 无 git。）

> 术语约定：本文与各文档出现的「NAS」多为 2026-09-14 迁移前的历史称呼，**现部署目标=小电脑 DESKTOP-FE1MIGI**；`NAS_*` 配置键沿用不改（语义=部署目标），新写的文档/代码不要再造 NAS 称呼。

## 项目清单

| 项目 | 部署目标路径 | pm2 进程 | 端口 | 角色 |
| --- | --- | --- | --- | --- |
| feishu-gateway | /c/qianli/opt/feishu-gateway | feishu-gateway | 3010 | 唯一长连接网关，事件路由 |
| project-management-robot | /c/qianli/opt/knowledge-tracker | knowledge-tracker | 3000 | 对话枢纽（hub），DDL 播报 |
| approval-bot | /c/qianli/opt/approval-bot | approval-bot | 3002 | 财务审批（纯定时催办） |
| ticket-bot | /c/qianli/opt/ticket-bot | ticket-bot | 3003 | 工单播报/接单/分桶 API |
| duty-bot | /c/qianli/opt/duty-bot | duty-bot | 3006 | 值日域：排班/值日助手/管辖策略下发（独立仓，push.js 混合模式同 approval-bot） |
| bambu-print-reservation | /c/qianli/opt/bambu-print-server | bambu-print-server | 3001 | 打印预约（纯 SFTP 部署，无 git 步骤） |
| wecom-attendance-bot | /c/qianli/opt/wecom-attendance-bot | wecom-attendance | 3007 | 企业微信考勤周报（不接飞书链路，仅共用部署基建；repo:top 同 gateway，SFTP 直传） |

本地目录布局：ticket-bot 与 project-management-robot 归拢在 `ticket-pm/` 下（`ticket-pm/<项目名>`，联动契约见该目录 AGENTS.md）；approval-bot、feishu-gateway、bambu-print-reservation 在本仓库根目录。部署命令不变，仍在各自项目目录内执行。

部署目标：**小电脑 DESKTOP-FE1MIGI**（192.168.31.57，SSH 22，用户 mechax；Windows + PortableGit + node v22.10.0 + pm2，ssh 默认 shell = git-bash）。凭证在各项目 `.env` 的 `NAS_HOST/NAS_PORT/NAS_USER/NAS_PASSWORD`（变量名沿用，语义=部署目标，不在脚本里）。

## 部署流程（唯一入口）

```
cd <项目目录>
npm run push "feat: 说明"
```

push.js 依次做：① git add -A + commit + push（本地推 GitHub 失败不阻断）→ ② 部署目标同步代码（git fetch 失败**自动降级 SFTP 打包直传**，部署目标访问不了 GitHub 是常态）→ ③ 上传本地 `.env` 到部署目标（覆盖）→ ④ npm install + pm2 restart。跑完必须看输出里的 ⚠ 行确认走了哪条路径。

**多项目同批部署顺序**：先网关 → 再各业务机器人 → 顶层归档提交最后。注意 gateway push 的 git 步骤推的是**顶层 monorepo 远端**（origin 即 `NepheLoudy/bambu-print-reservation` 仓，历史遗留的归档远端——bambu 版本锚点也取顶层归档提交），会把已提交的顶层锚点一并推走。

**每次 push 都必须在本项目 `DEVLOG.md` 文末追加一节 `vN · 日期 · 提交哈希`（一次 push = 一版，feat/fix/docs/chore 均记，revert 也记）**，格式与细则见顶层 AGENTS.md「开发日志（DEVLOG）」节。

例外：`feishu-gateway` 和 `bambu-print-reservation` 在顶层 monorepo 内没有独立远端——gateway 的 push.js 只暂存 `feishu-gateway/` 路径，bambu 纯 SFTP 无 git 步骤。

## .env 规则（最重要，出过事故）

- `.env` 永不进 git（.gitignore 已挡）。**已知例外**：顶层 `archive/project-configs/` 里有三份历史 `.env` 备份（approval-bot / bambu-print-server / knowledge-tracker）已被顶层仓库跟踪——属于遗留问题，其中的密钥应视为已泄露处理（轮换），不要再往里加新配置，也不要把新项目的 .env 备份进去。飞书密钥和部署目标凭证的正式存放处只有本地 `.env` 与部署目标 `.env` 两处。
- **本地 `.env` 就是部署源头：每次 push 都会原样覆盖部署目标的 .env。** **例外——私有运行时配置（duty-bot members/whitelist、hub autoReplies.local.json）**：权威在部署目标侧（现=小电脑，运维台直写），push.js 已内置「先备份现网 + 本地条目少于现网即跳过并回填」守卫（`PUSH_FORCE_PRIVATE=1` 才强制覆盖），见顶层 AGENTS「运行时数据保护」； 所以部署前必须确认本地 `.env` 与部署目标线上意图一致——拿不准就先下载目标的 .env diff 一下（曾发生过：本地残留 `FEISHU_USE_LONG_CONNECTION=true` 被推上去，差点恢复双长连接抢事件）。
- 改线上配置的正确姿势：改本地 `.env` → `npm run push`。不要直接 sed 部署目标的 .env（会被下次部署覆盖回去）。
- 新增配置项：同步改 `.env.example`（提交）+ 各环境 `.env`（不提交）。

## 部署目标与隔离红线

- push.js 已内置 SFTP 兜底，不要因为 "部署目标拉不到 GitHub" 去修它的网络或配代理。
- 一切写入只进 `/c/qianli/opt/<项目>` 目录（git-bash 路径，Windows 实际路径 `C:\qianli\opt\<项目>`）；不开防火墙端口（机器人只靠飞书出站长连接 + 本机回环）；不动路由器；不动部署目标系统服务；pm2 只操作表里的七个进程。
- 临时诊断脚本连接部署目标用 ssh2 + `.env` 凭证，带 `readyTimeout` 和 `keepaliveInterval`；SSH 会话偶发挂起，重试即可，不要改目标机配置去"修"它。

## 飞书架构铁律（违反必出事）

- **共用一个飞书应用（cli_aac7e6f6cdf8dcc0），长连接只允许 feishu-gateway 一个。** 任何机器人自己的 `FEISHU_USE_LONG_CONNECTION` 必须为 false——飞书对同一应用多条长连接随机分发事件，第二条连接上线 = 全部机器人指令时灵时不灵。
- 机器人收事件：实现 `POST /api/feishu/event`，在网关 `.env` 的 `CONSUMERS` 里登记 `名称|http://localhost:端口/api/feishu/event`。
- 机器人收指令：实现 `POST /api/chat/command`（入参 `{command, args}`，回 `{reply}`，回复由调用方代发），网关按 `MESSAGE_ROUTES` 前缀规则路由。
- 真实事件的 @机器人 mention 结构是 `{mentioned_type:'bot', id:{open_id,...}, name:'爆米花机-对话型'}`——@ 检测要兼容它，不要只判 `mentioned_type==='app'` 或配置名。
- 多维表格字段值可能是富文本对象/分段数组，拼进字符串前必须走 fieldText 类工具，否则输出 `[object Object]`。
- 网关内部有事件去重；播报/重试类逻辑只补发失败的群（pm-robot cron 有现成实现）。

## 部署后验证清单

1. `pm2 ls` 目标进程 online，无 errored；
2. `curl localhost:<端口>/api/health` 返回 200（网关看 `ws:"running"`）；
3. 启动日志关键行：网关 `📡 长连接已启动（共用应用本机唯一连接）`；机器人 `已配置为不使用长连接模式，跳过启动`；pm-robot `下次执行时间`；
4. 功能用 dry-run 接口，不真发群：approval-bot `POST /api/bot/test-broadcast {"dryRun":true}`，ticket-bot `GET /api/tickets/unclosed-by-group`；
5. 群内真实验证交给定时任务自然触发，次日看日志。

## 已知坑速查

| 症状 | 原因与解法 |
| --- | --- |
| pm2 全掉（目标机重启后机器人没起） | 小电脑开机自启=计划任务 `qianli-bots-autostart`（onstart + pm2 resurrect）；旧 NAS 备件位的 systemd 单元 `pm2-qianli` 已停。恢复：小电脑 `pm2 resurrect`，之后必须 `pm2 save`。曾因无自启单元 + 重启，三个服务静默挂了一整天才被发现 |
| 运维台全红 + push 连不上 192.168.31.57:22 | 小电脑的 sshd 没启动（2026-09-14 踩过：服务其实在跑，纯属监控/部署通道断）。启用：工作区根 `enable-sshd.bat` 拷到小电脑右键管理员运行，或管理员 PowerShell `Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0.0; Set-Service sshd -StartupType Automatic; Start-Service sshd`。注意小电脑本地管理员账户远程 WMI/schtasks 会被 UAC 过滤拒绝，远程修不了只能本地跑 |
| tar 报 `Cannot connect to C:` | Windows GNU tar 把 `C:` 当主机名，加 `--force-local` 或用相对名 + cwd |
| 机器人读不到 .env | dotenv 必须显式 `path: path.join(__dirname, '..', '.env')`——pm2 启动的 cwd 不是项目目录 |
| 部署后起来又挂 | 看 pm2 error 日志；常见是新代码引了 package.json 没有的依赖（如 dayjs 事故），补依赖重新 push |
| 网关转发大消息 413 | express.json 默认 100kb，pm-robot 已放宽到 2mb，新项目照做 |
| webhook 播报某群收到两张卡 | 重试重发；参照 pm-robot cron 的 deliveredGroups 模式（重试只补失败群） |
| 同一应用出现第二条长连接 | 立即查该机器人 `.env` 的 FEISHU_USE_LONG_CONNECTION 并改 false 重新 push |
| push 后配置"自己变回去" | 确认 `.github/workflows/deploy.yml` 类旧 Actions 部署已删除（各仓库已拆，别恢复） |
| push 冲掉运维台改的名单/回答表 | 2026-09-12 事故（whitelist 18 人被本地空壳覆盖）。push.js 已有备份+守卫；如需强行覆盖设 `PUSH_FORCE_PRIVATE=1`，事后从数据备份目录可回滚（NAS 时期 `/home/qianli/<proj>-data/backup/`，小电脑侧对应目录待核实补记） |

## 新增一个机器人项目

照 feishu-gateway/README.md 的接入清单做：独立端口 + `/api/feishu/event` + `FEISHU_USE_LONG_CONNECTION=false` → 网关 CONSUMERS 登记 → 复制任一项目的 push.js 改路径/远端 → `.env` 按 `.env.example` 备齐（含 NAS_*）→ 首次 `npm run push`。
