# DEVLOG · feishu-gateway（统一飞书事件网关）

版本隔离单位：一次 `npm run push`（= 一次 git 提交 + 一次部署）。本项目无独立远端，push.js 只暂存 `feishu-gateway/` 路径提交进顶层 monorepo——版本即顶层仓库中触碰本路径的提交。v1~v8 于 2026-09-04 回溯编号，此后每次 push 在文末追加新版本（规则见顶层 [AGENTS.md](../AGENTS.md)）。

当前最新：**v15**（2026-09-12，顶层归档哈希随顶层 v47 回填）。

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

### v10 · 2026-09-05 · `b61269c` · fix
**网关 EVENT_TYPES 补订阅 approval_instance/approval_task——修复审批事件双通道生产断链**
- 排查全链路时发现：v7/v8 上线的审批事件双通道在生产从未生效——网关 `.env` 的 `EVENT_TYPES` 覆盖值仍只有 `im.message.receive_v1,drive.file.bitable_record_changed_v1`，把 config.js 默认值里的两个审批事件类型盖掉了；网关日志证实从未转发过任何审批事件，bambu 打印自动审批与 ticket-bot 接单自动通过两条联动因此静默失效。
- 修复：本地 `.env`（部署源头，push 原样覆盖 NAS）与 `.env.example` 的 `EVENT_TYPES` 补上 `approval_instance,approval_task`。代码零改动（config.js 默认值本就含双通道）。
- 踩坑：`.env` 不进 git 无历史可查，配置回退只能靠线上比对发现；典型"改了代码默认值但忘了同步 .env 覆盖值"事故，与 qianli-deploy skill 记载的"本地残留旧配置被推上去"是同一事故模式。
- 备注：hash 由下一提交回填（同 37a59aa 先例）。

## 阶段七 · 工单私聊确认路由（2026-09-05）

### v11 · 2026-09-05 · `cebb767` · feat
**路由匹配器支持 chatType + 新增 p2p+接单 → ticket 规则（指定负责人私聊确认链路）+ 路由日志补 chat_id**
- 配套 ticket-bot v48「24h 未确认私聊追问」：负责人私聊回复「接单」需路由到 ticket-bot，而私聊无 @，原 mention 规则够不着——匹配器新增 `chatType` 维度（一行），默认路由表加 `{contains:'接单', chatType:'p2p'} → ticket`（仍属工单域例外，hub 默认目标不变）。
- 路由命中日志补 `chat=` 字段：排查「机械组接单未触发回执」时发现路由日志不带群标识无法定位来源群，一并补上。
- 排查结论备忘：网关日志从未出现任何含「接单」的消息（含 hub 兜底），机械组漏回执系旧卡片引导 @爆米花机_自动型（webhook 机器人无事件）所致，非网关路由问题；新卡片引导 @对话型后依赖应用机器人在群内（运维事项）。

## 阶段八 · 全项目审查修复批次（2026-09-06）

### v12 · 2026-09-06 · 顶层归档 `dbbdaf5` · fix
**全项目审查修复：长连接启动失败不再杀进程 + 健康检查如实上报 + 路由文档对齐**
- wsClient.start() 加 catch + 全局 unhandledRejection 兜底：start() 返回 Promise，原调用既不 await 也不 catch——连接失败（凭证错误/网络故障）会以 unhandled rejection 直接杀死唯一长连接进程（Node≥15 默认行为）；同时 /api/health 的 ws 字段原来只反映「已发起启动」永远假绿 running，现在如实返回 error 状态，部署验证不再被误导。
- deliverTo：command 规则命中但消费者未配指令端点时打告警日志（原先静默降级为原始事件转发，配置错误无从察觉）；express.json 放宽 2mb（与 AGENTS 建议一致，防大 bitable 帧回放 413）；EVENT_TYPES 重复 parseList 清理；nas-e2e-test.js 中 pm-robot 目录重组后的失效路径修正。
- 文档对齐：README 路由表改为实际默认规则（/ticket 前缀、@+接单、p2p+接单 → ticket，其余 hub——原文档里的 /approval、/print 直连规则 v4 撤销后未回改），匹配条件补 chatType，审批事件一节与环境变量一览补全（EVENT_TYPES 改动需同步 NAS .env 的教训入册）；.env.example 修 hub 端口 2174→3000（照抄会导致 hub 全部消息投递失败）、补 APPROVAL_TARGETS、删无代码读取的 FEISHU_ENCRYPT_KEY；AGENTS.md 消费者口径澄清（五机器人共用应用，下游登记四个）。

