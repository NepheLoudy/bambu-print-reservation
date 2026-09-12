# DEVLOG · qianli 顶层工作区（monorepo）

版本隔离单位：一次 push 归档提交。本仓库远程为 `github.com/NepheLoudy/bambu-print-reservation`——它由 bambu 独立仓库演化而来（v9 起转型 monorepo），故早期版本即 bambu 的早期历史（细节见 [bambu-print-reservation/DEVLOG.md](bambu-print-reservation/DEVLOG.md)）。v1~v25 于 2026-09-04 回溯编号，此后每次 push 在文末追加新版本（规则见顶层 [AGENTS.md](AGENTS.md)）。

当前最新：**v52**（2026-09-13，随本提交落地）。

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

### v29 · 2026-09-06 · dbbdaf5 · fix
**全项目文档对齐 + 确定性缺陷集中修复（gateway v12 / ticket-bot v50 / pm-robot v54 / approval-bot v28 / bambu v17），本提交同时兑现 v28 的顶层归档**
- 共性修复三类：①**文档失真**——gateway README 路由表还是 v4 撤销前的直连规则、pm-robot 关键词监听描述停在 v23 之前、bambu 工作流图与审批主通道自相矛盾、ticket-bot README 留着已删除的 deploy 脚本与命令、各 .env.example 缺键/错值（含 gateway hub 端口 2174 错误、pm-robot 长连接推荐 true 违反铁律）；②**确定性缺陷**——ticket-bot 审批联动申请编号口径（超链接渲染致自动通过链路失效风险）+ 接单守卫、bambu 缺料忙等死循环 + 分发链路无超时、approval-bot dry-run 消费回复 + 回执失败中断整轮、gateway wsClient.start() 未 catch 杀进程 + health 假绿、pm-robot Actions 部署与 push.js 双链路冲突；③**安全卫生**——approval-bot README 移除误提交的 webhook 完整地址、pm-robot 停用 Actions 部署、archive 三份 .env 已进 git 的警示写入顶层 AGENTS 与 deploy skill（密钥轮换待办）。
- 各项目明细见各自 DEVLOG vN；已汇报未改项（gateway /api/dispatch 无鉴权暴露面、event 投递 fire-and-forget、bambu 主通道重启丢队列、pm-robot gitlink 漂移等）见审查报告。
- 版本线备注：approval-bot（缺 v16~v27）、ticket-bot（缺 v43~v49）、pm-robot（缺 v48~v53）三家 DEVLOG 条目曾中断，本次随批补注版本线出处（以各自 git 提交消息为准），并恢复逐 push 记录。
- 部署顺序：ticket-bot → pm-robot → approval-bot → bambu（SFTP）→ 顶层归档提交 → gateway（push.js 跳过 commit 直接 SFTP 部署 + 发布顶层远端）；NAS 五进程验证见各项目记录。

## 阶段十 · 四仓晚间静默联动批次（2026-09-06）

### v30 · 2026-09-06 · cca9970（并入 v31 归档补交） · feat
**晚间静默（播报时段限制）：02:00–09:00 内定时/自动播报积压到 09:00 统一补发（ticket-bot v51 / pm-robot v55 / approval-bot v29 / bambu v19）**
- 规则入顶层 AGENTS.md 新「晚间静默」段：窗口 `[QUIET_HOURS_START, QUIET_HOURS_END)`（默认 2→9，Asia/Shanghai，支持跨午夜写法，`QUIET_HOURS_DISABLED=1` 关闭）；四仓各自落地 `src/utils/quietHours.js`，积压持久化 `.quiet-backlog.json`（五处 .gitignore 同步），重启不丢、启动过点即补冲刷、失败重试 ≤3 次。
- 挤压负责制三形态（挤压要为挤压之后的事情负责）：①可重扫任务（ticket-bot 每日汇总、approval-bot 周报/每日提醒/催发票、pm-robot DDL 播报含逾期确认）冲刷时重跑整个任务函数，以补发时刻最新数据重查——夜里已了结的事不再播，标记/节流状态以实际发送时刻为准；②小时级重扫（ticket-bot 超时/结单/确认追问）静默内整轮零副作用跳过，09:00 整点轮次天然冲刷；③一次性事件通知（bambu 生命周期卡/预约通知 11 处、ticket-bot 多人单结束通告）原样落盘载荷按序补发，业务动作（打印机控制/写表/审批自动通过）不延迟。
- 豁免：对话/指令回复（接单确认、/print-*、DDL 确认等交互回路）与人工当下主动触发（test-*/手动补播单条）。
- 文档：ticket-pm/LOGIC-MAP 新增 §1.7 + §2.2 第 6 条；approval-bot/bambu README 补静默说明；四仓 .env.example 补 `QUIET_HOURS_*`。
- 部署顺序建议：ticket-bot → pm-robot → approval-bot → bambu（SFTP）→ 顶层归档提交；bambu v19 锚点随本批归档提交回填。

