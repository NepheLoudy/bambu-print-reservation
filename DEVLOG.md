# DEVLOG · qianli 顶层工作区（monorepo）

版本隔离单位：一次 push 归档提交。本仓库远程为 `github.com/NepheLoudy/bambu-print-reservation`——它由 bambu 独立仓库演化而来（v9 起转型 monorepo），故早期版本即 bambu 的早期历史（细节见 [bambu-print-reservation/DEVLOG.md](bambu-print-reservation/DEVLOG.md)）。v1~v25 于 2026-09-04 回溯编号，此后每次 push 在文末追加新版本（规则见顶层 [AGENTS.md](AGENTS.md)）。

当前最新：**v32**（2026-09-06，随本提交落地）。

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
- 新规落地：指令只在群里触发并回复到对应群，私聊指令仅管理员白名单可用——ticket-bot v44（`47ac274`）与 pm-robot/hub v49（`220abba`）同套规则（`P2P_COMMAND_OPEN_IDS`/`P2P_COMMAND_CHAT_IDS`）；管理员账号为白名单管理员本人（open_id 见本地 .env）；本地 .env 已配置，push 随批上传 NAS。
- pm-robot v50（`e7b4a0b`）：会议提醒卡片识别对非 JSON content 安全降级（全量 debug 发现的 error 日志噪音，功能无损）。
- bambu v16（SFTP 已上线，归档锚点 `5efc0ca`）：审批事件字段对齐官方接口（instance_code/approval_code/open_id）、parseForm 兼容 JSON 字符串、终态扩充 REVERTED/OVERTIME_CLOSE、remainingMinutes 单位修正、分发重试上限+冷却、express.json 2mb、/api/printers/available 路由顺序修正。
- approval-bot v17（`5e3f31e`）：v16 建档条目补交；ticket-bot/pm-robot 同款「当前最新」头部残留随批补交。
- 全量 debug：bambu approval/dispatcher 两套测试、gateway smoke、全部项目语法扫描、门禁本地 9 项验证全部通过；部署后 NAS 五进程 online、健康检查 200。

## 阶段八 · 工单播报修复 + 多人接单联动批次（2026-09-05）

### v28 · 2026-09-05 · `dbbdaf5`（与 v29 同提交兑现）· feat
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

## 阶段十 · 四仓晚间静默联动批次（2026-09-06）

### v30 · 2026-09-06 · 随本提交落地 · feat
**晚间静默（播报时段限制）：02:00–09:00 内定时/自动播报积压到 09:00 统一补发（ticket-bot v51 / pm-robot v55 / approval-bot v29 / bambu v19）**
- 规则入顶层 AGENTS.md 新「晚间静默」段：窗口 `[QUIET_HOURS_START, QUIET_HOURS_END)`（默认 2→9，Asia/Shanghai，支持跨午夜写法，`QUIET_HOURS_DISABLED=1` 关闭）；四仓各自落地 `src/utils/quietHours.js`，积压持久化 `.quiet-backlog.json`（五处 .gitignore 同步），重启不丢、启动过点即补冲刷、失败重试 ≤3 次。
- 挤压负责制三形态（挤压要为挤压之后的事情负责）：①可重扫任务（ticket-bot 每日汇总、approval-bot 周报/每日提醒/催发票、pm-robot DDL 播报含逾期确认）冲刷时重跑整个任务函数，以补发时刻最新数据重查——夜里已了结的事不再播，标记/节流状态以实际发送时刻为准；②小时级重扫（ticket-bot 超时/结单/确认追问）静默内整轮零副作用跳过，09:00 整点轮次天然冲刷；③一次性事件通知（bambu 生命周期卡/预约通知 11 处、ticket-bot 多人单结束通告）原样落盘载荷按序补发，业务动作（打印机控制/写表/审批自动通过）不延迟。
- 豁免：对话/指令回复（接单确认、/print-*、DDL 确认等交互回路）与人工当下主动触发（test-*/手动补播单条）。
- 文档：ticket-pm/LOGIC-MAP 新增 §1.7 + §2.2 第 6 条；approval-bot/bambu README 补静默说明；四仓 .env.example 补 `QUIET_HOURS_*`。
- 部署顺序建议：ticket-bot → pm-robot → approval-bot → bambu（SFTP）→ 顶层归档提交；bambu v19 锚点随本批归档提交回填。

---

**本 DEVLOG 自身**：v1~v25 为 2026-09-04 回溯建档；v26 起按「每次 push 记一版」规则持续追加（规则见 [AGENTS.md](AGENTS.md)，qianli-deploy skill 部署流程同有提醒）。

## 阶段十一 · 无负责人问询节流 + DDL 无人接单分栏（2026-09-06）

### v31 · 2026-09-06 · 随本提交落地 · feat
**无负责人工单群内问询 6h×2 封顶（组长私聊持续升级）+ DDL 播报新增「无人接单」分栏（ticket-bot v51+v52 / pm-robot v55+v56；v30 晚间静默批次的 ticket-pm 两仓随本批实际上线）**
- ticket-bot v52：超时分支 2.2 群内重问询改**每 6h 一次、每单封顶 2 次**（≈发起后 6h/12h 各一次，内存计数重启清零）；封顶后由「无人接单升级」组长私聊（≥3h 间隔）承担持续提醒。多人单续接窗口不受限——有人接单即写补充负责人退出超时检查，续接询问/到期自动通过在 ticketService 接单与对账路径，不经此处。
- 两仓联动（§1.6 契约 additive 扩展）：ticket-bot `GET /api/tickets/unclosed-by-group` 每群新增 `unclaimed` 桶（触发节点 + 补充负责人为空 + 距发起 ≥6h，按「面向组别」分组、时长降序）；pm-robot DDL 卡在结单分栏前新增「🆘 无人接单工单」分栏（只列标题与发布时长不 @），/test-ddl 与降级直读链路同口径。
- 顺带整改（两仓同款）：结单分桶的服务端等值过滤改全量拉取 + 拆段匹配——并行分支「；」拼接节点值等值过滤匹配不上，会静默漏桶。
- 部署顺序：ticket-bot v52 → pm-robot v56 → 顶层归档提交。

