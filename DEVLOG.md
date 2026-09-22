# DEVLOG · qianli 顶层工作区（monorepo）

版本隔离单位：一次 push 归档提交。本仓库远程为 `github.com/NepheLoudy/bambu-print-reservation`——它由 bambu 独立仓库演化而来（v9 起转型 monorepo），故早期版本即 bambu 的早期历史（细节见 [bambu-print-reservation/DEVLOG.md](bambu-print-reservation/DEVLOG.md)）。v1~v25 于 2026-09-04 回溯编号，此后每次 push 在文末追加新版本（规则见顶层 [AGENTS.md](AGENTS.md)）。

当前最新：**v93**（2026-09-22，随本提交落地）。上一版 v92（`41b2ec8`）。

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

### v53 · 2026-09-13 · 随本提交落地 · refactor

**工单搬运人员口径变更：废止指定负责人专项搬运，只搬补充负责人全员（ticket v65，用户拍板）**

- 口径：自指定负责人工单也走群内播报（公示即绑定写入补充负责人）后，源表「指定负责人」的搬运分支失去意义——看板人员一律由「补充负责人」驱动：同组多人并集、跨组各归字段、与看板已有人员合并不互覆；项目性质（category）门控保留。
- 顺带修复 `mergePersonFields` 折叠丢键（跨组多补充负责人折叠时累积侧的组别字段被丢）；新增 `stub-test-sync` 12 项回归（multi-accept 22/22 不受影响）。
- 时序：创建事件先搬运后公示绑定，指定工单首次搬运到绑定间存在秒级人员空窗，由绑定写表的更新事件与每分钟补搬运自然填上。
- 文档同步：ticket README 简介/测试清单、ticket-pm/LOGIC-MAP §1.2 口径与已知限制 #1 收窄（公示链路仍取首位）、registry ticket notes、桌面意图待定项销项（原 #3）并在已定口径表记一行。
- NAS 部署完成，pm2 ticket-bot online。

### v54 · 2026-09-13 · 随本提交落地 · refactor

**网关活跃监听口径收敛为机器人交互 + 动态广场活跃表单表化（gateway v18，用户拍板）**

- 用户确认「队员活跃监听过于敏感」：gateway v18 起使用统计只计**机器人交互**（显式路由命中 / 私聊 / 群内 @机器人）；群内未 @ 落默认目标的普通闲聊不再计数，**转发行为不变**（hub 照常收到、按门禁忽略），值日群未 @ 关键词等能力不受影响。
- 多维表格同步单表化：只留「网关日活跃」（列名沿用，图表无需重建，总消息数语义=机器人交互次数）；「网关功能使用 / 网关队员活跃」两表下线，表由用户在多维表格自行删除，仪表盘对应图表（功能使用 TopN / 队员活跃 TopN）随之撤销；duty-bot 建表脚本同步移除两表定义防重建（该仓本地提交 a843c5d 暂缓部署——仓内有另一批在途改动，随下次 duty-bot push 带 NAS）。
- 文档同步：搭建指南（数据源表/图表清单删 #10、#12，指标卡 #4 改「今日机器人交互」）、dashboard/registry.js notes、顶层 AGENTS 看板节、gateway README/`.env.example`、桌面用户 HTML（网关活跃两处描述、仪表盘面板表删两行）。
- 测试：usage-sync stub 改单表口径全过；新增门控用例（未@不计/@计/私聊计/显式路由计/接单计）全过。
- 部署：gateway 路径提交 800364e 已推远端并 SFTP 部署，pm2 online、ws running，启动日志确认新同步口径；日活跃表近 30 天存量行仍为旧口径，随留存自然滚出。

### v55 · 2026-09-13 · 5311839 · feat

**「是/否」双语义根治批：值日打卡主词改「打卡」+ DDL 确认 12 小时时效（duty v16 + hub v81，用户拍板）**

> 编号注记：本条提交信息误标 v54，与并发会话的网关活跃批（gateway v18，30c8e02）撞号——按「以提交哈希为准」改记 v55。

- **值日打卡主词改「打卡」**：从根上避开与 DDL 确认抢「是」——「打卡/打卡了」入路由与 policy 清单（含斜杠变体），「是/口语变体」兼容保留；duty 全量文案（HELP/D-1/18:30 询问/看板 footer/否补救/收口回执/补位通知）改「回复打卡」。
- **DDL 确认 12 小时时效**（N=12，`DDL_CONFIRM_WINDOW_HOURS` 可配）：确认私信发出后 12 小时内回复才认；**超时项目保持原状态、次日 12:00 播报重新询问**（原 7 天窗口废止）。
- **冲突额外提示**：有未过期 DDL 确认的成员，18:30 询问追加「回『是』会确认项目，值日请回『打卡』」——hub 新增 `GET /api/ddl/pending` 供数，duty `ddlConflictClient` 短缓存消费、失联静默降级。
- 测试：duty 五套 stub（flow 新增 4 断言 + policy 清单 20→24 词）+ hub duty-branch 回归全过。
- 文档：registry（duty 指令/hub 监听链路）、ticket-pm/LOGIC-MAP §2.3 时效口径、维护者手册、桌面 HTML（时间线/指令表/FAQ 三处）、意图待定项销项原 #2 并记入已定口径。

### v56 · 2026-09-13 · 随本提交落地 · feat

**打印预约队列持久化：重启不丢排队（bambu v24，用户拍板：后续有算力，预约可持久化）**

- 分发引擎队列/打印中映射/known/完成计数落盘 `DISPATCH_STATE_FILE`（生产 `/home/qianli/bambu-data/dispatch-state.json`，项目外数据目录与静默积压同址，部署清目录不再影响）；变更防抖 300ms 原子写入，`start()` 恢复，pm2 restart 的 SIGINT/SIGTERM 退出前强制冲刷。
- known 截尾 2000 条防无限增长（恢复时队列/打印中的活动 recordId 回加）；文件损坏按空队列启动（审批事件与对账重新入队）、缺失静默跳过。
- NAS 实测：pm2 restart 后状态文件生成、恢复闭环工作、health 200。
- 测试：新增 `test/dispatcher-persist-test.js` 9 项；dispatcher/approval 既有单测回归全过。
- 文档：bambu README「状态持久化」节 + 测试清单、`.env.example`/`.env` 键、registry bambu notes、桌面意图待定项销项（bambu 队列持久化条目）并记入已定口径。
- 同批 gitlink：duty-bot（DEVLOG 建表脚本条目撞号订正 v17）。

### v57 · 2026-09-13 · 随本提交落地 · fix

**人工指定与自动匹配分发互斥：bambu 分钟级 TOCTOU 竞态关闭（bambu v25，遗留待办销项）**

- 方案：按打印机的分发闸门——`dispatching` 集合在 dispatch 入口同步 check+add（单线程事件循环内原子），finally 释放（失败/重试路径也保证）；自动匹配候选过滤分发中打印机；manualDispatch busy 校验追加分发中判定 + dispatch 入口兜底二次拒绝。闸门刻意不持久化（崩溃后清零重新评估）。
- 病灶回顾：dispatch 的下载/上传/下发是分钟级 await 链、printing 占用登记在链尾，manualDispatch 绕过 matching 串行段且 busy 校验在链前——窗口期两路对同一台打印机双双下发（上传互覆/顶掉任务）。
- 测试：新增 `test/dispatcher-manual-race-test.js` 8 项（受控 deferred 模拟分钟级链路）；persist/dispatcher/approval 回归全过；NAS 部署后 health 200。
- 文档：bambu README「分发互斥」节、registry bambu notes、桌面意图待定项销项（原 bambu TOCTOU 条目）并记入已定口径。

### v58 · 2026-09-13 · 随本提交落地 · feat

**gateway 管理端点鉴权 + 长连接启动失败自动重试（gateway v19，用户拍板：现状不接受）**