---

**本 DEVLOG 自身**：v1~v25 为 2026-09-04 回溯建档；v26 起按「每次 push 记一版」规则持续追加（规则见 [AGENTS.md](AGENTS.md)，qianli-deploy skill 部署流程同有提醒）。

## 阶段十一 · 无负责人问询节流 + DDL 无人接单分栏（2026-09-06）

### v31 · 2026-09-06 · cca9970 · feat
**无负责人工单群内问询 6h×2 封顶（组长私聊持续升级）+ DDL 播报新增「无人接单」分栏（ticket-bot v51+v52 / pm-robot v55+v56；v30 晚间静默批次的 ticket-pm 两仓随本批实际上线）**
- ticket-bot v52：超时分支 2.2 群内重问询改**每 6h 一次、每单封顶 2 次**（≈发起后 6h/12h 各一次，内存计数重启清零）；封顶后由「无人接单升级」组长私聊（≥3h 间隔）承担持续提醒。多人单续接窗口不受限——有人接单即写补充负责人退出超时检查，续接询问/到期自动通过在 ticketService 接单与对账路径，不经此处。
- 两仓联动（§1.6 契约 additive 扩展）：ticket-bot `GET /api/tickets/unclosed-by-group` 每群新增 `unclaimed` 桶（触发节点 + 补充负责人为空 + 距发起 ≥6h，按「面向组别」分组、时长降序）；pm-robot DDL 卡在结单分栏前新增「🆘 无人接单工单」分栏（只列标题与发布时长不 @），/test-ddl 与降级直读链路同口径。
- 顺带整改（两仓同款）：结单分桶的服务端等值过滤改全量拉取 + 拆段匹配——并行分支「；」拼接节点值等值过滤匹配不上，会静默漏桶。
- 部署顺序：ticket-bot v52 → pm-robot v56 → 顶层归档提交。

## 阶段十二 · 全仓例行维护批次（2026-09-06）

### v32 · 2026-09-06 · 85e95cc · fix
**五仓例行 debug 扫描：代码纠偏 6 处 + 文档/锚点对齐（approval-bot v29 首推 + ticket-bot v53 / pm-robot v57 / bambu v20 / gateway v13）**
- approval-bot v29（存量改动随批首推）：晚间静默落地（三定时任务 gateTask 积压重跑）——v30 四仓批次中唯一未 push 的一仓，本批补齐上线。
- bambu v20：审批自愈②窗口列表兜底三处纠偏（响应字段 `instance_list`→`instance_code_list`、时间戳毫秒→秒、24h 窗口按官方 ≤10h 限制切片 + 分页）——自 v18 上线以来该兜底从未生效（生产未配 APPROVAL_CODE 休眠中，无线上影响）。
- ticket-bot v53：「；」拼接拆段匹配残留 2 处整改（结单提醒服务端等值过滤致多组别工单结单私聊永不触发、对账「回执单」整串比对致补搬运/状态推进跳过）+ cron-status「提前/过后」文案反义修正 + README 对齐 v50~v52。
- pm-robot v57：降级直读链路拆段分隔符补齐 `,` `，` `|`（与 ticket-bot splitNodeValues 同字符类）+ README/keywords/.env.example 文案与清单纠偏。
- gateway v13：README 幽灵部署脚本（deploy:sftp→push）、DEVLOG 指针 v10→v12、v11 锚点回填 `cebb767`；bambu v19 锚点回填 `cca9970`；bambu PRINTER-LAN-API dispatcher 行号回填。
- 意图不明未动（记录备查）：bambu approval_task 路径失败不登记自愈、对账重复拉详情噪音、数值 env 无 NaN 防护；四仓 QUIET_HOURS_DISABLED=1 时遗留积压不冲刷不清理；pm-robot 空 chatId 回落口径、静默冲刷中登记的调度窗口；gateway .env 死键 FEISHU_ENCRYPT_KEY 与未用依赖 cors。
- 部署顺序：approval-bot → ticket-bot → pm-robot → bambu（SFTP）→ gateway → 顶层归档提交。

### v33 · 2026-09-11 · 7789a3a · feat

**顶层归档：duty-bot v1 首推（Duty-Management）+ hub v65 值日联动 + 本地运维台 + 全仓隐私整改**

- duty-bot v1 首推上线（:3006，pm2 duty-bot，仓库 NepheLoudy/Duty-Management）：排班轮转（三岗均等）/私信闭环/值日助手/数据接口；M0 剩表格 token 回填与名册补全
- pm-robot v65：hub 值日分支 + 值日专用群（快递申领群，DUTY_CHAT_ID）仅放行「值日助手」+ 关键词回答 .local 私有覆盖
- approval-bot v30：提醒回落变量通用化 + 文档脱敏
- 新增 `dashboard/`：本地运维台（仅 127.0.0.1:3100）：端口职能/权限/指令/监听/状态/日志/更新可视化 + 本地测试进程启停 + npm push 快捷指令；`dashboard/registry.js` 为全项目权能清单单一事实来源
- 隐私整改（全仓）：archive/project-configs 旧 .env 退出 git 跟踪（密钥维持"已泄露待轮换"定性）；gateway nas-e2e-test 群号改 env；duty-bot-plan.md 入 gitignore；顶层 AGENTS.md 总表加 duty-bot 行 + 快递申领群裁定 + dashboard 条目；架构 skill 补 duty 分支
- ticket-bot 脱敏改动（DEVLOG/stub/注释人名）随其在途功能批同推，本批未动

