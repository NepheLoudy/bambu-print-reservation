# DEVLOG · qianli 顶层工作区（monorepo）

版本隔离单位：一次 push 归档提交。本仓库远程为 `github.com/NepheLoudy/bambu-print-reservation`——它由 bambu 独立仓库演化而来（v9 起转型 monorepo），故早期版本即 bambu 的早期历史（细节见 [bambu-print-reservation/DEVLOG.md](bambu-print-reservation/DEVLOG.md)）。v1~v25 于 2026-09-04 回溯编号，此后每次 push 在文末追加新版本（规则见顶层 [AGENTS.md](AGENTS.md)）。

当前最新：**v26**（2026-09-04 `37a59aa`）。

## 阶段一 · bambu 独立仓库时期（2026-07-15 ~ 07-21）

### v1 · 2026-07-15 · `38375b3` · init
**初始化拓竹3D打印预约系统**（含 `c5d83db` GitHub 初始化提交）

### v2 · 2026-07-15 · `ee474ca` · feat
**添加NAS部署脚本和Git配置**（含 `49c2a08` 合并远端）

### v3 · 2026-07-15 · `76bd78d` · docs
**更新README添加NAS部署说明**

### v4 · 2026-07-15 · `b36cd80` · feat
**适配飞书审批多维表格字段**

### v5 · 2026-07-15 · `dc84770` · fix
**预约表只保留飞书审批原生的8个字段**

### v6 · 2026-07-15 · `f4965f7` · fix
**移除打印控制指令，明确与项目看板区分**

### v7 · 2026-07-15 · `05452f5` · fix
**修复字段引用和术语一致性问题**

### v8 · 2026-07-21 · `17f3169` · chore
**更新部署脚本和指令处理**

## 阶段二 · 工作区化（2026-08-28）

### v9 · 2026-08-28 · `4c73e14` · feat
**添加工单系统机器人 ticket-bot**
- ticket-bot 首次入仓（后迁出为独立仓库，顶层留有旧快照副本）。