- **鉴权**：`/api/dispatch` 与 `/api/usage-sync/run` 需带 `X-API-Token` 头（`GATEWAY_API_TOKEN` 存 gateway `.env` 随 push 下发 NAS，凭据存储沿用工作区 .env 约定；timingSafeEqual 防时序侧信道）；**fail-closed**——token 未配置时两端点整体锁定（503），健康检查与只读 `GET /api/usage` 不受限。手动补数 curl 示例已带头同步进 AGENTS/搭建指南/维护者手册。
- **长连接自动重试**：启动失败（凭证错误/网络故障）按指数退避自动重试（5s 起、翻倍封顶 5 分钟），每次尝试新建 WSClient（保证同一时刻至多一条连接），成功清零计数打恢复日志；120s 看门狗兜底「start 无响应」；health 的 ws 字段新增 `connecting` 态。
- NAS 实测：无 token 两端点 403；带 token usage-sync 200（真实同步 09-12/09-13 两天数据）、dispatch 200；health `ws: running`。
- 顺带：gateway v18 锚点回填（800364e，对方会话漏回填且头部指针停在 v17）；DEVLOG 头部指正 v19。
- 文档：gateway README、registry gateway notes、桌面意图待定项销项（原 #2 gateway 条目）并记入已定口径。

### v59 · 2026-09-13 · 随本提交落地 · feat

**接单按群门禁：无单群不监听接单及其变式（ticket v66，用户拍板）**

- 哪个群有单，哪个群才接单：群内接单类消息先查该群实时接单队列——**队列为空即静默忽略**，非工单群（如值日群）与当前无单的组别群不再收到「无待接单工单」/使用提示噪音；有单群行为不变；指定负责人 p2p 私聊确认不受影响。
- 设计取舍：网关路由不改（全局转发保留），响应收窄放在 ticket-bot 端用实时数据判定——比网关侧静态群清单更准（组别群当前没单时同样安静），也避免了「网关+工单管辖群联动批次」的配置耦合。
- 文档：ticket-pm/AGENTS 契约 7 改「已落地」、LOGIC-MAP §1.3/契约 6、registry、桌面 HTML FAQ、维护者手册、意图待定项销项并记入已定口径。

### v60 · 2026-09-13 · 随本提交落地 · refactor

**值日群未@关键词回答全群统一 + 值日助手仅 @/私聊（hub v82 + duty v18，用户拍板）**

- 口径：值日群的关键词回答与所有群完全一致（未@/@ 都生效，不再有放行开关）；「值日助手」看板仅 @ 或私聊触发（事实收敛——看板本就在 @ 路径，未@从来不出看板），保留词撞车校验整体移除（回答表用词不再受限，撞车根源已消失）。
- 实现：hub autoReplyService 删 `keywordAllowedInGroup` 门禁与 `assertNoDutyConflict` 校验；chatService ② 的 @关键词回答去 `keywordPassthrough` 条件；dutyPolicyService/duty policyService 双侧清死 flag；hub stub ⑩ 场景改「全群统一照常回答」、⑭ 改「含值日助手规则不再被拒」（upsert 后 deleteRule 清理不污染真实表）；duty policy 桩同步。
- 文档：hub README 回答表校验说明、LOGIC-MAP §2.4、registry hub notes、维护者手册 hub 管道行、桌面 HTML 值日群特殊规则行。

### v61 · 2026-09-13 · 随本提交落地 · docs

**全项目文档重审 + 机器人体系建设推荐（运维台不自启拍板收项；四仓 README 文档批联动：duty v19 / hub v83 / ticket v67 / gateway v20）**

- **文档重审**（两路并行审计：跨仓一致性 + 用户侧时效性）：共发现 20+ 处必修复——多数为 09-12/09-13 高频批次后的旧口径残留（打卡主词、DDL 12h、两表下线、M4 落地、搬运废止、policy 占位句），全部订正：顶层 AGENTS 三处（五仓静默清单/五仓窗口措辞/值日群裁定行新机制）、registry 四处（duty commands 打卡/值日群裁定行/bambu 状态路径/活跃看板描述）、duty/hub/ticket/gateway 四仓 README（各自带 DEVLOG 文档批推送上线）、维护者手册四处（单表化/policy 占位/hub 12h/bambu 可靠性）、搭建指南（approval-bot 改维持现状）、桌面 HTML 七处（12h/打卡/两表/M4/版本行等）。
- **顶层 DEVLOG 头部指针漂移订正**（v57→v60，连续批量中漏改）。
- **运维台拍板收项**：不自启维持、无口令维持——意图文档销项并记入已定口径；动态广场「四表」表述随 gateway v18 单表化订正为两表。
- **机器人体系建设推荐**：意图文档新增第四节，产出 7 条待拍板推荐（共享工具层收敛/写端点鉴权模板推广/网关投递 at-least-once/部署前测试闸门/NAS 数据每日快照/全链路 traceId/前瞻 LLM 兜底与双应用预案），每条含痛点→方案→成本→优先级，等你勾选排期。

### v62 · 2026-09-13 · 随本提交落地 · fix

**全项目深度代码审查批：五仓 20 处确认 bug 修复 + 工程规则成文（duty v20 / hub v84 / ticket v68 / gateway v21 / bambu v26）**

三路并行深度审查（duty、hub+gateway、ticket+bambu）确认 20 处真实 bug，全部修复：
- **duty v20（9 处）**：收口不幂等双计补偿、18:30 后补位者无会话被记未做完、看板 4 人日隐藏第 4 人、排班把未来插入日当 lastDuty、补位可落过去日期、placed 标记非原子、询问/提醒无逐人隔离、并发请假竞态、状态文件损坏自毁（原子写+损坏保留现场）。
- **hub v84（3 处）**：/api/ddl/pending 不过期清理（值日询问被永久错误附加冲突提示）、失败回退顺序丢记录、多项目待确认「是」恒完成第一条。
- **gateway v21（2 处）**：**v19 重试整体不可达**（SDK start() 永不 reject，改为 onError/getConnectionStatus 回调驱动 + 30s 巡检；hub/README 同步）、usage 只挂 SIGTERM 丢 60s 统计。
- **ticket v68（1 处）**：通讯录失败永久负缓存致组别解析终身退化——失败不缓存。
- **bambu v26（4 处）**：分发中重启任务永久丢失（in-flight 显式追踪，恢复重回队列）、printing 幽灵滞留（10 分钟巡检补收尾）、manualOnly 不移出队列被自动匹配覆盖、重试耗尽单人工恢复通道。
- **工程规则成文**（顶层 AGENTS 新节「全局工程规则」）：管理/写端点必须鉴权（auth.js 模板）、DEVLOG 头部指针随批维护（已三次漂移）、行为改动必须过桩测试。
- **文档补缺**：ticket-pm/LOGIC-MAP 接单门禁已知边界、bambu README「可靠性与自愈」节。
- 回归：duty 五套、hub duty-branch、ticket 22+12、gateway usage-sync、bambu 4 套全部通过。意图文档待拍板清单维持 3 条 + 体系推荐 7 条。

### v63 · 2026-09-13 · 随本提交落地 · feat

**体系推荐落地批：统计覆盖规则 + 写端点鉴权铺开 + 部署前测试闸门 + 投递可靠性 + traceId + NAS 快照（R2-R6 授权先做；hub v85 / duty v21 / ticket v69 / approval v34 / bambu v27 / gateway v22-v23 联动）**