### v34 · 2026-09-11 · 8693635 · fix

**顶层归档：全仓审计 debug 批（duty v2 / hub v66 / approval v31 / dashboard 修复）**

- 三路并行审计（文本/代码/逻辑三侧）六仓全量过一遍：3×P1 + 15×P2 + 20×P3；P1 与高危 P2 当批修复（明细见各仓 DEVLOG），P3 与行为取舍项汇总至桌面《设计意图待定项》文档
- dashboard：push 快捷指令 cwd 双重拼接修复（spawn 必失败且无人监听 error 会击垮运维台）、运行期日志封顶、registry 修正误写 API 与 gateway 不提供本地启动的说明（防本地实例抢唯一长连接）
- duty-bot v2：对账补收口（P1）、加罚双插入（P1）、附件并发锁、会话日期守卫、消息幂等、test-generate 默认 dryRun 等
- hub v66：/test-ddl 参数错位（P1，v53 回归）、值日群关键词回答关闭、DDL 确认 p2p 图片静默、.env.example 补 DUTY 键
- approval-bot v31：飞书客户端 15s 超时（催发票互斥锁卡死隐患）、积压文件外迁
- ticket-bot/bambu：client 超时与 quietHours 能力已改在工作区，随各自下一批推送（ticket-bot 在途功能批未动）

### v35 · 2026-09-11 · cbc7fd1 · feat

**顶层锚点：duty-bot v3——缺勤补偿规则确认（已请假/未做完全路径进下周队列，含 admin 手工标记补登记）；快递申领群=值日播报群已确认**

### v36 · 2026-09-11 · 24c6d24 · feat

**顶层联动：hub v68 值日群（快递申领群）关键词自动回答放行——群监听"占得太死"松绑**

- 用户反馈值日机器人"群监听占得太死"（实际闸门在 hub 值日分支，duty-bot 无消息监听）：v65/v66 的"仅放行值日助手"把关键词彩蛋一并拦死（日志实录 @「大狗大狗请叫叫」被 🧹 顶掉）。
- hub v68（pm-robot 仓 3501bb5）：@消息「值日助手」看板不变、关键词命中照常回答（未命中回新值日群引导语）、未@关键词照常回答；基础指令继续关闭。
- 文档同步：根 AGENTS.md 值日专用群裁定行、qianli-chat-architecture SKILL.md 架构图、dashboard/registry.js hub 权限、ticket-pm/LOGIC-MAP §2.4 值日分支条目。LOGIC-MAP 同文件随带上批已上线行为的在途文档补记（关键词回答管道③、多人接单 v57~v60 接单链路），在途代码（ticket-bot/bambu quietHours 等）仍未提交、随各自下一批。

### v37 · 2026-09-11 · a0d49a7 · feat

**顶层联动：值日域权限管辖归位——duty-bot v4 管辖策略下发 + hub v69 策略驱动消费**

- 用户要求：值日群的权限管辖范畴（管哪些群）与生效范畴（放行什么）应实现在开发中的机器人（duty-bot）后端，而非 hub 硬编码。
- duty-bot v4（316756b）：`GET /api/duty/policy` 单一事实来源下发管辖群（`DUTY_GROUP_CHAT_IDS`）+ 生效范畴（看板触发词/关键词放行/基础指令关闭/引导语/p2p 指令清单）；群看板加管辖校验。仍不消费消息事件，铁律不变。
- hub v69（5f0add5）：`dutyPolicyService` 短缓存消费策略，值日分支与未@关键词闸门全部策略化，duty-bot 失联按本仓 `DUTY_CHAT_ID` 兜底；改群/改规则今后只动 duty-bot 一侧。
- 文档同步：根 AGENTS.md 值日群裁定行、架构 SKILL.md、dashboard/registry.js（duty/hub 条目）、两仓 README/AGENTS、ticket-pm/LOGIC-MAP §2.4。测试：duty-bot 10 项新断言 + flow/schedule 回归；hub 27 项断言。NAS 实测策略接口下发正确、双服务 health 200。

### v38 · 2026-09-11 · 1e19e37 · chore

**顶层锚点 v37 补记：值日域权限管辖工作全部收口到顶层**

