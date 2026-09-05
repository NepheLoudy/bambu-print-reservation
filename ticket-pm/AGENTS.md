# ticket-pm · 工单 + 项目管理（对话枢纽）联动开发区

本目录把 **ticket-bot（工单域）** 与 **project-management-robot（对话枢纽 / hub）** 归拢在一起，作为 agent 开发的工作区单位——一个出工单数据与播报，一个管对话分发与 DDL 卡片，生产链路上咬合最紧（DDL 分栏取数、网关路由分工、指令门禁同款）。

**铁律不变：虽然同住一个文件夹，两个项目仍然各自完全独立**——独立 git 仓库（各有 GitHub 远端）、独立 `npm run push`、独立 DEVLOG 版本号。没有"整目录一键部署"这种东西，也永远不要引入。

## 本工作区内的职能边界（需求先对号入座）

| 项目 | 职能 | 归属信号（需求关键词） |
| --- | --- | --- |
| `ticket-bot/` | 工单域：播报到组别群、@接单确认（含指定负责人私聊接单 + 24h 追问）、接单→审批任务自动通过、搬运看板、结单提醒、未结单分桶 API | 工单、接单、结单、面向组别、指定/补充负责人 |
| `project-management-robot/` | 对话枢纽+项目管理：各群 @机器人对话与指令分发（转发 /approval-*、/print-*）、关键词监听、DDL 播报与逾期确认、会议提醒、项目表 | DDL、逾期、项目表、对话、关键词、会议、语录 |

每个项目目录有自己的详细边界声明（`ticket-bot/AGENTS.md`、`project-management-robot/AGENTS.md`），开工先读对应那份；需求落在其中一个的"不管这些"里时，**立即停手提醒**，规定动作见各项目 AGENTS.md。两个项目都要改的 = 联动需求：先列出两边的改动点与分工，确认后再动手。

## 两项目联动契约（本目录存在的理由，改接口前逐条核对）

1. **DDL 卡"未结单工单分栏"是两项目间唯一的直接调用**：pm-robot 的 DDL 卡调 ticket-bot `GET /api/tickets/unclosed-by-group` 取数（pm-robot 侧带 10s 超时降级）。**数据口径、负责人取值、分桶规则 → ticket-bot**（`src/services/unclosedService.js`）；**分栏展示样式、卡片其它栏目 → pm-robot**。改 API 出入参必须两边同批动。
2. **网关路由分工互斥**：ticket-bot 只做工单域例外（`/ticket-*` 指令、@机器人+「接单」、p2p+接单私聊确认）；hub（pm-robot）接其余全部消息并转发 `/approval-*`、`/print-*`。改路由时，两项目 chatService 的群门禁/`IGNORE_CHAT_IDS` 要与网关路由表一起核对，别只改一头。
3. **指令门禁同套规则**：指令仅群内触发、私聊白名单（`P2P_COMMAND_OPEN_IDS`/`P2P_COMMAND_CHAT_IDS`）两项目同款，改门禁逻辑两边同步。
4. **播报卡互不越界**：工单播报卡 → ticket-bot；DDL 卡 → pm-robot；"播报对象/@谁"跟着卡片走。
5. **事件全经 feishu-gateway**：两项目一律 `FEISHU_USE_LONG_CONNECTION=false`，收 `POST /api/feishu/event` 转发；hub 转发业务指令走 `POST /api/chat/command` 契约。审批（approval-bot）、打印（bambu）不在本工作区，它们的指令只是被 hub 转发。

## 全局规则指针（本会话不会自动加载，开工先读）

- 顶层 `../../AGENTS.md`：架构铁律、DEVLOG 每 push 一版规则、全项目职能总表；
- 消息路由/@识别/指令转发改动：先读 `../../.agents/skills/qianli-chat-architecture/SKILL.md`；
- 部署规则：`../../.agents/skills/qianli-deploy/SKILL.md`；
- 审批（approval-bot）、打印（bambu-print-reservation）、网关（feishu-gateway）的需求不归本工作区，回顶层总表对号。

## 部署与版本记录（依旧各自分立）

```
cd ticket-bot 或 project-management-robot   # 项目目录内
npm run push "feat: 说明"                    # 提交→推送→NAS 部署→重启，一条命令
```

- 同批联动改动：**各项目 DEVLOG.md 各记一版**（vN 各自递增），顶层 `../../DEVLOG.md` 另记一条联动摘要；
- 改 `.env` 配置项时同步更新各自 `.env.example`（提交）与本地 `.env`（不提交，push 时覆盖 NAS）；
- 联动改动的部署顺序：先网关/订阅相关（若有），再 ticket-bot、pm-robot；部署后按 qianli-deploy skill 验证清单过一遍（两进程 online + health 200 + dry-run：ticket-bot `GET /api/tickets/unclosed-by-group`）。
