---
name: qianli-chat-architecture
description: qianli 项目群飞书机器人架构铁律——除工单接单监听外，所有对话/指令逻辑统一由对话型机器人（爆米花机-对话型 / knowledge-tracker）触发与分发。凡涉及消息路由、@识别、指令转发、新增群机器人能力的改动，必须先加载本 skill 确认架构约束。
---

# qianli 飞书机器人对话架构铁律

用户明确要求（多次强调）：**除了工单那个接单监听外，所有对话逻辑都由对话型机器人触发。**

## 架构总览

```
飞书事件（唯一长连接）
   │
   ▼
feishu-gateway（NAS, :3010）── 持有共用应用的唯一长连接，统一接收所有事件
   │
   ├─ 消息事件（im.message.receive_v1）
   │    ├─ 工单域例外：/ticket-* 指令、含「接单」且@机器人 → ticket-bot（:3003, event 模式）
   │    └─ 其余全部 → hub = 对话型机器人（knowledge-tracker / 爆米花机-对话型, :3000）
   │                      │
   │                      ├─ /approval-* → 转发 approval-bot（:3002, /api/chat/command）
   │                      ├─ /print-*    → 转发 bambu（:3001, /api/chat/command）
   │                      └─ 普通对话 / 关键词 / DDL / /help → 对话型自行处理
   │
   ├─ 审批域事件（approval_instance / approval_task）→ 转发 bambu（打印审批联动）/ ticket-bot（接单→审批任务自动通过）
   └─ 多维表格事件（drive.file.bitable_record_changed_v1）→ 广播给各消费者自行过滤
```

## 铁律（做任何改动前逐条核对）

1. **对话唯一入口是对话型机器人**（爆米花机-对话型 / knowledge-tracker / hub）。
   所有 @、私聊、普通消息、/help 及各业务指令，一律由它接收、判断并分发。
2. **唯一的例外是工单接单监听**：ticket-bot 处理工单域消息（@机器人 + 「接单」
   的接单确认、/ticket-* 指令），这是用户钦定的例外。
3. **专项机器人（approval-bot、bambu 等）不得自行消费消息事件或直接回复对话**。
   它们只暴露 `POST /api/chat/command`（`{command, args}` → `{reply}`，bambu 同款
   契约），由对话型机器人转发调用。其内部 chatService 仅保留用于本地调试。
4. **定时播报不算对话**：各机器人自己的定时播报（webhook 推送）不受此铁律限制
   （如 approval-bot 的财务催办周报、每日提醒）。
5. **不要在网关为业务机器人添加消息直连路由**（此前加过"审批群指令直达
   approval-bot"的路由，已按用户要求撤销）。网关路由表只允许 hub 默认目标 +
   工单域例外。

## 关键事实（踩过的坑）

- 共用飞书应用机器人 mention 事件的真实字段：
  `{mentioned_type: "bot", name: "爆米花机-对话型"}` —— **类型是 "bot" 不是
  "app"；名称是连字符「-对话型」不是下划线**。@ 识别必须兼容
  `mentioned_type ∈ {app, bot}` + 名称匹配 + `id === 'self'` 多信号。
- 飞书对同一应用的多个长连接随机分发事件——所以只有网关持有一条长连接，
  其他服务一律 `FEISHU_USE_LONG_CONNECTION=false`（通过 HTTP 接收网关转发）。
- 群聊对话默认要求 @机器人，这是对话型机器人的门禁，属正常行为。

## 相关代码位置

- 网关路由表：`feishu-gateway/src/config.js`（DEFAULT_MESSAGE_ROUTES、DEFAULT_CONSUMERS）
- 对话型分发逻辑：`ticket-pm/project-management-robot/server/src/services/chatService.js`
  （isApprovalGroup / handleApprovalCommand / handlePrintCommand）
- 接单自动通过审批任务：`ticket-pm/ticket-bot/src/services/approvalLinkService.js`（approval_task 按审批人白名单缓存 + 接单后以审批人身份调同意 API）
- approval-bot 指令端点：`approval-bot/src/index.js`（POST /api/chat/command）
- 工单例外：`ticket-pm/ticket-bot/src/services/chatService.js`（IGNORE_CHAT_IDS 跳过审批群）