- duty-bot 仓 DEVLOG 回填 v4（316756b 管辖策略下发 → 9bd691b）；pm-robot 仓 DEVLOG 回填 v68/v69（3501bb5 关键词放行、5f0add5 策略驱动 → 372c18b）。
- 本笔更新 duty-bot / ticket-pm/project-management-robot 两个 gitlink 至含 DEVLOG 的最新 HEAD，顶层与嵌套仓状态对齐；此后值日域改权限口径只动 duty-bot 一侧。

### v39 · 2026-09-11 · 79bfaf1 · feat

**顶层联动：duty-bot v5 表格接线——值日看板表接入（M0 表格项完成）**

- 用户建好「值日看板」表（机器人项目看板库 tblhws89lrituaks，人员列已自行改为人员类型）；duty-bot 探测后完成匹配：应用身份补建文本「姓名」列、预置负责区域/完成状态单选选项，`.env` 写全 token/表 id/DUTY_FIELD_* 映射（列名不改动用户命名，全走 env）。
- duty-bot v5（d57aa0f，回填 931094f）：table:check 总状态列类型断言放宽为文本/单选皆收；校验 9 字段全过；NAS 实测 brief 读表 / generate dryRun / health 200。
- registry 销项：M0"表格 token 回填"完成；**名册待补全（当前仅 1 人）**——排班生成前必须补 members.json 并让队员发「绑定 姓名」，否则全排一人。

### v40 · 2026-09-11 · 39d25c2 · feat

**顶层联动：名册自动读通讯录 + 机器人后端定制窗口规则（首批三仓落地）**

- 需求：排班名册不手工维护——duty-bot 自动读飞书通讯录纳入所有队员；白名单类定制能力做成各机器人后端的"附属窗口"；规则写给所有机器人后端。
- duty-bot v6（d94c48f/9bbea91，回填 55d7847）：`contacts.js` 全租户部门×成员同步（停用不入册、多部门合并、open_id 直取），启动/生成排班前/手动 refresh 三时机；admin 标记按姓名保留，绑定降级兜底；定制窗口 roster 全景 + whitelist 增删。踩坑：find_by_department page_size 上限 50。NAS 实测 **63 人全员入册**（12 部门全绑 open_id）。
- hub v70（2c33716）+ approval-bot v32（0728e21）：`GET /api/hub/policy`、`GET /api/approval/policy` 只读定制窗口。
- 规则成文：顶层 AGENTS「机器人后端定制窗口（附属窗口）规则」——读窗口 policy 全景、写窗口热改、口径权威在各自后端、名册优先通讯录、先加窗口再登记 registry。ticket-bot/bambu 有在途批，policy 窗口随批补上（registry 已标注）。
- 测试：duty-bot 新增 test:roster（10 项）+ flow contacts stub，schedule/policy/roster 全过。

### v41 · 2026-09-11 · fc631d9 · feat

**顶层联动：hub v71 关键词回答表定制窗口 + 运维台「🧰 定制中心」界面**

- hub v71（a45d87b，回填 5a580e7）：`GET/POST /api/autoreplies/rules(/delete)`、`/api/autoreplies/enabled`——关键词回答表/@触发表增删改与启停，写 NAS `.local.json` 即时生效（push 以本地 xlsx 版覆盖，已在窗口响应与 README 注明）；NAS 实测 CRUD 全闭环。
- 运维台「🧰 定制中心」：registry 各项目新增 `windows` 清单；`/api/windows` + `/api/nas/api`（SSH curl 代理直达 NAS 本机接口）；界面支持 duty-bot 白名单增删（人名徽标即时回显）、名册全景/通讯录刷新、管辖与定制全景查看、hub 关键词表可视化编辑器（规则列表/删除/保存/整表启停/group↔mention 切换）。
- AGENTS「机器人后端定制窗口」规则补界面条目；ticket-bot/bambu 窗口仍随在途批。
- 运维台已重启生效（127.0.0.1:3100）。

### v42 · 2026-09-11 · bffe647 · fix

**顶层联动：定制面板集成主看板（🧰 折叠）+ 修复编辑器无响应 + 指令风格统一 + 宣运群回执排查**

- 运维台改版（用户反馈：定制栏不要分开放）：删除独立「定制中心」区块，定制窗口折进各项目主卡片——卡片右上角 🧰 按钮展开/收起；修复「打开编辑器」无响应（rulesEditor 容器 div 此前未渲染）；新增 duty 管辖策略在线编辑（输入管辖群 chat_id 即存即生效）。
- duty-bot v7（95f92b6）：指令风格统一——/值日助手、/我要请假 等 / 别名与裸词全等效；管辖策略 POST 在线改写（config/policy-override.json 优先于 env）。
- hub v72（e7871f9）：/help 值日段统一斜杠风格，兜底指令清单同步。
- 排查结论（详见会话报告）：① /help 在财务群外显示完整帮助为既有设计（财务群是切换 /approval-* 的特例），风格统一后体验一致；② 宣运群接单回执缺失根因 = ticket-bot 当时出站请求连不上飞书 API（错误日志「接单队列推导失败: fetch failed」连接超时），队列推导失败被兜底成「无待接单工单」；工单 202609110003 本身正常待接，网络恢复后重发「接单」即可出回执；在途批的 client 超时加固即是针对此问题，建议随下一批推送。
- ticket-bot / bambu 的 policy 窗口仍随在途批。