## 阶段十二 · 全仓例行维护批次（2026-09-06）

### v32 · 2026-09-06 · 随本提交落地 · fix
**五仓例行 debug 扫描：代码纠偏 6 处 + 文档/锚点对齐（approval-bot v29 首推 + ticket-bot v53 / pm-robot v57 / bambu v20 / gateway v13）**
- approval-bot v29（存量改动随批首推）：晚间静默落地（三定时任务 gateTask 积压重跑）——v30 四仓批次中唯一未 push 的一仓，本批补齐上线。
- bambu v20：审批自愈②窗口列表兜底三处纠偏（响应字段 `instance_list`→`instance_code_list`、时间戳毫秒→秒、24h 窗口按官方 ≤10h 限制切片 + 分页）——自 v18 上线以来该兜底从未生效（生产未配 APPROVAL_CODE 休眠中，无线上影响）。
- ticket-bot v53：「；」拼接拆段匹配残留 2 处整改（结单提醒服务端等值过滤致多组别工单结单私聊永不触发、对账「回执单」整串比对致补搬运/状态推进跳过）+ cron-status「提前/过后」文案反义修正 + README 对齐 v50~v52。
- pm-robot v57：降级直读链路拆段分隔符补齐 `,` `，` `|`（与 ticket-bot splitNodeValues 同字符类）+ README/keywords/.env.example 文案与清单纠偏。
- gateway v13：README 幽灵部署脚本（deploy:sftp→push）、DEVLOG 指针 v10→v12、v11 锚点回填 `cebb767`；bambu v19 锚点回填 `cca9970`；bambu PRINTER-LAN-API dispatcher 行号回填。
- 意图不明未动（记录备查）：bambu approval_task 路径失败不登记自愈、对账重复拉详情噪音、数值 env 无 NaN 防护；四仓 QUIET_HOURS_DISABLED=1 时遗留积压不冲刷不清理；pm-robot 空 chatId 回落口径、静默冲刷中登记的调度窗口；gateway .env 死键 FEISHU_ENCRYPT_KEY 与未用依赖 cors。
- 部署顺序：approval-bot → ticket-bot → pm-robot → bambu（SFTP）→ gateway → 顶层归档提交。

### v33 · 2026-09-11 · 随本提交落地 · feat

**顶层归档：duty-bot v1 首推（Duty-Management）+ hub v65 值日联动 + 本地运维台 + 全仓隐私整改**

- duty-bot v1 首推上线（:3006，pm2 duty-bot，仓库 NepheLoudy/Duty-Management）：排班轮转（三岗均等）/私信闭环/值日助手/数据接口；M0 剩表格 token 回填与名册补全
- pm-robot v65：hub 值日分支 + 值日专用群（快递申领群，DUTY_CHAT_ID）仅放行「值日助手」+ 关键词回答 .local 私有覆盖
- approval-bot v30：提醒回落变量通用化 + 文档脱敏
- 新增 `dashboard/`：本地运维台（仅 127.0.0.1:3100）：端口职能/权限/指令/监听/状态/日志/更新可视化 + 本地测试进程启停 + npm push 快捷指令；`dashboard/registry.js` 为全项目权能清单单一事实来源
- 隐私整改（全仓）：archive/project-configs 旧 .env 退出 git 跟踪（密钥维持"已泄露待轮换"定性）；gateway nas-e2e-test 群号改 env；duty-bot-plan.md 入 gitignore；顶层 AGENTS.md 总表加 duty-bot 行 + 快递申领群裁定 + dashboard 条目；架构 skill 补 duty 分支
- ticket-bot 脱敏改动（DEVLOG/stub/注释人名）随其在途功能批同推，本批未动

### v34 · 2026-09-11 · 随本提交落地 · fix

**顶层归档：全仓审计 debug 批（duty v2 / hub v66 / approval v31 / dashboard 修复）**

- 三路并行审计（文本/代码/逻辑三侧）六仓全量过一遍：3×P1 + 15×P2 + 20×P3；P1 与高危 P2 当批修复（明细见各仓 DEVLOG），P3 与行为取舍项汇总至桌面《设计意图待定项》文档
- dashboard：push 快捷指令 cwd 双重拼接修复（spawn 必失败且无人监听 error 会击垮运维台）、运行期日志封顶、registry 修正误写 API 与 gateway 不提供本地启动的说明（防本地实例抢唯一长连接）
- duty-bot v2：对账补收口（P1）、加罚双插入（P1）、附件并发锁、会话日期守卫、消息幂等、test-generate 默认 dryRun 等
- hub v66：/test-ddl 参数错位（P1，v53 回归）、值日群关键词回答关闭、DDL 确认 p2p 图片静默、.env.example 补 DUTY 键
- approval-bot v31：飞书客户端 15s 超时（催发票互斥锁卡死隐患）、积压文件外迁
- ticket-bot/bambu：client 超时与 quietHours 能力已改在工作区，随各自下一批推送（ticket-bot 在途功能批未动）

### v35 · 2026-09-11 · 随本提交落地 · feat

**顶层锚点：duty-bot v3——缺勤补偿规则确认（已请假/未做完全路径进下周队列，含 admin 手工标记补登记）；快递申领群=值日播报群已确认**