- **队员/功能统计覆盖**（回答「队员活跃是否只读交互/能否扩覆盖」）：网关路由层只看得见 @/私聊/显式路由——新增 `POST /api/usage/report`（X-API-Token）归因通道（recordFeature 只加用户与功能计数不加 total 防双算）；hub 关键词回答命中（@与未@）与 DDL 确认回复已接入上报。AGENTS「全局工程规则」成文第四条：新交互能力必须在命中点上报，此后新功能自动被队员活跃/功能统计涵盖。
- **R2 写端点鉴权铺开五仓**：gateway auth.js 同款模板分发 duty/hub/ticket/approval/bambu（src/auth.js，API_TOKEN 全局共享值 fail-closed）；管理/写端点全部锁定（duty policy/whitelist/refresh/test-*、hub autoreplies/keywords/projects/logs、ticket sync/bot-*、approval test-*、bambu 打印机控制与对账）；`/api/chat/command` 与 `/api/feishu/event` 为用户可达链路不挂闸。运维台 /api/nas/api 代理对 POST 自动附共享头（凭据直读 approval-bot/.env）。NAS 实测：五仓无 token 全 403。
- **R4 部署前测试闸门**：六个 push.js 部署前自动跑本仓全部 stub 测试，失败中止（SKIP_TESTS=1 可跳）。自证有效：hub 首推即被闸门拦截一次。
- **R3 投递可靠性**：deliverTo 失败 3s 后重试一次 + 按消费者失败计数，/api/health 新增 delivery 字段。
- **R6 traceId（部分）**：网关路由层生成 evt_xxx 随转发载荷透传并打日志；各仓接入随改随加。
- **R5 NAS 快照**：/home/qianli/scripts/snapshot-data.sh（tar 各 *-data → backups/YYYY-MM-DD/，14 天滚动）+ crontab 每日 03:30，首拍已验证。
- **状态**：R1（共享工具层收敛）排下一批次（纯重构需整批回归）；R7 维持前瞻（LLM 需密钥决策、双应用需量级触发）。
- 鉴权值统一：网关 GATEWAY_API_TOKEN 与五仓 API_TOKEN 同值（gateway v23），运维只记一个。

## v64 · 2026-09-14 · 随本提交落地 · feat+docs+fix

**网络拓扑看板上线 + 部署目标迁移收尾 + 实验室网络 skill 与全局规则 + 联动 duty-bot v22(写表 bug 修复)**

- **运维台新增「🌐 网络拓扑看板」**：`GET /api/network` 五节点并行 TCP 探测（互联网/飞书云/主路由/小电脑/旧NAS，2.5s 超时封顶）+ 出口 IP（`/api/egress-ip`，5min 缓存）；前端分层拓扑图（云端/网关/本地设备）带端口时延徽标，30s 自动刷新。拓扑清单 = server.js `NET_TARGETS`（改拓扑先改它）。运维台 UI 口径全量「NAS」→「主机」（24 处；API 路径 `/api/nas/*` 与 `NAS_*` 键保留为历史命名）。
- **部署目标迁移收尾**：AGENTS 新增「部署目标」权威条目（小电脑 DESKTOP-FE1MIGI 192.168.31.57:22，旧 NAS 10.253.33.233 停用为备件）；qianli-deploy SKILL 与 9 个 README/指南全量「NAS」→「部署目标」表述清扫（历史命名标注）；运维台开机自启落地（启动文件夹 VBS + dashboard/autostart.bat 守卫启动器）。
- **全局规则新增**：AGENTS「会话遗留改动回库与文档补链」——agent 会话未随批入库的改动，下一会话 push 前必须 `git status` 盘点、合并提交、补齐文档。
- **新 skill**：`.agents/skills/qianli-lab-network/SKILL.md`——实验室网络拓扑/设备接入/断网排查手册（假 ping/TTL、路由环路、UAC 远程过滤、bat ASCII 铁律、MSI 静默失败、pm2 环境快照、bash & 链式陷阱、飞书 IP 白名单指纹）。
- **联动 duty-bot v22**：bitable.js `batchCreateRecords` 双层包裹修复（`{fields:{fields:{...}}}` → 飞书 FieldNameNotFound 1254045；排班批量写入自上线首次成功，值日表 90 条首落 2026-09-15~10-14，白名单 13 人含 Siu/汪沛宇 生效）——根因与排障全程见 duty-bot DEVLOG v22 与桌面《工作日志-2026-09-14-网络与机器人抢修.md》。
- **工具**：enable-sshd.bat / install-openssh.bat + OpenSSH-Win64.zip（小电脑 OpenSSH 离线安装组合，sshd 已上线 :22）、fix-duty-bot.bat（duty-bot pm2 环境重建）。

## v65 · 2026-09-14 · 随本提交落地 · feat

**抽奖系统上线（hub v86）：走关键词回答全群链路 + 本地抽奖配置表 + 运维台登记**

- **hub（ticket-pm/project-management-robot v86）**：新增抽奖能力——群消息包含触发词（默认示例「抽奖」）即按概率抽一条奖品文字原文回复，**无需 @机器人、全群生效**（@机器人时同样命中且优先级最高：抽奖 > @触发回答 > 关键词回答，互斥不双回；私聊不触发）。奖品/概率填项目根目录《抽奖配置表.xlsx》（触发词/奖品/概率三列，概率口径与「关键词回答」表一致：留空均分、不足 100 归一化、超 100 压缩、0=永不中），`scripts/syncLottery.js` 随 push 转 `lottery.json` 上线，运行时每消息重读即时生效。定制窗口 `/api/lottery/rules*`（读 + X-API-Token 写，热改 `.local.json`）；`/lottery` 指令查看奖池与概率；命中上报网关统计（feature=抽奖）；`LOTTERY_CHAT_IDS` 可收窄群范围。stub 测试新增抽奖场景全过；README/DEVLOG 同批。
- **联动改动**：dashboard/registry.js hub 登记（抽奖窗口 4 条 + 指令/监听/权限说明）；顶层 AGENTS（职能表归属信号 + 附属窗口现状行补 `/api/lottery/rules*`）；用户侧《机器人总成使用指南.html》与维护者 MD 指南同步抽奖用法；hub DEVLOG 头部指针修复（此前滞留 v82，实际已 v85）并顺手回填 v83/v84/v85 哈希。
- **遗留改动随批入库**（会话遗留改动回库规则盘点）：①hub `push.js` 部署目标迁移收尾路径改动（NAS→小电脑 Windows 路径，上一会话遗留）一并提交，私有上传清单泛化（autoReplies + lottery，同套现网备份+条数守卫）；②`.agents/skills/qianli-lab-network/SKILL.md` 校园网单会话生命线/互踢陷阱/出口 IP 漂移要点（v64 skill 的后续增补）；③**dashboard/server.js 修一个 HEAD 既有 bug**——`/api/network` 响应引用 `t0` 但从未定义（拓扑接口每次必抛 ReferenceError），工作区遗留的 `const t0 = Date.now();` 正是修复行，入库；④approval-bot v36（8dfccd9，纯 docs）：README「部署到 NAS」→「部署到部署目标」表述清扫收尾（v64 清扫漏网），submodule 指针随批更新。

## v66 · 2026-09-14 · 随本提交落地 · refactor

**抽奖改版联动（hub v87）：奖池一行=一个奖品 + 触发词升级为 /指令 + 群聊 /help 精简运维指令**

- hub v87 三连改（用户反馈）：①抽奖配置表改**一行=一个奖品**（触发词/奖品/概率，同一触发词多行=同一奖池，适配大量奖品）；②触发方式从「消息包含关键词（未@全群）」改为**@机器人 发 /触发词 的动态指令**（精确匹配不误伤闲聊；值日管辖群可用、审批群不开放、动态进 /help）；③群聊 /help 不再展示 /status /test-ddl /keywords /autoreply /history 五个运维/诊断指令（仍可直接使用）。stub 测试按指令口径重写全过；README/LOGIC-MAP/registry/用户指南 HTML+MD/顶层 AGENTS 同批。
- 联动登记：registry hub commands/listening/permissions/notes（抽奖指令口径 + help 精简记录）；AGENTS 职能表归属信号改「抽奖（/指令）」。

## v67 · 2026-09-15 · 随本提交落地 · refactor

**抽奖收敛单指令大奖池联动（hub v88）：表格只填 奖品|概率 两列，/抽奖 一个指令对应无限奖品**

