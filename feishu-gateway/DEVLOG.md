# DEVLOG · feishu-gateway（统一飞书事件网关）

版本隔离单位：一次 `npm run push`（= 一次 git 提交 + 一次部署）。本项目无独立远端，push.js 只暂存 `feishu-gateway/` 路径提交进顶层 monorepo——版本即顶层仓库中触碰本路径的提交。v1~v8 于 2026-09-04 回溯编号，此后每次 push 在文末追加新版本（规则见顶层 [AGENTS.md](../AGENTS.md)）。

当前最新：**v10**（2026-09-05，哈希见文末 v10 条目）。

## 阶段五 · 开发历史建档（2026-09-04）

### v9 · 2026-09-04 · `7207c20` · docs
**新增 DEVLOG 开发历史 v1~v8（按 push 回溯建档）**
- 本 DEVLOG 诞生：v1~v8 按顶层仓库中触碰本路径的提交回溯编号，此后每次 push 追加一版（规则见顶层 AGENTS.md「开发日志（DEVLOG）」节）。

## 阶段一 · 网关诞生（2026-09-01）

### v1 · 2026-09-01 · `55fb002` · feat
**新增 feishu-gateway 统一飞书事件网关；bambu 部署脚本与密钥分离**
- 独占飞书应用唯一长连接，向各机器人广播事件；首版含 dispatch.js 路由、CONSUMERS 消费者登记、smoke-test 与 NAS e2e 测试。

## 阶段二 · 路由试错与铁律回归（2026-09-01）

### v2 · 2026-09-01 · `2c81f94` · fix
**审批群内 / 指令直接路由 approval-bot（无需 @，网关代回复）**

### v3 · 2026-09-01 · `bdfc053` · fix
**isMentioned 兼容 mentioned_type=bot（真实事件中机器人类型为 bot 而非 app）**

### v4 · 2026-09-01 · `49fb4b7` · fix
**遵循架构铁律——撤销审批群消息直连路由，对话统一走 hub（对话型机器人）**
- v2 的直连方案上线数小时即撤销：专项机器人不经网关直接回复对话，统一改由 hub 分发 `/approval-*`。

## 阶段三 · 会话边界文档（2026-09-02 ~ 09-03）

### v5 · 2026-09-02 · `dd9d961` · docs
**增加项目职能边界声明（发错会话防护，需求错位即提醒停手）**

### v6 · 2026-09-03 · `2864005` · docs
**AGENTS.md 增加「顶层规则与交互性」段（独立会话内联交互契约，开工先读顶层总表）**

## 阶段四 · 审批事件分发直连（2026-09-04）

### v7 · 2026-09-04 · `44b0463` · feat
**分发改为官方审批实例事件直连（approval_instance 秒级）**
- 不再依赖多维表格事件轮询播审批，直接订阅官方 `approval_instance` 事件转发 bambu/ticket，秒级到达。

### v8 · 2026-09-04 · `5260175` · feat
**网关审批事件双通道——approval_instance + approval_task 转发 bambu/ticket（自动审批与工单接单联动）**
- 双通道：实例级（状态变化）+ 任务级（某人维度），支撑 bambu 自动审批与 ticket-bot 接单自动通过两条联动链路。

## 阶段六 · 审批事件断链修复（2026-09-05）

### v10 · 2026-09-05 · `待回填` · fix
**网关 EVENT_TYPES 补订阅 approval_instance/approval_task——修复审批事件双通道生产断链**
- 排查全链路时发现：v7/v8 上线的审批事件双通道在生产从未生效——网关 `.env` 的 `EVENT_TYPES` 覆盖值仍只有 `im.message.receive_v1,drive.file.bitable_record_changed_v1`，把 config.js 默认值里的两个审批事件类型盖掉了；网关日志证实从未转发过任何审批事件，bambu 打印自动审批与 ticket-bot 接单自动通过两条联动因此静默失效。
- 修复：本地 `.env`（部署源头，push 原样覆盖 NAS）与 `.env.example` 的 `EVENT_TYPES` 补上 `approval_instance,approval_task`。代码零改动（config.js 默认值本就含双通道）。
- 踩坑：`.env` 不进 git 无历史可查，配置回退只能靠线上比对发现；典型"改了代码默认值但忘了同步 .env 覆盖值"事故，与 qianli-deploy skill 记载的"本地残留旧配置被推上去"是同一事故模式。
- 备注：hash 由下一提交回填（同 37a59aa 先例）。
