# qianli 项目群 · 飞书机器人架构铁律

**除工单接单监听外，所有对话逻辑都由对话型机器人触发**（爆米花机-对话型 / knowledge-tracker / hub）。

- 消息事件统一经 feishu-gateway（唯一长连接）→ 对话型机器人（hub）判断分发；
- 对话型机器人把业务指令转发给专项服务的 `POST /api/chat/command`
  （/approval-* → approval-bot :3002，/print-* → bambu :3001）；
- **唯一例外**：工单域（@机器人+「接单」的接单确认、/ticket-* 指令）由 ticket-bot 处理；
- 专项机器人**不得**自行消费消息事件、直接回复对话，也不要在网关为它们加消息直连路由；
- 各机器人自己的**定时播报**（webhook）不受此限制。

详细规则与踩坑记录见 skill：`.agents/skills/qianli-chat-architecture/SKILL.md`
（涉及消息路由、@识别、指令转发的改动，先读它）。

# 开发日志（DEVLOG）——每次 push 记一版

每个项目（含 qianli 顶层工作区）根目录维护 `DEVLOG.md` 开发历史，**版本隔离单位 = 一次 `npm run push`（即一次 git 提交 + 一次部署）**。

- 任何一次 push（feat / fix / docs / chore 都算）完成时，必须在本项目 `DEVLOG.md` **文末追加**一节：
  `## vN · YYYY-MM-DD · <提交哈希> · <类型>`，正文为提交说明原文 + 本次实际改动要点（改了什么、影响面、踩坑）；
- vN 只增不复用；revert/回滚也是一次 push，照常记 vN 并注明回退对象；merge 提交不单独占版本号（并入相邻条目说明）；
- 多项目同批联动改动：各项目 DEVLOG 各记一条，顶层 `DEVLOG.md` 另记一条联动摘要；
- 新条目一律追加在文件末尾（最新在最下），历史条目不改写；
- bambu-print-reservation 的 push 无 git 步骤（纯 SFTP），版本锚点取顶层仓库中该路径的归档提交；
- 历史起点：各仓库 v1~vN 已于 2026-09-04 按提交历史回溯编号完毕，后续从当前最新版本续增。

# 项目职能划分总表（防需求发错会话）

每个项目目录有自己的 `AGENTS.md` 边界声明；各会话收到需求先对号入座，**发现发错立即提醒并停止开发**。
**ticket-bot 与 project-management-robot 已归拢到 `ticket-pm/`**（工单+对话枢纽/项目管理联动开发区，该目录有自己的 `AGENTS.md`，内含两项目联动契约）；两项目的 git、push、DEVLOG 版本仍**各自分立**，没有整目录部署；approval-bot、feishu-gateway、bambu-print-reservation 仍在本仓库根目录。

| 项目（会话） | 职能 | 归属信号（需求关键词） |
| --- | --- | --- |
| ticket-bot | 工单域：播报到组别群、@接单确认、搬运看板、结单提醒、未结单按负责人组别分桶 API | 工单、接单、结单、面向组别、指定/补充负责人 |
| approval-bot | 财务审批域：审批群 `/approval-*`、催办周报（发票/报销单/转账）、每日待审批提醒 | 审批、发票、报销、转账、财务、采购 |
| project-management-robot | 对话枢纽+项目管理：各群 @对话与指令分发、关键词、DDL 播报与逾期确认、会议提醒、项目表 | DDL、逾期、项目表、对话、关键词、会议、语录 |
| bambu-print-reservation | 打印预约域：`/print-*`、预约审批、打印机控制 | 打印、预约、打印机、Bambu |
| feishu-gateway | 事件接入层：唯一长连接、消息路由规则、表格事件广播、消费者登记 | 事件被抢、指令没到、@无响应（跨项目）、接入新机器人 |
| qianli 顶层 | 跨项目：部署链路 push.js、架构、工作区整理、多项目联调 | 部署、推送、架构、整理 |

**易混裁定**：
- DDL 卡片"未结单工单分栏"的**数据口径/负责人取值** → ticket-bot；分栏**展示样式/卡片其它栏** → project-management-robot；
- "播报对象/@谁" → 看哪张卡：工单播报卡 → ticket-bot，DDL 卡 → project-management-robot，催办周报 → approval-bot；
- "指令时灵时不灵/@没反应" → 先查 feishu-gateway（连接/路由/消费者），再查业务机器人；
- 工单审批联动：**接单→审批任务自动通过、审批人白名单、审批节点配置、24h 追问** → ticket-bot；**审批群指令、催办周报、催发票私聊、审批实例链接** → approval-bot；
- 工单×项目管理联动：DDL 分栏取数是 pm-robot 调 ticket-bot 的 HTTP API（`unclosed-by-group`），改出入参两边同批；两项目同住 `ticket-pm/`，联动契约见 `ticket-pm/AGENTS.md`；
- approval_instance / approval_task 审批事件"收不到/重复" → 先查 feishu-gateway 的 EVENT_TYPES 订阅与消费者登记（同"指令时灵时不灵"规则）；
- 部署一律 `npm run push`（见 `.agents/skills/qianli-deploy/SKILL.md`），部署失败排查放顶层会话。

# 顶层非项目目录（勿与现役项目混淆）

- `archive/`：历史归档。`archive/project-configs/` 存有 approval-bot / bambu-print-server / knowledge-tracker 的旧 `.env` 备份（**已被顶层 git 跟踪，密钥应视为已泄露、待轮换**；勿把新配置备份进去）；`widget-*.json` 是旧小组件配置存档。
- `tools/`：与飞书机器人业务无关的独立工具（`rm-battlescope` 为 RoboMaster 赛事数据分析工具，自带 README 与依赖）。
- `sop/`：SOP 静态页（`site-sop-planet` 带 Windows 一键部署脚本；`sop-misc` 为散页 HTML）。需求落在这些目录时先与用户确认再动。