- 用户澄清「一个抽奖指令对应无穷可填的奖品和概率」：hub v88 把抽奖配置表瘦身为奖品|概率两列（整表=/抽奖 的大奖池，一行=一个奖品、行数不限），指令名挪到 .env 的 LOTTERY_COMMAND（默认「抽奖」，可改名/配别名）；解析器兼容 v87 旧格式（旧表示例行仍为注释，0 有效奖品）。registry/AGENTS/用户指南/LOGIC-MAP 同批。

## v68 · 2026-09-15 · 随本提交落地 · refactor

**抽奖多奖池定稿联动（hub v90）：一个工作表 = 一个抽奖指令 = 一个奖池**

- 用户定稿：抽奖配置表按 sheet 组织，工作表名即指令名（复制表改名=新抽奖），表内奖品|概率两列行数不限；无「奖品」表头的表自动忽略；LOTTERY_COMMAND 废弃。hub v90（服务层无改动，stub 全过）；registry/AGENTS/用户指南/LOGIC-MAP 同批。

## v69 · 2026-09-15 · 99bdc4d · feat

**新项目 wecom-attendance-bot v1 诞生：企业微信考勤周报机器人（负责人群每周播报打卡数据）**

- 功能：定时（默认周一 09:30 上海时间）调企微 `checkin/getcheckindata` 拉上一完整周打卡记录（考勤机已同步进企微，不碰硬件）→ 按人聚合打卡天数/异常 → 群机器人 webhook 播报 markdown_v2 周报卡 + CSV 明细附件（替代手机手动导出）；补发看门狗每小时对表（漏播/失败自动补，水位防重复）；拉数失败向同群发告警卡（webhook 不走可信 IP，60020 附处理提示）；
- 架构裁定：**企业微信域项目**——不消费消息事件、不接 feishu-gateway、不受对话铁律/统计上报规则约束；部署共用顶层链路（repo:top 模式同 gateway，SFTP 直传小电脑，pm2 名 `wecom-attendance`，端口 3007）；members.json 沿用 duty-bot 备份+守卫；写端点 X-API-Token 照 gateway auth.js 模板；
- 四套桩测试 51 断言全过（窗口时区锚定/聚合渲染/存储/企微分批），push.js 内置测试闸门；开发期修三处真 bug：weekWindow 双重时区转换、分批断言边界、nextSendTime 前后方向（node-cron 3.x 无 nextDates，下次执行时刻自算）；
- 同批登记：dashboard/registry.js 新增 wecom-attendance 条目、qianli-deploy SKILL 项目清单收编（六个项目）、顶层 AGENTS 职能表加行、用户指南 HTML 增补；本批入库说明：v68 归档时本目录曾被误扫入库、由 `11fef0e` 撤出并留言待本项目会话规范入库，本批即该正式入库；
- 待办：企微管理后台建自建应用+「打卡-可调用接口的应用」授权+可信 IP 后回填 `.env` 的 WECOM 三项与成员名单，`POST /api/attendance/test-broadcast` 真发验证；「缺卡判定」留 v2。

## v70 · 2026-09-15 · 7c836f9 · fix

**全项目深度审查修复批：五路并行审查六域，P0 级纰漏当晚清零**

- 审查范围：gateway / ticket-bot / hub / approval-bot / bambu / duty-bot / wecom / dashboard / 顶层文档一致性（五路并行代码审查，逐条 file:line 证据）。各仓修复明细见各仓 DEVLOG 当批条目（wecom v2、pm-robot v91、ticket v70、duty v23、bambu v28、gateway v25），要点：
  - **数据保护**：wecom/duty 两仓 push.js 守卫时序缺陷修复（rm -rf 之后才读现网=守卫+备份整体失效，2026-09-12 白名单覆盖事故的完整复现路径）——盘点前置于目录替换、种子过期跳过并回写现网、policy-override.json 入保护清单；
  - **功能性 bug**：hub DDL 确认漏 require usageReport（ReferenceError 吞统计+中断事件链）；ticket 组长解析负缓存回归（v68 漏改第三处）；bambu 六写端点漏鉴权（可绕审批开打印）；wecom 部署路径/静默闸门/长度熔断/健康检查；
  - **安全**：dashboard 命令注入面关闭 + 裸 spawn 分支移除 + Host 校验；gateway 投递统计如实计数；
  - **部署链**：ticket/duty/wecom/gateway 四仓 push.js restart 步骤补 PATH（小电脑非交互 shell 无 node/pm2，代码已传服务不重启）；
  - **文档**：维护者手册 MD 补 wecom（六大→七大机器人）；registry 四处漂移；六仓 DEVLOG 指针与占位哈希全部落定；approval-bot 积压 commit 推上 GitHub；
  - **遗留改动入库**：ticket-bot 部署目标迁移适配（上次会话遗留 README+push.js 未提交）随本批规范入库。
- 桌面《qianli-设计意图待定项.md》同步：wecom 上线前置待办（凭据/名单，09-21 首播前）、已落地清单、新增建设推荐 R8~R14。
- duty-bot 白名单增补 3 人（洪博寰/郝骏锋/zyicome，值日排除名单 13→16，写窗口操作有备份）；值日助手全链路（gateway→hub→duty-bot→webhook）注入式实测通过。

## v71 · 2026-09-15 · 随本提交落地 · feat

**wecom-attendance-bot v3：播报并入现有飞书体系（用户拍板「应用也走现有应用」）**

- 用户提供飞书负责人群自定义机器人 webhook，播报主通道切到飞书群机器人（数据源仍=企微打卡 API）：新增 `src/feishu.js`（webhook 卡片+签名，对齐 duty-bot webhook.js；CSV 经现有应用 im API 可选）；调度器改每通道独立投递水位（重试只补未送达通道）；失败告警双通道；health/policy 增通道布尔。通道连通性已真发验证（code:0 入群成功）。
- 新增 stub-test-feishu（18 断言）六套全过；修异常明细行日期重复渲染。registry/项目 AGENTS/README/用户指南 HTML 同批改口径。

## v72 · 2026-09-15 · 8f8a4f9 · feat

**R8~R14 建设推荐全量落地批（接 v70 审查批；R13 运维项与 4 项部署待回站补做）**

- R8 bambu v29 分发可靠性包：failTask 运行期失败接入重试/让位通道（原只回写「排队中」不重排，单据永久滞留）；givenUp 落盘（人工恢复通道重启失效）；sweepStalePrinting 补审批源守卫；dispatcher-persist-test +6 断言。
- R9 hub v92 交互互扰治理：DDL 确认在 p2p 对值日词表让位——「打卡/打卡了」恒让位（不再误发「请回复是/否」），口语变体先转 duty-bot（有活跃值日会话才接管，否则回落 DDL 确认）；循环加载链改调用时惰性 require；stub +6 断言。
- R10 鉴权收尾：FEISHU_VERIFICATION_TOKEN 共享密钥补配到网关+四仓 .env（转发帧注入 token、消费方校验真实生效，event 端点 fail-open 关闭）；query token 传参废除（gateway/duty/wecom auth.js）；hub projects 写动词+logs+test-broadcast 补 X-API-Token；bambu useLongConnection 缺省翻转 false（空壳模式防误配）；gateway health 对非回环调用方收窄为存活摘要。
- R11 gateway v26 投递语义：事件模式下游 HTTP 失败与传输异常同款重试一次（消费方 messageId 幂等）；command 模式保持不重试（指令无幂等键防双执行）。
- R12 ticket v71 接单锁全局化：多组别工单跨群并发 chatId 锁盲区关闭，stub-test-multi-accept 新增跨群回归（24 项）。
- R13 卫生批：approval/bambu/ticket/duty 数据路径 POSIX→C:/home 显式化；wecom push 重启改 delete+应用目录 start（修 cwd/快照残留）。**待补**：pm2-logrotate 安装、开机自启复核、wecom cwd 修正重启（目标机不可达）。
- R14 dashboard 服务看门狗：逐时 SSH 巡检 registry 全部 pm2 服务 health，连续 2 轮异常/恢复推群 webhook（duty 群通道，WATCHDOG_WEBHOOK_URL 可覆盖），过静默闸门+12h 重提醒；GET /api/watchdog。
- **待补部署**（本机随用户离站、家庭 LAN 不可达，代码均已推 GitHub）：gateway v26、duty v24、wecom v4 三仓 SFTP 部署；回站后各仓 npm run push 即可（git 步骤无改动，直达部署）。