### v43 · 2026-09-11 · 2ab7050 · fix

**运维台定制窗口改浮层——修复 4 秒自动刷新把展开面板重置的问题**

- 用户反馈：定制面板展开后有时自己关闭（根因：页面每 4s 重建卡片网格，内嵌面板被重置回 display:none）；且期望的展开形态是"浮现一个略小的窗口覆盖卡片"。
- 改为全局悬浮窗 `#winFloat`：点卡片右上角 🧰 在该卡片上方浮现略小窗口（absolute 定位随页面滚动、内容超高滚动），独立于网格重建，输入中的表单不会被刷新清掉；再次点击 🧰 或点「收起 ✕」关闭，打开另一项目自动切换。
- 卡片仅保留 🧰 入口按钮；whitelist/规则编辑器/管辖群编辑等功能不变。

### v44 · 2026-09-11 · 5dd60e7 · fix

**顶层联动：窗口按键全量体检 + 名册同步加固 + 排除名单核验**

- 全量体检：运维台全部 11 个窗口接口经真实代理链路逐个探测（含耗时），全部健康；名册通讯录同步实测 5.9~6.5s。
- 用户反馈「手动刷新没用」根因：同步整链 ~17 次出站调用，单次网络抖动即整轮失败 + 代理 12s 超时余量偏紧 + 失败只有右上角 toast 无可见结果。修复：duty-bot v8（58237b8）同步失败自动重试一次；运维台代理超时 12s→30s；刷新按钮忙碌态 + 成功后自动弹出名册全景。
- 排除名单核验：用户已加 18 人，14 人生效（64 人名册、队列 50）；4 人无效（Peiyu Wang/粟宇/Aouk/郑元斌，通讯录查无此人——已退队或名字写法不同），已反馈用户。

### v45 · 2026-09-12 · 8822459 · fix

**顶层联动：值日链路全量修复（duty-bot v9 `f2220af` + hub v74 `106bc46`）——群看板斜杠门、每日播报静默跳过、打卡口径**

- P1（声明≠实现）：群内 @机器人「/值日助手」此前被 hub 全等匹配拦成引导语——duty-bot v7 的 NAS 实测系直 POST 绕过 hub 门，真实链路从未通过。hub v74 群门改裸词/带 / 双形态匹配，/help「带不带 / 均可」自此为真。
- P1（核实+修复）：「每日 12:00 看板自动播报」本地与 NAS `.env` 均未配置 `DUTY_BOARD_WEBHOOK_URL`，上线以来每天静默跳过（从未真正跑过）。duty-bot v9 改为回退应用身份直发管辖群（webhook 推送失败同样回退、播报不中断），并回填 duty-bot-plan.md 交接记录中的播报群 webhook——次日 12:00 起播报真正生效。
- 打卡口径：p2p 打卡确认增补口语变体（是的/好了/完成了/做完了/搞定 等——有当日询问会话才等同「是」，无会话交还 hub 走欢迎语）；看板 footer 明示「完成后请私信回复『是』」（原文案诱导群内回复，是「关键词和@指令撞了」观感的直接来源）；18:30 询问与 HELP 注明「若同时有 DDL 逾期确认，『是』会先被其占用，打卡未成功请再发一次」。
- 防撞车与口径统一：hub 回答表写窗口（upsertRule）对值日域保留词做双向子串冲突校验（命中即 400）；groupChatIds 空数组语义统一为「不限制」（原 hub=无管辖群 / duty-bot=放行，两边相反）；群看板转发载荷补 messageId（duty-bot 消息级幂等全路径生效）；非管辖群 @ 值日指令回「请到值日专用群或私信办理」；管辖群 @+纯图片静默吞掉不回引导语。
- 记录在案不动：gateway `contains:'接单'` 全局抢占（值日群含「接单」的 @ 消息进 ticket-bot，ticket-bot 群门禁兜底，后续单独批次按工单管辖群收窄路由）；`isMentionedBot` 把 @任何 app/bot 都算 @本机器人（共用应用妥协）；群看板限流命中静默（设计如此）。
- 验证：hub stub 测试 34 项 + duty-bot 五套件（policy/flow/board/schedule/roster）全过；NAS 两进程 online、health 200；真实群内 @（看板双形态/变体打卡/12:00 播报）待白天自然触发观察。
- 注：dashboard/registry.js 同文件携带 gateway v14 批次的在途文案改动一并归档（该批功能已随 b4aa03e 部署）；其余在途改动（dashboard 运维台、ticket-bot 多人接单批次等）不在本批收录范围。

### v46 · 2026-09-12 · 265a429 · fix