## 阶段九 · 例行维护（2026-09-06）

### v13 · 2026-09-06 · 顶层归档 `b64bf8b` · docs
**全仓例行 debug 扫描——网关零代码缺陷，文档纠偏三条**
- README 部署步骤幽灵脚本修正：`npm run deploy:sftp`（package.json 无此 script，照执行会报 missing script）→ `npm run push`。
- DEVLOG「当前最新」指针 v10 → v12（76e9daa 专项锚点回填时只补了 v12 哈希、漏改头部指针）。
- v11 条目锚点回填 `cebb767`（当时记「随本提交落地」，回填批次遗漏）。
- 代码侧结论：src/ 无可确认缺陷（EVENT_TYPES 订阅表 / 消费者登记 / .env 三方一致，v12 修复批次在位，事件去重与 deliverTo 降级路径完好）；`.env` 残留无消费者的 `FEISHU_ENCRYPT_KEY`、package.json 未用依赖 `cors` 均无害，仅记录不清（.env 是部署源头，是否清理属运维决策）。

## 阶段十 · 使用统计（2026-09-12）

### v14 · 2026-09-12 · 顶层归档 `b4aa03e` · feat
**使用统计 /api/usage——运维台「活跃看板」数据源（谁在用什么功能）**
- 新增 src/usage.js：消息事件命中路由目标后顺带计数（dispatch.js 的 routeMessage 在命中规则/走默认目标处各调一次 recordUsage，只观察不改路由，统计异常静默自愈不影响转发）。功能口径：`/` 开头取首个 token（精确到 /print-status 等指令）；工单接单监听（@/私聊+「接单」非指令文本）单独记「工单接单」；其余按私聊对话/@群对话计。
- 按天分桶保留 30 天（{total, users:{open_id:{c,last}}, feats}），落盘 usage-stats.json（60s 兜底刷新 + SIGINT 落盘）；**落盘目录必须在项目外**（部署 tar 会清空 /opt/feishu-gateway）：默认 /home/qianli/feishu-gateway-data，可 GATEWAY_DATA_DIR 覆盖，写不进时退回项目内（不入 git）。
- 成员名解析：新 open_id 首次出现时用共用应用凭证查通讯录（contact/v3/users），姓名永久缓存进统计文件；失败 24h 内不重试，展示回退 open_id。
- HTTP 端点 GET /api/usage?days=N（默认 1，最大 30）：返回 users/features/daily 聚合，运维台「使用活跃」看板消费。
- 验证：本地以空 APP_ID 起 HTTP（不连长连接）POST /api/dispatch 合成事件，计数/分桶/落盘/聚合全通过（注意 Git Bash curl -d 直写中文会 GBK 乱码，测中文路由要 --data-binary @utf8文件）；线上部署后 ws running，/api/usage 空表起步。

## 阶段十一 · 动态广场看板（2026-09-12）

### v15 · 2026-09-12 · 顶层归档（随顶层 v47，哈希待回填） · feat

**网关活跃同步多维表格——动态广场看板数据源**

- 新增 `src/bitable.js`（最小写表客户端，复用 usage 的 tenant token）与 `src/bitable-sync.js`：每 30 分钟把使用统计按**日期签名** upsert 到机器人项目看板「网关日活跃 / 网关功能使用 / 网关队员活跃」三表（日期桶无变化不写表；签名状态落 GATEWAY_DATA_DIR，重启不重写），启动即回填存量 30 天。
- 成员 open_id 优先 usage 姓名缓存，未命中查通讯录（单轮缓存，失败回退 open_id 尾号）。
- `POST /api/usage-sync/run`（`?force=1` 忽略签名重写全部）手动补数，运维台可用。
- 配置：`.env` 补 `PLAZA_BITABLE_APP_TOKEN/DAILY_TABLE/FEATURE_TABLE/MEMBER_TABLE` 四键（.env.example 同步）；建表脚本在 duty-bot `scripts/create-plaza-tables.js`（幂等）。
- 测试：`scripts/stub-test-usage-sync.js`（全量 create / 签名跳过 / 变化 update / 姓名回退尾号）全过；只观察不影响转发，任何写表失败 warn 后下轮重试。
