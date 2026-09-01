---
name: qianli-deploy
description: qianli 工作区飞书机器人项目的统一部署与开发链路。凡是要部署/推送/上线 qianli 下的机器人项目（feishu-gateway、ticket-bot、approval-bot、project-management-robot、bambu-print-reservation）、改完代码要传到 NAS、排查部署失败、或新建机器人项目接入部署时使用——即使用户只说"推上去"、"发一下"、"部署一下"也要用本 skill，不要手写 ssh/scp 命令。
---

# qianli 机器人统一部署链路

五个飞书项目全部用同一条链路：**项目根目录 `npm run push "提交说明"` 一条命令完成 提交→推送→部署→上传 .env→重启**。不要手写 SSH/SCP 部署命令，不要恢复任何独立 deploy 脚本。

## 项目清单

| 项目 | NAS 路径 | pm2 进程 | 端口 | 角色 |
| --- | --- | --- | --- | --- |
| feishu-gateway | /opt/feishu-gateway | feishu-gateway | 3010 | 唯一长连接网关，事件路由 |
| project-management-robot | /opt/knowledge-tracker | knowledge-tracker | 3000 | 对话枢纽（hub），DDL 播报 |
| approval-bot | /opt/approval-bot | approval-bot | 3002 | 财务审批（纯定时催办） |
| ticket-bot | /opt/ticket-bot | ticket-bot | 3003 | 工单播报/接单/分桶 API |
| bambu-print-reservation | /opt/bambu-print-server | bambu-print-server | 3001 | 打印预约（尚未部署到 NAS） |

NAS：10.253.33.233，SSH 端口 8500，用户 qianli。凭证在各项目 `.env` 的 `NAS_HOST/NAS_PORT/NAS_USER/NAS_PASSWORD`，不在脚本里。

## 部署流程（唯一入口）

```
cd <项目目录>
npm run push "feat: 说明"
```

push.js 依次做：① git add -A + commit + push（本地推 GitHub 失败不阻断）→ ② NAS 同步代码（git fetch 失败**自动降级 SFTP 打包直传**，NAS 访问不了 GitHub 是常态）→ ③ 上传本地 `.env` 到 NAS（覆盖）→ ④ npm install + pm2 restart。跑完必须看输出里的 ⚠ 行确认走了哪条路径。

例外：`feishu-gateway` 和 `bambu-print-reservation` 在顶层 monorepo 内没有独立远端——gateway 的 push.js 只暂存 `feishu-gateway/` 路径，bambu 纯 SFTP 无 git 步骤。

## .env 规则（最重要，出过事故）

- `.env` 永不进 git（.gitignore 已挡），飞书密钥和 NAS 凭证只存在于本地 `.env` 与 NAS `.env` 两处。
- **本地 `.env` 就是部署源头：每次 push 都会原样覆盖 NAS 的 .env。** 所以部署前必须确认本地 `.env` 与 NAS 线上意图一致——拿不准就先下载 NAS 的 .env diff 一下（曾发生过：本地残留 `FEISHU_USE_LONG_CONNECTION=true` 被推上去，差点恢复双长连接抢事件）。
- 改线上配置的正确姿势：改本地 `.env` → `npm run push`。不要直接 sed NAS 的 .env（会被下次部署覆盖回去）。
- 新增配置项：同步改 `.env.example`（提交）+ 各环境 `.env`（不提交）。

## NAS 与隔离红线

- push.js 已内置 SFTP 兜底，不要因为 "NAS 拉不到 GitHub" 去修 NAS 的网络或配代理。
- 一切写入只进 `/opt/<项目>` 目录；不开防火墙端口（机器人只靠飞书出站长连接 + 本机回环）；不动路由器；不动 NAS 系统服务；pm2 只操作表里的五个进程。
- 临时诊断脚本连接 NAS 用 ssh2 + `.env` 凭证，带 `readyTimeout` 和 `keepaliveInterval`；SSH 会话偶发挂起，重试即可，不要改 NAS 配置去"修"它。

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
3. 启动日志关键行：网关 `ws client ready`；机器人 `已配置为不使用长连接模式，跳过启动`；pm-robot `下次执行时间`；
4. 功能用 dry-run 接口，不真发群：approval-bot `POST /api/bot/test-broadcast {"dryRun":true}`，ticket-bot `GET /api/tickets/unclosed-by-group`；
5. 群内真实验证交给定时任务自然触发，次日看日志。

## 已知坑速查

| 症状 | 原因与解法 |
| --- | --- |
| tar 报 `Cannot connect to C:` | Windows GNU tar 把 `C:` 当主机名，加 `--force-local` 或用相对名 + cwd |
| 机器人读不到 .env | dotenv 必须显式 `path: path.join(__dirname, '..', '.env')`——pm2 启动的 cwd 不是项目目录 |
| 部署后起来又挂 | 看 pm2 error 日志；常见是新代码引了 package.json 没有的依赖（如 dayjs 事故），补依赖重新 push |
| 网关转发大消息 413 | express.json 默认 100kb，pm-robot 已放宽到 2mb，新项目照做 |
| webhook 播报某群收到两张卡 | 重试重发；参照 pm-robot cron 的 deliveredGroups 模式（重试只补失败群） |
| 同一应用出现第二条长连接 | 立即查该机器人 `.env` 的 FEISHU_USE_LONG_CONNECTION 并改 false 重新 push |
| push 后配置"自己变回去" | 确认 `.github/workflows/deploy.yml` 类旧 Actions 部署已删除（各仓库已拆，别恢复） |

## 新增一个机器人项目

照 feishu-gateway/README.md 的接入清单做：独立端口 + `/api/feishu/event` + `FEISHU_USE_LONG_CONNECTION=false` → 网关 CONSUMERS 登记 → 复制任一项目的 push.js 改路径/远端 → `.env` 按 `.env.example` 备齐（含 NAS_*）→ 首次 `npm run push`。