### v10 · 2026-08-28 · `c886f32` · chore
**自动部署更新：仓库转型 monorepo**
- bambu 移入子目录；approval-bot / project-management-robot 以 gitlink 挂载；project-configs/*.env、SOP 站点、tools 收纳入库。

### v11 · 2026-08-28 · `efb2280` · chore
**自动部署更新（ticket-bot 部署脚本微调）**

## 阶段三 · 网关架构落地（2026-09-01）

### v12 · 2026-09-01 · `55fb002` · feat
**新增 feishu-gateway 统一飞书事件网关；bambu 部署脚本与密钥分离**
- 「唯一长连接」架构起点。

### v13 · 2026-09-01 · `2c81f94` · fix
**（网关）审批群内 / 指令直接路由 approval-bot**——v15 即撤销

### v14 · 2026-09-01 · `bdfc053` · fix
**（网关）isMentioned 兼容 mentioned_type=bot**

### v15 · 2026-09-01 · `49fb4b7` · fix
**（网关）遵循架构铁律——撤销审批群消息直连路由，对话统一走 hub**

### v16 · 2026-09-01 · `9212b38` · docs
**新增 qianli-deploy skill（统一部署链路、env 规则、架构铁律与踩坑速查）**

### v17 · 2026-09-01 · `5e61ac3` · chore
**整理工作区——核心机器人项目留根目录，其余按功能归档**
- 顶层 AGENTS.md 与 qianli-chat-architecture skill 诞生；ticket-bot 换 push.js 统一部署；project-configs 移入 archive/。

## 阶段四 · 会话治理（2026-09-02 ~ 09-03）

### v18 · 2026-09-02 · `dd9d961` · docs
**feishu-gateway 增加项目职能边界声明**

### v19 · 2026-09-02 · `147d491` · docs
**bambu-print-reservation 增加项目职能边界声明**

### v20 · 2026-09-02 · `555556d` · docs
**顶层 AGENTS.md 增加项目职能划分总表（防需求发错会话）**

### v21 · 2026-09-03 · `adfdebb` · docs
**qianli-deploy 补充 NAS 重启后 pm2 服务恢复与自启配置说明**

### v22 · 2026-09-03 · `2864005` · docs
**feishu-gateway AGENTS.md 增加「顶层规则与交互性」段**

### v23 · 2026-09-03 · `ee5ad39` · docs
**bambu-print-reservation AGENTS.md 增加「顶层规则与交互性」段**

## 阶段五 · 审批事件直连联动（2026-09-04）

### v24 · 2026-09-04 · `44b0463` · feat
**分发改为官方审批实例事件直连（approval_instance 秒级）**
- 三项目联动：网关订阅审批实例事件；bambu 新增 dispatcher/approvalService 自动分发打印；ticket-bot 同步改造。同批建立顶层 .gitignore（忽略 .zcode/）。

### v25 · 2026-09-04 · `5260175` · feat
**网关审批事件双通道——approval_instance + approval_task 转发 bambu/ticket（自动审批与工单接单联动）**
- 自动审批（bambu）与接单自动通过（ticket）两条联动链路当天打通。

## 阶段六 · DEVLOG 规则落地与全量同步（2026-09-04）

### v26 · 2026-09-04 · `37a59aa` · chore
**落地 DEVLOG 每push一版规则并同步工作区（AGENTS/skill 规则、六份开发历史建档、bambu 审批联调后续、子仓库指针）**
- 顶层 AGENTS.md 新增「开发日志（DEVLOG）」节、qianli-deploy skill 补记版要求；六份 DEVLOG.md 诞生（按各自 push 历史回溯编号）；
- 同批归档 bambu 审批联调后续 5 个 src 文件（其 SFTP 部署已先此上线，即 bambu v15）；ticket-bot 顶层快照同步至其自有仓库 v42+ 状态（含 approvalLinkService.js）；approval-bot → `5f4b8af`、pm-robot → `b57fae5` gitlink 指针更新；
- 本批各项目对应版本：pm-robot v48（`b57fae5`）、approval-bot v16（`5f4b8af`）、ticket-bot v43（`918a2d5`）、bambu v15、gateway v9（`7207c20`）；
- `tools/rm-battlescope` 为无 .gitmodules 的嵌套仓库（预存指针漂移），本次未纳入同步。

## 阶段七 · 指令边界收紧 + bambu 字段对齐（2026-09-05）

### v27 · 2026-09-05 · `5efc0ca` · feat
**指令仅群内触发（私聊白名单）多项目联动 + bambu 审批事件字段修正批次归档**
- 新规落地：指令只在群里触发并回复到对应群，私聊指令仅管理员白名单可用——ticket-bot v44（`47ac274`）与 pm-robot/hub v49（`220abba`）同套规则（`P2P_COMMAND_OPEN_IDS`/`P2P_COMMAND_CHAT_IDS`）；管理员账号=张国皓 `ou_249993fe…`（git 提交邮箱手机号经飞书 batch_get_id 反查确认）；本地 .env 已配置，push 随批上传 NAS。
- pm-robot v50（`e7b4a0b`）：会议提醒卡片识别对非 JSON content 安全降级（全量 debug 发现的 error 日志噪音，功能无损）。
- bambu v16（SFTP 已上线，归档锚点 `5efc0ca`）：审批事件字段对齐官方接口（instance_code/approval_code/open_id）、parseForm 兼容 JSON 字符串、终态扩充 REVERTED/OVERTIME_CLOSE、remainingMinutes 单位修正、分发重试上限+冷却、express.json 2mb、/api/printers/available 路由顺序修正。
- approval-bot v17（`5e3f31e`）：v16 建档条目补交；ticket-bot/pm-robot 同款「当前最新」头部残留随批补交。
- 全量 debug：bambu approval/dispatcher 两套测试、gateway smoke、全部项目语法扫描、门禁本地 9 项验证全部通过；部署后 NAS 五进程 online、健康检查 200。

## 阶段八 · 工单播报修复 + 多人接单联动批次（2026-09-05）

### v28 · 2026-09-05 · （顶层归档待做）· feat
**ticket-bot v49（`9dcbc8d`）+ pm-robot/hub v53（`b0a3608`）：多组别漏播修复 + 多人接单 + 跨项目评审批修**
- ticket-bot v49：①**多组别工单漏播根因修复**——并行审批流把「审批节点」字段写成「；」拼接多段（5 组别单=同值×5），旧整串精确匹配漏判致创建不播报/对账不补播；新增 `config.matchNodeValue` 拆段匹配替换播报/对账/审批联动守卫/超时检查四处，存量漏播单 202609050003 部署后由对账自动补播（实测 reconcile 4/4 群）。②**多人接单续接窗口**——工单表「是否允许多人接单」=是 时接单不即时通过审批，开 6h 工单级计时器（源表「多人接单截止」字段跨重启），仅已有人接单的群收续接询问，再接单重置计时，到期对账自动通过全部并行节点任务+结束通告；补充负责人改合并写入。③审批联动改**批量通过**（并行分支任务全过才汇合，原单任务缓存会被覆盖）+ 非多人单接单后补通过对账补偿。④评审批修：接单确认整句精确匹配（防"还没人接单吗/我不想接单"误触发）、回退池仅触发节点+多候选入列、超时分支文案/字段配置化、发起时间统一。
- pm-robot v53：DDL 逾期确认防误判（p2p 确认仅私聊可回+整句解析，防群聊日常消息误改项目状态为 completed）、降级直读链路负责人口径对齐（指定→补充负责人，原取当前处理人）、DDL 播报「今日已播报」标记改至少一群送达后落盘（防全败当天静默丢失）、/test-ddl 非播报群守卫。
- 部署验证：ticket-bot/knowledge-tracker 均 online，health 3003/3000 均 200，分桶 API dry-run 正常，ticket-bot 对账新格式日志（多人单窗口关闭/审批补通过计数）就位。
- 待办：审批表单→多维表格同步自动化需映射「是否允许多人接单」（列已在、近期记录值为空），映射后多人单分支才生效。
- 说明：两项目独立仓库已推送 GitHub 并部署 NAS（pm-robot 走 SFTP 兜底，常态）；顶层 monorepo 既有未提交重组改动本次未触碰，本条归档提交留给顶层整理流程。

## 阶段九 · 六仓集中审查修复批次 + 兑现 v28 归档（2026-09-06）

### v29 · 2026-09-06 · 随本提交落地 · fix
**全项目文档对齐 + 确定性缺陷集中修复（gateway v12 / ticket-bot v50 / pm-robot v54 / approval-bot v28 / bambu v17），本提交同时兑现 v28 的顶层归档**
- 共性修复三类：①**文档失真**——gateway README 路由表还是 v4 撤销前的直连规则、pm-robot 关键词监听描述停在 v23 之前、bambu 工作流图与审批主通道自相矛盾、ticket-bot README 留着已删除的 deploy 脚本与命令、各 .env.example 缺键/错值（含 gateway hub 端口 2174 错误、pm-robot 长连接推荐 true 违反铁律）；②**确定性缺陷**——ticket-bot 审批联动申请编号口径（超链接渲染致自动通过链路失效风险）+ 接单守卫、bambu 缺料忙等死循环 + 分发链路无超时、approval-bot dry-run 消费回复 + 回执失败中断整轮、gateway wsClient.start() 未 catch 杀进程 + health 假绿、pm-robot Actions 部署与 push.js 双链路冲突；③**安全卫生**——approval-bot README 移除误提交的 webhook 完整地址、pm-robot 停用 Actions 部署、archive 三份 .env 已进 git 的警示写入顶层 AGENTS 与 deploy skill（密钥轮换待办）。
- 各项目明细见各自 DEVLOG vN；已汇报未改项（gateway /api/dispatch 无鉴权暴露面、event 投递 fire-and-forget、bambu 主通道重启丢队列、pm-robot gitlink 漂移等）见审查报告。
- 版本线备注：approval-bot（缺 v16~v27）、ticket-bot（缺 v43~v49）、pm-robot（缺 v48~v53）三家 DEVLOG 条目曾中断，本次随批补注版本线出处（以各自 git 提交消息为准），并恢复逐 push 记录。
- 部署顺序：ticket-bot → pm-robot → approval-bot → bambu（SFTP）→ 顶层归档提交 → gateway（push.js 跳过 commit 直接 SFTP 部署 + 发布顶层远端）；NAS 五进程验证见各项目记录。

---

**本 DEVLOG 自身**：v1~v25 为 2026-09-04 回溯建档；v26 起按「每次 push 记一版」规则持续追加（规则见 [AGENTS.md](AGENTS.md)，qianli-deploy skill 部署流程同有提醒）。