## v73 · 2026-09-16 · fb9abd7 · feat

**wecom v5 方案4：打卡数据源改人肉周导（名单问题随批解决）**

- 背景与拍板：企微自建应用配置可信 IP 被强制门槛拦截（须先有可信域名/接收消息回调，均需公网可达，家里 NAT 无解），用户拍板放弃 API 走方案4。凭据已验证有效（gettoken ✓，打卡接口 48002 待门槛，API 链路保留可切回）。
- wecom v5：新增 importService（xlsx/csv 报表解析，表头模糊匹配+上海时区三态换算）+ POST /api/attendance/import（X-API-Token，base64 上传；**解析即名单自动合并落盘——名单不再需要手工维护**）+ runWeekly 数据源分支（按播报窗口过滤，未导入/窗口未覆盖时给明确错误，cron 未导入走失败告警群内可见）；`ATTENDANCE_DATA_SOURCE=import` 已切。
- stub-test-import 15 断言（七套全过）；wecom 桩测试凭据隔离（真实凭据入 .env 后不再依赖"env 为空"前提）。
- registry 标注 import 端点；AGENTS/README 数据源口径更新。

## v74 · 2026-09-16 · 960ec4c · fix

**值日私信链补强（duty v25）+ 运维台看门狗误报修正（R14 v2）**

- duty v25（取证驱动）：09-15 六个定时任务全部正常触发、无发送失败，但 3 名成员全天零响应被收口未做完——缺口在触达频次与收口告知。新增 **21:00 临门提醒**（收口前 1 小时私信未完结队员，分态引导：已传照片只需打卡/未传引导照片+打卡/做不完告之后果）；**收口私信未做完者本人**（missNotices：补偿预告+值日助手引导；photoOnly 保留兼容）。stub-test-flow +8 断言；cron 任务 5→6。
- dashboard 看门狗 v2：修复 09-16 00:41 误报（本机随用户离站，SSH 失败被当成目标机故障，半夜告警进群）——**分层探测**：先探家庭网关 192.168.31.1，路由器不可达=本机离站，巡检挂起不告警；告警静默窗口加宽 02:00–09:00 → **23:00–09:00**（WATCHDOG_QUIET_START/END 可配）。附带清理：stub-test-board 退出竞态加固（libuv handle closing 崩溃致闸门闪失败）；运维台旧实例已重启换新代码。
- 运维持意：pm2-logrotate 轮转后 pm2 daemon 日志句柄不重开（新日志写进轮转文件、新文件 0 字节）——`pm2 reloadLogs` 重开，已执行；duty-bot 同批重启恢复正常日志。

## v75 · 2026-09-16 · 05d9226 · feat

**运维台改名「曼波大模型」+ 网络拓扑真图 + 路由器在线设备发现**

- 改名：页面标题/横幅/启动日志/registry 标签 → 「曼波大模型」（内部标识 dashboard/:3100 不变）。
- 拓扑树重画：云端（飞书/互联网）→ 出口 IP（主干标注）→ 主路由 → 分支（笔记本·曼波大模型/小电脑/旧NAS + 发现的在线设备），CSS 连线（rail/trunk/stub）替代原分层卡片。
- LAN 设备发现（GET /api/network/lan，60s 缓存）：ping 扫本机所在 /24 填充 ARP → 解析 arp -a → 已知设备（主路由/小电脑/旧NAS）合并标注，其余显示 IP+MAC 前缀+厂商猜测；本机不在家庭网段返回 offsite（前端挂起提示）。实测发现 11 台在线设备。
- NET_TARGETS 补 3007（wecom）端口探测。
- 附：approval-bot / pm-robot 有并行会话进行中的工作（未提交改动与默认信息提交），本批仅锚定其 gitlink 现状，未触碰其内容。

## v76 · 2026-09-16 · 8a877cc · fix

**全量 debug 回归批二：新代码复查修复（wecom v6 / duty v26 / gateway v27 / dashboard）**

- 两路并行代理复查今晚新代码，确认缺陷当晚全修：gateway deliverTo 重构（R11 重试失败误入传输 catch 致三连投递+failed 计数污染，改为统一按尝试计数）；wecom 导入防呆（≥2 时间列判定日报/统计模板直接报错、空姓名+空账号行跳过防幽灵用户）；duty 临门提醒会话补建（防打卡无人认领误记未做完）+ missNotices 幂等守卫（双跑私信不重发）+ 管理摘要标注未绑定未通知 + test-lastcall 端点；dashboard LAN 声明补齐（首屏 ReferenceError）、lanScan 错误缓存 TTL（防 30s 轮询重扫）、看门狗发送风暴守卫、Host 校验补 [::1]、shellSafe 剥 %。
- 遗留观察项（低危，详见桌面《设计意图待定项》）：xlsx 0.18.5 已知 CVE（输入面受控）、LAN 网段前缀硬编码、恢复通告静默丢弃、smoke-test 未附 token 失效等。
- 另发现并记录：昨晚消费方先上 token 而网关未注入的窗口期（约 23:40–00:45）转发事件会被 403 拒收——已自愈（网关 v26 注入验证 ✓），后续部署顺序应先网关后消费方。

## v77 · 2026-09-16 · 37c335c · fix

**运维台全交互审计修复：hub 快捷部署 cwd 错误（用户上报）**

- 用户从运维台点 hub「npm push 部署」报 Missing script "push"：registry hub.dir 指到 server/ 子目录（无 push 脚本）。修正 dir=项目根 + localRun.script=server/src/index.js + test-duty 动作 cwd=server（脚本在 server/scripts，依赖 server/src 相对路径）。
- 全交互审计：registry 全项目动作静态核验（push/install/test 脚本与 cwd 逐项存在性）+ 全部 HTTP 端点动态探测（overview/stats/activity/windows/network/lan/watchdog/egress-ip/action-log/nas-log + SSH 代理直达六服务 policy 与 hub 规则 CRUD 路由）全部 200；动作链以 hub test-duty 真实跑通（exit 0）。
- 目标机补 pm2 reloadLogs（logrotate 轮转后 daemon 日志句柄残留问题波及 wecom，已恢复）。

## v78 · 2026-09-16 · f324145 · docs

**push.js 部署目标文案清扫（gateway/bambu，docs）**

- 用户问「真的是传到 NAS 吗」——核实：hub 实际目标=小电脑 192.168.31.57（server/.env NAS_HOST，/c/qianli/opt/knowledge-tracker，文件时间戳佐证），「NAS」仅为历史命名残留文案。四仓 push.js 用户可见文案统一清扫为「部署目标」（hub 15 处/ticket 13 处/gateway 3 处/bambu 7 处）；NAS_* 变量名保留（顶层 AGENTS 已成文其语义）。
- 联动：hub v93（6a3e228）、ticket v72（8f40cb7）各自仓库已推；gateway/bambu 随本提交归档。

## v79 · 2026-09-16 · dcf3759 · docs

**NAS 残留全链清扫（docs；approval/hub 因并行会话占用跳过待补）**

- .env.example 五份里的四份（gateway/ticket/duty/bambu）：旧 NAS 地址端口用户（10.253.33.233:8500/qianli）→ 小电脑实际值（192.168.31.57:22/mechax），注释统一「NAS_ 为历史命名，语义=部署目标」——照抄模板的新部署不会再连去旧 NAS。approval/hub 的 example 因并行会话占用未动。
- 文案：duty push.js 头注释与 init-duty-table 输出、gateway auth 注释、dashboard 拓扑注释 → 部署目标口径。
- bambu push.js 移除旧 NAS 时代的 sudo/chown qianli:qianli（新机不存在该用户，此前全靠 `;` 容错；顺带消除命令行带密码的泄露面）。
- 联动 duty v27。