**顶层联动：全仓复查纠偏 + 剩余未推批次清理（ticket-bot v61 `f6f73e2` + bambu v21 + duty-bot v10）**

- 全量复查（TRAE-code-review，双校验代理 2/2 确认 7 项发现）：v45 批次（duty-bot v9 / hub v74）自检无阻断缺陷；ticket-bot 多人接单收尾批次审后随 v61 推送（出站 fetch 全量 15s 超时、审批人解析失败不缓存自愈、接单队列复用全量记录免二次拉表、历史文档隐私清洗）；dashboard 活跃看板批次（/api/stats /api/activity + 总览仪表台）审后随本提交归档。
- 复查发现 ①②③（静默积压挪址收尾，major+minor×2）：bambu/ticket-bot `.env` 补 `QUIET_BACKLOG_FILE`——bambu 纯 SFTP 部署每次清空项目目录、积压必丢（新代码此前对该仓形同虚设），ticket-bot SFTP 兜底部署路径同险；两仓 quietHours 加载时自动建项目外数据目录。NAS 实测：`/home/qianli/bambu-data`、`/home/qianli/ticket-bot-data` 随重启自动创建，ticket-bot/bambu health 200。
- 复查发现 ④：三仓 `.env.example` 补 `QUIET_BACKLOG_FILE` 键（「新增配置同步改 example」约定欠账）；duty-bot 随 v10 docs 推送，顺带回填 v9 锚点 `f2220af`。
- 复查发现 ⑤⑥（文档纠偏）：gateway DEVLOG 头部「当前最新」v13→v14（v13 条目刚修过同型漂移、属复发）；registry ticket 条目注记改写——多人接单批次已推 v61，**`/api/tickets/policy` 定制窗口仍未落地（待后续批次）**。
- 复查发现 ⑦（整理）：keep-awake.ps1 防休眠工具归档 `tools/`。
- gateway v14 DEVLOG 补交随本提交归档（v14 代码已随 b4aa03e 部署，本批不重部署、避免长连接无谓重启）；至此工作区无未收尾改动。

### v47 · 2026-09-12 · 64ce352 · feat

**顶层联动：动态广场看板落地（机器人项目看板）+ 运行时数据保护铁律 + duty-bot 白名单事故整改**

- 建表：机器人项目看板新增「动态广场 / 网关日活跃 / 网关功能使用 / 网关队员活跃」四表（duty-bot `scripts/create-plaza-tables.js` 幂等建表；主键改名走 PUT——飞书更新字段接口不是 PATCH）。
- 网关活跃同步：gateway v15 每 30 分钟按日期签名 upsert 三表 + 启动回填存量 + `POST /api/usage-sync/run` 手动补数；NAS 实测出数（09-12：237 条消息 / 23 名活跃队员，open_id 姓名自动解析成功）。
- 动态广场事件流：ticket-bot v62（工单播报/接单/结单/审批自动通过）、bambu v22（打印排队/开始/完成/失败）、duty-bot v11（值日完成/请假）、hub v75（DDL 播报）四仓钩子接入，失败仅 warn 不阻塞主流程；approval-bot 无写表客户端待后续批次。
- 交付《动态广场看板搭建指南.md》（顶层）：指标卡/分布/对比/趋势/Feed 逐图表清单——仪表盘图表因开放平台限制无法 API 创建，需在多维表格 UI 按清单点选（约 10 分钟）；wiki 参考文档因共享应用缺 `wiki:node:read` 暂无法读取，开通后可对照调整。
- 【运行时数据保护】duty-bot 白名单事故整改：v9 推送曾用本地空 `whitelist.json` 覆盖 NAS 侧用户编辑的 18 人排除名单（日志只记条数、不进 git、无快照，不可恢复）→ 顶层 AGENTS 新增「运行时数据保护（删除前询问铁律）」；duty-bot / hub push.js 上传私有配置前自动备份 NAS 现网 + 本地条目少于现网即跳过并回填本地（`PUSH_FORCE_PRIVATE=1` 强制）；实测 duty-bot push 时本地 members 测试桩被 NAS 64 人名册自动回填，守卫按设计生效。
- 验证：gateway 同步 stub、duty-bot flow/policy、ticket-bot 多人单 20/20、bambu dispatcher 回归全过；五仓 push 后全部 online、health 200。

### v48 · 2026-09-12 · 9e4422e · docs

**顶层联动：全仓状态/联动逻辑复核 + 开发规则与 agent 指示层优化（docs）**

