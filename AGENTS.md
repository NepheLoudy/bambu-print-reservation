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