## v80 · 2026-09-16 · 08bd733 · feat

**运维台 UI：拓扑卡片统一栅格 + 未识别设备踢出/封禁**

- 拓扑卡片改统一栅格（auto-fill 176px 等宽、等高裁剪、端口芯片超出折叠 +N），消除大小不一；样式与暗色主题统一。
- 未识别设备新增「踢出/封禁/解封」：走小米路由器管理 API（router-xiaomi.js，社区公开登录算法：key→nonce→sha1 链→stok；设备列表 devicelist；禁用上网按固件候选端点尝试并带回原始响应）。封禁名单持久化 .banned-devices.json（离线也展示、解封恢复），凭据=approval-bot/.env 的 ROUTER_PASSWORD（未配置时按钮返回明确引导，不发路由器）。GET /api/router/status。
- 已实测：登录算法需真实密码验证（待用户提供 ROUTER_PASSWORD 后联调端点命中情况）。

## v81 · 2026-09-16 · 随本提交落地 · docs

**duty-bot v28 锚点归档：照片凭证下载接口修复**

- duty-bot v28（随本提交归档）：照片收录「传不上去」根因修复——旧下载接口 `im/v1/images/{key}` 只能下机器人自传图，用户图片一律 234001（功能上线以来零成功）；换消息资源接口 `im/v1/messages/{id}/resources/{key}?type=image`。取证→线上实弹验证（旧接口复现基线/新接口形状被接受/drive 上传权限已具备）→五套桩测试全过→部署重启全绿。
- 本批仅 duty-bot 单仓行为变更，顶层无代码改动，纯锚点归档。

## v82 · 2026-09-17 · 随本提交落地 · feat

**全量 debug 批（七仓联动）+ duty-bot v29 快递助手上线**

五路并行代码审查（gateway+hub / ticket / duty+wecom / approval+bambu / dashboard+文档）→ 修复实现 → 各仓 stub 全绿（duty 6 套含新 express 29 项 / ticket 24+12 / wecom 7 套 / approval v39 扩充 / bambu 4 套 / gateway）。要点：