- 复核结论：6 服务 NAS 全量 health 200、8 工作区 git 全净；联动逻辑（网关路由→hub 分发→专项转发、duty 管辖策略、unclosed-by-group、plaza 写表、usage 同步、静默闸门）逐一与文档核对一致。
- 顶层 AGENTS：新增「机器人项目看板（多维表格）数据联动」节（四表写入方约定/建表脚本幂等/写表≠消费消息的铁律澄清）；定制窗口现状纠偏（ticket-bot/bambu policy 窗口明确"仍未落地"，不再写"随在途批补上"）；M4 昨日值日播报标注"接口就绪无消费方 + hub 预留键"。
- ticket-pm/AGENTS：新增契约 6（动态广场写表约定 + 测试隔离要求）与契约 7（gateway 接单全局抢占记录在案）；部署顺序补 duty-bot 位次与 plaza 测试隔离。
- qianli-deploy skill：项目表补 duty-bot 行；.env 规则补私有配置守卫说明；已知坑补「push 冲掉运维台名单/回答表」条目；多项目同批部署顺序 + 顶层远端说明（origin 即 bambu 名下归档仓，历史遗留设计）。
- 配套修补推送：duty-bot v12 / hub v77——tar 打包排除私有配置，堵住「SFTP 兜底清目录绕过备份守卫」的漏洞（v76 恰走该路径暴露）；hub v76 的 .env.example 标注 M4 预留键。
- 遗留待办清单（已汇总在案）：ticket-bot `/api/tickets/policy` 与 bambu `/api/print/policy` 窗口、approval-bot 广场钩子、M4 值日播报消费方、bambu 生产 APPROVAL_CODE/PRINTER_HOSTS 配置、动态广场仪表盘 UI 点选、wiki 权限开通、duty-bot 白名单重录（等用户名单）、gateway v15/bambu v21-22 DEVLOG 锚点回填。

### v49 · 2026-09-12 · b5854f4 · fix

**动态广场看板纠偏：网关活跃三表「日期」改日期类型（gateway v16/v17），仪表盘动态筛选可用**

- 用户反馈指标卡无法按「今天」过滤：根因是三表「日期」建为文本字段（文本无动态日期；且实测 records/search 的过滤对 Date 字段所有 operator 均 InvalidFilter）。
- 修复：三表「日期」Text→Date 迁移（存量自动转换零丢失）；gateway v16 写入/检索改当日 0 点时间戳 → v17 进一步改**整表拉回内存比对**根治（`bitable.listAllRecords` 替代 searchRecords），队员表新增 `open_id` 稳定身份列（姓名解析升级不产生重复行）。
- NAS 实测：清理旧格式 24 行 + force 重同步后三表行数/日期值/唯一性全部正确；《搭建指南》对应筛选说明同步更新。

### v50 · 2026-09-12 · 649ac96 · docs

**值日群引导语纯行动指引口径（duty-bot v13 + hub v78 联动）**

- 值日管辖群 @未命中引导语删去「本群为值日/快递申领专用群」「关键词彩蛋照常有效」说明性内容，只保留行动指引（@我 发送「值日助手」查看今日值日 + 查询/请假/打卡请私信机器人）；duty-bot 下发 GROUP_GUIDANCE 与 hub 断联兜底 DEFAULT_GUIDANCE 同文案，hub stub 断言指纹随更。

### v51 · 2026-09-12 · 随本提交落地 · fix

**全量 debug + 文档修正批（duty v14 / hub v79 / approval v33 / ticket v63 联动）+ 上一批手册工作收尾**

**代码修复（三个真实缺陷）**
- duty-bot v14：白名单成员补偿义务丢失 bug——生成排表路径对不在值日队列成员的插入义务静默丢弃且被误标已安置，义务凭空消失（违反「白名单不豁免补偿」口径）；现改进未安置队列，生成回执如实上报、00:30 对账照常安置。同批：README 把未实施的 M4 写成进行时的纠偏、里程碑 M3 矛盾行合并、建表脚本补「网关队员活跃」open_id 列（与线上表对齐）、.env.example 去重。
- hub v79：值日管辖群会议提醒关闭（此前会议卡片提醒对所有群照常运行，与「值日群群级功能全关」口径不符；按 duty-bot 下发管辖群严格命中跳过，空列表不放大到全群）；静默积压外迁落地（QUIET_BACKLOG_FILE=/home/qianli/hub-data/quiet-backlog.json + quietHours 自建目录 + 旧积压一次性迁移）。
- approval-bot v33：quietHours 补启动自建目录（对齐 ticket/bambu/duty）、.env.example 补 QUIET_BACKLOG_FILE 键、README 补 /api/approval/policy 窗口行。
- ticket-bot v63：README 晚间静默变量表补 QUIET_BACKLOG_FILE 行（docs，无代码改动）。
- 回归：duty 五套 stub（schedule/policy/flow/board/roster）+ hub stub-test-duty-branch 全过。

