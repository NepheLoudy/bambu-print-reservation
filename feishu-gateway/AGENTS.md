# feishu-gateway 开发边界（防需求发错会话）

## 本项目职能
飞书事件接入层：共用应用（cli_aac7e6f6cdf8dcc0）的**唯一长连接**持有者；消息事件按 `MESSAGE_ROUTES` 规则路由到各机器人 `/api/feishu/event`；`/命令` 解析后转发 `/api/chat/command` 并代回复；表格事件广播（legacy 结构转换）；事件去重；新机器人接入登记（`CONSUMERS`）。


## 顶层规则与交互性（每次开工先读）

本会话是独立工作区，**不会自动加载顶层规则**——开工前先读一遍 `../AGENTS.md`（顶层职能总表 + 架构铁律）；涉及消息路由、@识别、指令转发的改动，再读顶层 `.agents/skills/qianli-chat-architecture/SKILL.md`。

与其它机器人/服务的交互契约（改接口前先对顶层文档）：
- 五个机器人**共用同一个飞书应用**（网关自身不消费事件，下游消费者登记为其中四个：hub/approval/bambu/ticket）；长连接只属于 feishu-gateway，各机器人事件一律 `FEISHU_USE_LONG_CONNECTION=false`，由网关转发到本项目的 `POST /api/feishu/event`；
- 指令交互契约：`POST /api/chat/command`，入参 `{command, args}`，回 `{reply}`（回复由调用方——网关或 hub——代发）；
- 群播报走群自定义机器人 webhook，对话回复走飞书 IM API；
- 部署一律项目内 `npm run push "说明"`（规则见 qianli-deploy skill 与顶层 AGENTS.md），NAS 凭证在 .env 的 NAS_*；
- 通用坑：@识别要兼容 mentioned_type='bot'；多维表格字段值先过 fieldText 类工具再拼字符串；express.json 建议放宽到 2mb。

顶层职能速览（需求跨项目即停，走上方"发错时的规定动作"）：
ticket-bot=工单域｜approval-bot=财务审批｜project-management-robot=对话枢纽+DDL｜bambu-print-reservation=打印预约｜feishu-gateway=事件接入｜qianli 顶层=部署/架构/整理。

## 只管这些（归属信号）
事件被抢、指令时灵时不灵、@机器人无响应（跨项目排查）、消息路由规则、新机器人接入网关、消费者登记、事件结构/去重。

## 不管这些（发错信号 → 立即停手）
- **指令/播报的具体业务逻辑**（工单怎么播、催办催什么、DDL 报什么）→ 对应业务机器人会话（ticket-bot / approval-bot / project-management-robot / bambu-print-reservation）
- **某机器人功能改造** → 对应机器人会话
- **部署链路、push.js、工作区整理** → qianli 顶层会话

## 判定口诀
"谁的业务改逻辑，谁的会话去开发；连不上、到不了、路由错，才到网关来排查。"

## 发错时的规定动作
用户需求落在"不管这些"时，必须：
1. **停止开发，不写任何代码、不改任何文件**；
2. 回复：「⚠️ 这个需求属于 <X 项目>（负责 <…>），当前会话是 feishu-gateway——你可能发错会话了。请到对应会话发送；如确认要在网关做（如改路由规则），请回复"就在本项目做"。」
3. 用户明确确认后才继续；模糊回答时再确认一次。
4. 边界模糊时：先列分工与建议归属，等用户指定后再动手。