- **duty-bot v29 快递助手**（新功能）：快递申领群 @「/快递」开 5 分钟登记窗口（群内非@取件码/照片经 hub 观察转发收集，架构铁律不破），写「机器人项目看板」base「快递」表（用户手工建表+脚本补 登记时间/取件时间/消息ID）；每小时整点未取播报（过静默闸门）；「已取n/全部已取」确认回写；「查询当前快递」；词形/指令子集经 duty policy 下发 hub 消费。
- **hub v94**：值日分支④误拦口语词修复（groupCommands 拆分）；快递助手路由+观察转发+duty 转发 8s 超时；P0 修复 .gitignore/*.local.json 通配 + push 私有清单补 mention 表（真实姓名不再进 git）；plaza appToken 死配置修活；auth 废 query token；权重 0 语义；broadcast-state 可外迁；.env.example NAS 收口。
- **ticket-bot v73**：广场文案 undefined 修复；搬运不再打回 priority 编辑；reconcile 防重入+broadcast per-record 锁（双播关闭）；webhook URL 脱敏；审批反查翻页；event fail-closed；字段名接 config；push 远端 node 探测；DEVLOG 指针 v69→v73 + 三版哈希回填。
- **approval-bot v40（含 v39 工作区批收口上线）**：催发票 parseDeferDays 复合中文数字/间隔闸日历日比较/当日新增关注不再吞卡 三处逻辑 bug；桩扩到 ×16+48h 边界。
- **bambu v30**：审批直连重启 trigger('restore')；sweepStalePrinting 落盘；approval_task 失败可重试；webhook 超时；配置收口。
- **wecom v7**：import const 崩溃修复（09-21 首播前关键）；push 名册守卫补「本地缺文件→远端回填」；CSV 落盘兑现；cron 过静默闸；policy 不漏打卡明细；+8h 口径；fetch 超时；quietHours 双格式。
- **dashboard/registry**：抽奖编辑器错表 P1 修复；wecom action 窗口 registry 驱动；ROUTER_PASSWORD 闭环；router-xiaomi AbortSignal；看门狗恢复过闸+host 键回写；registry 漂移修正+快递助手登记。
- **文档**：桌面《机器人总成使用指南.html》+《使用指南.md》同步（七大口径、duty 21:00/快递助手、approval v39 节奏、快递播报卡/快递表、定制中心 wecom/抽奖行）；ticket-pm/LOGIC-MAP 四处修正；AGENTS.md 值日 bullet+职能总表加快递助手。
- **运维发现（待拍板，见桌面意图文档 #5）**：「动态广场」表已不在 base（TableIdNotFound + 重建重名=回收站占名），各仓广场事件写入自删除起静默失败；建表脚本已加容错+大声告警。桌面《qianli-设计意图待定项.md》新增本批落地清单（八）与建设推荐 R15~R24（九）。
- 部署顺序：duty → hub → ticket → approval → bambu → wecom → 顶层。

### v77 · 2026-09-19 · 随本提交落地 · fix

**四仓联动修复批：R25/R26/R27 落地 + 杨杨文琦请假事件修复 + 日志基建回归处置**

- **hub v100（d195062）**：DDL 播报错峰 `CRON_SCHEDULE` 12:00→12:05（09-18 当日播报被限频炸掉的治本补丁，生产已验证下次执行 12:05:00）；duty 转发超时 8s→15s + 超时文案改「可能已受理，以私信回执为准」。
- **duty-bot v32（d6fef48）**：补偿义务满周自动顺延下周（deferCount+对账报告可见，不再静默留队到过期）；请假回执不再 await 被抽调人私信；flow 断言定向 D+新增顺延断言（09-18 日期敏感误报第三次复发的根因修复）。
- **approval-bot v41（158034a）/ bambu v31**：`npm test` 由 echo 占位改为与 push.js 闸门同一清单（R27），纯元数据批。
- **杨杨文琦请假事件结论（09-18）**：私聊 4 次交互（20:07、21:56×3）全部 hub 转发超时误报失败——duty 侧实际把 3 条补偿义务（09-19/09-27×2 含连续缺勤加罚）全部登记成功，属「回执超时误报失败」而非功能坏；本批 hub+duty 双侧修复。
- **运维事件：日志基建回归**——意图文档六.5 已判「不可用」的 pm2-logrotate 模块实际仍在跑（09-16 15:50 起 uptime 2.78 天），retain:7+高频轮转把 09-18 白天前的全部日志吃光（qianli-log-truncate 的 archive 归档因轮到它时日志已被清空而恒空）；已 `pm2 delete pm2-logrotate`+save，qianli-log-truncate（每小时 14 分，归档 14 天）为唯一轮转通道，日志恢复积累。教训：模块卸载后需复核进程表。
- 文档：hub README/LOGIC-MAP §2.2/指南 MD/桌面 HTML DDL 播报时刻 12:00→12:05；duty README 补偿/对账节；意图文档 R25~R27 落地标注。
- 部署顺序：duty → hub → approval → bambu → 顶层。

## v83 · 2026-09-20 · 随本提交落地 · fix

**全量 debug 批（六仓联动）：两处 P1 生产 bug 根因修复 + 限频/写放大治本 + 网关部署悬空收口**

五路并行代码审查（四路子代理分仓 + 网关本地深审）+ 部署目标实机盘点（pm2/健康/日志/文件指纹/七仓 .env 键名比对），修复全部过桩测试后按 gateway→hub→ticket→duty→approval→wecom 顺序部署。

- **P1 · approval-bot v42**：催发票回复轮询 230001 根因——`start_time` 毫秒误用（接口收秒级）+ `end_time` 缺失，凡私聊催过的用户回复轮询必失败、「延期/无法提交」永不识别（上线以来即病，v40 修的是同模块别处、桩未覆盖该路径故漏网）；另补会话消息/通讯录部门翻页。桩新增 230001 回归锁。
- **P1 · hub v101**：关键词监听图片转存仍用旧 `im/v1/images` 接口（用户图一律 234001，生产 error 刷屏、发言表图片静默丢），换消息资源接口（duty v28 同款）；快递观察转发富文本图文分离（v97 透传实为无操作，图全丢）改先文后图借 duty 配对逻辑补挂；DDL 卡 week 桶修复（此前 `daysLeft<=7` 全进 urgent，「7日内」栏恒空、降级链路错标加急）；approval/print/webhook 三处转发补 15s 超时。
- **ticket-bot v77**：每分钟对账无条件重写目标行的写放大加 diff 门控（`unchanged` 跳写，治理共享应用配额压力——duty 1254290 与查父项目超时同源）；缺行修补扩展「缺 parentId」双条件；过滤公式值转义（项目名含引号致永久缺挂）。
- **duty-bot v33**：快递表读取 1254290 短退避重试（读幂等，写路径维持不重试）；cron 状态计数失真修复（快递任务加入后 7 任务判 ===6，`running` 恒 false）。
- **wecom v8**（09-21 首播前收尾）：feishu.js fetch 补 15s 超时（防占死 guardedRun 锁）；发送失败告警文案修正（首启无水位不自动补发，补手动 test-broadcast 提示）。
- **gateway v28**：字段结构变更事件（`bitable_field_changed_v1`）补注册+静默忽略（SDK warn 曾淹没 error 日志）；**v82 批 gateway 改动未部署的悬空收口**（内容级 diff 核实仅注释/测试脚本差异，运行时行为一致）；DEVLOG 指针 v25→v27 漂移修正。
- **实机盘点结论**：七进程全绿、网关 ws running、投递 2506/0 失败；ticket v76/bambu v31/wecom v7 部署与本地逐字节一致（bambu 仅 package-lock、wecom 仅 DEVLOG 差异）；七仓本地 vs 目标 .env 键名集合全对齐。
- **运维发现（记桌面意图文档）**：桌面《qianli-设计意图待定项.md》与《机器人总成使用指南.html》双双丢失（桌面/回收站均无，不可本地恢复）——意图文档本批重建，HTML 待用户定性后重建；bambu `APPROVAL_CODE` 未配（审批对账②腿窗口兜底不生效，需用户从审批后台取定义 code）；运维笔记本双网卡同网段+SSH 源 IP 显示主路由（hairpin NAT）现象记入 qianli-lab-network skill §十；4A OpenWrt 入网后需补运维台 NET_TARGETS。
- 测试：duty 六套 / hub 三套 / ticket 24+18+16 / wecom 七套 / approval（含新回归锁）/ bambu 四套全绿。遗留：`.agents/skills/qianli-lab-network/SKILL.md` 上会话 4A 拓扑改动随本批入库并补 §十（双网卡/SSH 源 IP/部署目录路径核实）。
- 部署顺序：gateway → hub → ticket → duty → approval → wecom → 顶层。

## v85 · 2026-09-20 · 随本提交落地 · docs

**网关批：裁判系统路由器入网（第三网段）+ 根目录《网关拓扑文档.md》新建 + skill §十一**。记账修正：上一批锚点提交（6661aa6，"顶层锚点 v84"）未建 DEVLOG 条目且头部指针滞留 v83，本批一并修正——v84 内容已并入 v83 条目尾部 bullet，不再补拆条目。

- **裁判系统路由器（第三网段 192.168.3.1/24）入网**：wan=DHCP 实测 `192.168.31.80`（MAC `CC:C4:B2:46:16:2F`，在线稳定）；WiFi `裁判系统` 已启用（密码用户设，不入库）。定位=机甲大师物理机器人 + 裁判端电脑专用——**术语澄清**：与六仓飞书软件机器人无任何关联，文档已立术语区分。
- **小电脑跨区防火墙**：SSH（IS-ADMIN 实证）加 `Referee-Zone-192.168.3.0-24` 入站全协议放行 → **物理机器人→小电脑后端链路全通**；反向（小电脑→物理机器人）🟡 待裁判系统官方软件发布后在裁判路由器加端口转发（主网关 miwifi 无静态路由功能，3.x 无回程路由）。
- **4A 打印隔离区收尾定稿**：三条防火墙规则由设计稿 192.168.1.x 编址改指现实网段（Mgmt/主网→打印区/打印区→小电脑回推，回推目标=192.168.31.57）；`Printer` 2.4G WiFi 启用（ap_isolate=1）；与 v84 批已入库的保活脚本铲除、错位租约/旧 DNAT 清理合并为完整改造记录。
- **文档**：新建根目录《网关拓扑文档.md》（术语约定/三网段总表/总览图/设备与防火墙台账/通信矩阵/运维台账，密码零入库）；skill 追加 §十一 裁判路由器节。
- **运维台账**：主网设备全量清单改用主网关 miwifi API `misystem/devicelist`（运维台 `/api/network/lan` 代理读取漂移实测 total 0/3/9/12/21 不定）；路由器静态地址固化走客户端侧（wan 改静态 IP），miwifi 静态租约无公开 API 端点；笔记本拓展坞静态 IP 迁 3.2 需 UAC（两次弹窗未成，转用户手动或待办）；4A `/root/test.clc` 遗留文件待用户定性。
- 待办（承接）：4A wan 插线验证 + 运维台 `NET_TARGETS` 补录（4A/裁判路由器条目）；打印机入区五连；裁判系统端口转发（待发布）；bambu `PRINTER_HOSTS` 填 2.x 地址。
- **运维台拓扑看板**：`NET_TARGETS` 新增裁判系统路由器条目——其 wan 侧 TCP 管理口被自身防火墙挡（设计如此），TCP 探测恒红会误报断网，故新增 `icmpProbe`（spawn ping）探活类型并前端加树位（ICMP 实测 2/2 通）；4A 条目待其 wan 入网配静态地址后补。
- **拓扑追记（同批）**：NAS 挪入交换机后 DHCP 由 .151 重分配为 **.153**（2222/3923 双开实测），运维台 `NET_TARGETS` oldnas 目标已同步；总览图补 5 口千兆交换机层（有线汇聚，大流量本地交换不过主网关）与主网关全 2.5G 口规格（BE6500 Pro：4×2.5G，LAN1=笔记本拓展坞 2.5G、LAN2=交换机上行）。

## v86 · 2026-09-20 · 随本提交落地 · docs

**拓扑勘误**：总览图 LAN1 的"运维笔记本拓展坞 31.2"条目删除——该线为 4A 配置时代遗留未拔，并非专用运维通道（用户澄清）；笔记本日常走 WiFi（31.182），LAN1 转预留，需网线直连 2.x/3.x 时临时改拓展坞 IP 即可。skill §十 双网卡现象随之自然消解（收敛后复测待办保留）。

## v87 · 2026-09-20 · 随本提交落地 · docs

**勘误批：裁判系统路由器归属纠正 + 运维台误报条目撤除**。用户复核"你确定裁判系统在线？？？"触发三路实证（探测/ARP/SSID 空中扫描）：用户已拔线，但 31.80 仍被 MAC `cc:c4:b2:46:16:2f` 应答（ping 延迟 171ms 反常、SSID 已消失）——证实该设备**不是**裁判路由器，v85 的归属属误判（当时仅凭"新出现 MAC+插线时间吻合"归因，违反本 skill §三"MAC 前缀级证据"原则的教训入档）。

- **运维台**：撤除 referee 探测条目与前端树位（`icmpProbe` 能力保留，4A 部署时可复用）；`/api/network` 复核 referee 不在列。
- **skill §十一 重写**：裁判路由器=已配置（LAN 3.x + WiFi）待部署；误归属勘误入档；新路由器"先脱机改段再入网"教训保留。
- **《网关拓扑文档.md》**：裁判区改"已配置·待部署"，通信矩阵改"部署后即通"；新增 §四.1 待认领设备（31.80 / cc:c4:b2:46:16:2f）。
- 待认领：31.80 未知设备请用户按 MAC 定性。

## v88 · 2026-09-20 · 随本提交落地 · docs

**《网关拓扑文档.md》补 §二.1 双子路由对照表**：主网关下将同时挂 4A 打印区（2.x）与裁判区（3.x）两台子路由，按网段/机型/服务对象/状态/出向策略/小电脑侧放行/管理入口/看板条目/入网铁律九维对照成表——本会话曾发生 4A↔主网关、未知设备↔裁判路由器两次归属混淆，表格即防混淆工程。

## v89 · 2026-09-21 · 随本提交落地 · fix

**运维台看门狗 SSH 探测加重试（链路抖动误报修正）**

- 事故背景：2026-09-21 中午校园网链路劣化窗口（网关 self-signed certificate 指纹、飞书 API 面性超时）致 hub 12:05 DDL 播报超时丢失（补播与 hub 侧重试修复见 project-management-robot v103）；当晚 18:38 看门狗单轮 SSH 握手超时（`Timed out while waiting for handshake`）把「部署目标(SSH)」误标 degraded——实际目标机健康、7 进程全在线，用户侧表现为"很多机器人状态死了"。
- 修复：`dashboard/server.js` `watchdogCheck` 的 SSH 巡检失败后隔 15s 重试一次，两连败才判整机失联（此后各端口 health 巡检与 2 连击告警逻辑不变）。
- 同批运维动作（不入库）：12:05 丢失的 DDL 播报已于 19:02 经 hub `/api/bot/test-broadcast` 补播（4 群卡 + 6 逾期确认私聊全送达）；wecom-attendance 09:30 播报失败为企微打卡明细未导入（人工流程，待用户补数）。

## v90 · 2026-09-21 · 随本提交落地 · docs

**《机器人总成使用指南.md》同步 DDL 逾期确认编号定向回复口径**

- 随 project-management-robot v104（45a75db）的成员可感知改动同批：确认私信带确认编号、多项目回复「编号+是/否」定向确认（如 `2 是`）、裸回「是/否」多项目时引导定向、单项目不变。
- 勘误记录：桌面版《机器人总成使用指南.html》本次维护时发现不存在（AGENTS 约定的 `C:\Users\0d00\Desktop\机器人总成使用指南.html` 缺失），待用户定性后补建/恢复；本轮用户侧口径先行落 MD 维护者手册。

## v91 · 2026-09-21 · `67f7dc3` 后续批次 · docs

**使用指南 MD 同步 v105 远程状态口径 + 桌面 HTML 重建 + v105 部署挂起记录**

- MD：hub 节新增「远程状态查看」（/status 舰队健康快照，随 pm-robot v105 / `8b743af`，**部署挂起**——提交已推 GitHub，但用户已携笔记本离站（当前 CQU_WiFi，31.x 不可达），回实验室后任意一次 `npm run push` 自动补部署，push.js 空提交跳过逻辑已核对）；手册头部补 HTML 重建记录。
- 桌面版《机器人总成使用指南.html》已按本手册成员向内容重建（工作区外，不入 git）——v90 的「HTML 缺失待定性」就此销项。
- 运维插曲：19:5x 起笔记本离开 31.x，运维台/watchdog 依设计进入「离站」状态不告警；小电脑最后一次全量检查（19:47）7 进程全在线。

## v92 · 2026-09-22 · `41b2ec8` · docs

**hub v106 负责人群整合播报上线（含挂起的 v105 补部署）+ 使用指南双端同步**

- 主改动随 project-management-robot v106（`211ce96`）：DDL 每日播报在各群常规卡之后，把「逾期 + 临期 2 天内」跨播报群汇总（各人员字段并集，filter=all）再发负责人群，卡头 @章子赫（open_id 经通讯录接口核验姓名/在职，另真发测试卡 code 0 验证卡片 @ 语法）；只含逾期/临期两栏，全空当日不发；与各群同轮重试去重，目标与播报群重复自动跳过；policy 窗口与 /status 同步暴露。v105（8b743af）的部署挂起就此销项——本次部署目标 git 同步 45a75db→211ce96 一次带上。
- 部署后验证：health 200、pm2 knowledge-tracker online、cron 下次执行 2026-09-23 12:05、/api/hub/policy 线上 leaderGroup 配置正确（webhook 只出 hasWebhook 布尔不泄漏原文）。
- 同批文档：`机器人总成使用指南.md` hub 节定时任务补负责人群整合播报口径；桌面版《机器人总成使用指南.html》DDL 卡片同步（成员向一句话，工作区外不入 git）；`dashboard/registry.js` hub 条目 role/notes 更新 + 负责人群 stub 测试快捷按钮。
- hub push.js 测试闸门补齐全量六套桩（v104/v105 两套此前漏挂，一并入闸）；新增 stub-test-ddl-leader 30 断言全过。

## v93 · 2026-09-22 · 随本提交落地 · feat

**队员活跃口径修正（用户拍板：抽奖/关键词等娱乐功能不计活跃）——gateway v29（`d990b1e`）+ hub v107（`5b80e39`）+ 运维台/规则同批**

- 需求：运维台「队员活跃」此前把抽奖、关键词回答等娱乐命中也算活跃，纯娱乐玩家撑高活跃数；改为只算正经使用，并成文为长期规则。
- gateway v29（已部署，health 200 / ws running）：`/api/usage` 双口径——`activeUsers`=机器人交互全量（网关日活跃表同口径，不变），新增 `seriousActiveUsers`/`seriousUsers`=正经使用（运维台消费）；日桶按人功能归因 `users[id].f` 为剔除依据，旧数据（无 f）按全量正经处理不回溯剔除、自然老化；娱乐清单=静态（`usage.js` STATIC_FUN_FEATURES：抽奖/关键词回答//lottery）+ 上报自学习（`/api/usage/report` 新字段 `fun:1` 学功能名、`learn:[触发词]` 学 `/触发词` 形态——堵住抽奖动态触发词被路由层记成正经 `/指令` 的漏洞；清单随 stats 持久化）；新增 `stub-test-usage-serious` 并入 push 测试闸门；README 使用统计节同步。
- hub v107（已部署，health 200）：上报四处调用点带标——抽奖两处（chatService 值日群/普通群）`{fun:true, learn:keywords}`、关键词回答两处（chatService/autoReplyService）`{fun:true}`（DDL 确认正经不动）；stub-test-duty-branch 新增统计上报三断言，六套桩全过。
- 运维台（本地，不部署）：「队员活跃」看板与总览「近24h活跃」KPI 切 `seriousActiveUsers`（`??` 兜旧口径），成员榜用 `seriousUsers`，卡头标注口径；「功能使用分布」仍全量展示娱乐命中；`registry.js` dashboard 条目与 `dashboard/README.md` 同步。
- 规则成文：顶层 AGENTS 全局工程规则新增「队员活跃口径=正经使用（2026-09-22）」条（上报 fun/learn 约定 + 静态清单位置 + 旧数据兼容口径），「网关日活跃」条补双口径区分备注。
- 杂项：`.zcodeignore`（前会话遗留忽略清单：`.zcode/`、晚间静默积压文件、值日规划文档、历史密钥备份等不入库项）并入本批入库。

## v89 · 2026-09-20 · 随本提交落地 · docs

**验收批：裁判路由器确认入网（wan=192.168.31.84）+ 4A 缺席记录**。交换机重排后验收：外网 200 / NAS .153 通 / 裁判 SSID 复播——`裁判系统` SSID 回归空中证明 `.84`（EC:C1:AB:E4:B6:56）即裁判路由器 wan，v87 的勘误维持有效（.80 的 cc:c4:b2 为另一台未知设备）。4A（d4:da:21 前缀零命中 + 新设备管理口无开启）仍未入网，待用户核对其 wan 线位（蓝 WAN 口）。文档：拓扑文档总览图/网段表/对照表/§四 与 skill §十一 同步"已入网"状态；裁判区静态绑定（EC:C1:AB:E4:B6:56→31.84）待主网关 UI 执行。