**文档修正（全仓一致性）**
- registry.js：duty 定时任务补 12:00 今日看板播报、名册 63→64 人、hub 监听链路补会议跳过、dashboard 窗口清单补 /api/windows 与 /api/nas/api。
- dashboard/public/index.html：bambu/ticket policy 占位文案「随各自在途批补上」（被 AGENTS 明文禁止的措辞）改「未落地（已登记待办）」。
- ticket-pm/LOGIC-MAP：§2.1 管道图补值日分支与会议提醒管辖跳过、§1.7/§2.2 补 QUIET_BACKLOG_FILE、§3 契约补 6/7 引用、已知限制 #7「无接单N」过时条目订正（v57 已解决）。
- AGENTS.md：DEVLOG 规则补两条惯例成文——占位哈希由下一次 push 回填、纯回填提交不占版本号、历史复用版本号（duty v8/hub v62/ticket v50）以提交哈希为准不追溯改号。
- 《动态广场看板搭建指南》：网关队员活跃表补 open_id 稳定身份列说明。

**DEVLOG 锚点系统性回填（兑现待定项 #38）**
- 顶层 v29~v50 全部占位哈希回填（v30 晚间静默批并入 cca9970 归档补交）；duty v10~v13、hub v74~v78、approval v28~v31、ticket v54~v62、gateway v15~v17（v15 锚定其代码提交 8dd86d6）、bambu v21/v22；四仓 + bambu「当前最新」指针同步修正。09-05/09-06 回溯期更早条目按「历史条目不改写」保留。

**上一批收尾（同提交入库）**
- AGENTS「用户侧总指南（桌面 HTML）——同步义务」节、维护者手册《机器人总成使用指南.md》入库、dashboard/README 引用手册、duty-bot/hub gitlink 指针更新（v13 1d522cf / v78 6328555）——上批「值日群引导语纯行动指引」的文档侧未提交部分。

**用户侧同步（工作区外）**
- 桌面《机器人总成使用指南.html》：斜杠口径收窄为仅值日指令可省 /、值日群特殊规则补会议提醒关闭与 @+纯图片静默与引导语原文、工单节补无人接单升级私聊组长、审批节补「今日已催」卡（推送+卡片清单）、口语变体「完成」→「完成了」、运维台节去维护者内幕（xlsx 覆盖/部署链路/pm2 术语）、速查表 /test-ddl 标注管理员用。
- 桌面《qianli-设计意图待定项.md》：#16/#30/#34/#38 逐条订正 + 新增第六节（39~45）记录本批发现与处置。

### v52 · 2026-09-13 · 随本提交落地 · feat

**用户拍板批：M4 值日群昨日+今日同卡 / 请假当日抽调补位 / 接单并发修复 / 六仓定制窗口齐全（duty v15 + ticket v64 + bambu v23 + hub v80 联动）**

**四项拍板全部落地**
- **M4「昨日值日播报」= 值日群一张卡同时播昨天今天**：duty v15 看板卡增「昨日战报」段（12:00 播报与手动看板共用）；原 pm-robot 消费 brief 方案作废，brief 保留通用接口，hub 预留键降级（hub v80 注释更新）。
- **有人请假必须有当日补位（从远一点的排班抽调）**：duty v15 新增 arrangeReplacement——候选=值日队列中在其后仍有排班者，同岗优先、排班日最远者优先；加插非对调（被抽调者远期班次保留+私信告知），请假人仍进下周补偿总量守恒；未做完了无法当日补位仍走下周补偿。
- **接单冲突修复**：ticket v64 按群 chatId 串行化接单（读改写链路并发互覆丢人的窗口关闭）；并发回归用例入桩测试（22/22）。
- **后端定制窗口你先设计 → 六仓齐全**：ticket v64 `GET /api/tickets/policy`、bambu v23 `GET /api/print/policy`（只读全景），运维台「功能激活」接通两域真实数据（dashboard server.js 探针 + 前端渲染重写）。

**动态广场新口径**：不再主动扩展，后续数据需求由用户提出；旧待办（approval 钩子/仪表盘点选/wiki 权限/30 天留存）撤销挂起。

**文档同步**
- 顶层 AGENTS：定制窗口现状改「六仓窗口齐全」、M4/请假补位口径并入值日域裁定行。
- registry.js：ticket/bambu 增 windows 登记、notes 更新（v64 串行化）、duty 12:00 播报口径。
- ticket-pm/LOGIC-MAP：§1.3 补接单串行化；ticket README 补串行化说明与 policy 行；bambu README 补「定制窗口」节。
- 维护者手册《机器人总成使用指南.md》：duty 节 M4 落地/补位语义、定制中心表 ticket/bambu 行、ticket/bambu 节窗口行更新。
- 桌面《机器人总成使用指南.html》（用户侧）：12:00 值日卡改「今日+昨日战报」、值日看板卡描述更新、「我要请假」补位说明、FAQ 新增「我请假了今天谁顶」、运维台定制中心窗口现状。
- 桌面《qianli-设计意图待定项.md》**重构**：已完全解决条目全部删除（38 条清单收敛为 10 条待拍板），新记动态广场新口径与四项已定口径备忘。
- 测试：duty 五套 stub（含新增补位/卡片断言与日期敏感断言修正）+ ticket 22/22 + bambu dispatch/approval 全过。
