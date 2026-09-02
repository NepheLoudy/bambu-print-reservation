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

# 项目职能划分总表（防需求发错会话）

每个项目目录有自己的 `AGENTS.md` 边界声明；各会话收到需求先对号入座，**发现发错立即提醒并停止开发**。

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
- 部署一律 `npm run push`（见 `.agents/skills/qianli-deploy/SKILL.md`），部署失败排查放顶层会话。
