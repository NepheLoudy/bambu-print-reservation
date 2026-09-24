# DEVLOG · bambu-print-reservation（拓竹 3D 打印预约机器人）

版本隔离单位：一次 `npm run push`（= 一次部署）。本项目 push.js 为纯 SFTP 直传、无 git 步骤，**版本锚点取顶层 monorepo 中触碰本路径的归档提交**——两次归档之间的个别部署可能无版本记录。v1~v14 于 2026-09-04 回溯编号，此后每次 push 在文末追加新版本（规则见顶层 [AGENTS.md](../AGENTS.md)）。

当前最新：**v34**（2026-09-25，顶层归档随批）。上一版 v33（2026-09-24）。更早：v32（PLAZA_ENABLED 停写批）。

## 阶段五 · 审批事件字段对齐与分发健壮化（2026-09-05）

### v16 · 2026-09-05 · 顶层归档 `5efc0ca` · feat
**审批事件字段对齐官方接口 + remainingMinutes 单位修正 + 分发重试上限与冷却（SFTP 已上线）**
- `approvalService.js`：事件/实例详情字段对齐官方响应——`instance_code`（原 instance_id）、`approval_code`、申请人取 `open_id`；`parseForm` 兼容「表单控件 JSON 字符串」形态；终态扩充 `REVERTED`（通过后撤销）/`OVERTIME_CLOSE`（超时关闭），均移出队列。
- `printer/client.js`/`manager.js`/`chatService.js`：`remainingTime → remainingMinutes`——mc_remaining_time 单位本就是分钟，修掉误除 60 导致的剩余时间显示错误。
- `dispatcher.js`：分发失败重试上限（`DISPATCH_MAX_RETRIES=3`，超过退出队列转人工）+ 冷却期（`DISPATCH_RETRY_COOLDOWN_MS=60s`，冷却中不参与匹配），修掉缺附件等确定性失败导致的匹配死循环刷屏。
- `index.js`：`express.json` 放宽 2mb；`/api/printers/available` 移到 `/api/printers/:id` 之前修路由遮蔽；`config.js` 增补两个分发重试环境变量。
- 本批经 push.js 纯 SFTP 部署上线，锚点为顶层归档提交 `5efc0ca`。

## 阶段四 · 开发历史建档与审批联调收尾（2026-09-04）

### v15 · 2026-09-04 · 顶层归档 `37a59aa` · feat
**审批联动联调后续改动随顶层归档上线（SFTP 直传，push.js 无 git 步骤）**
- `src/config.js`、`src/feishu/client.js`、`src/feishu/eventSubscription.js`、`src/index.js`、`src/services/approvalService.js` 五文件的审批联动收尾改动随 SFTP 部署上线；顶层 monorepo 同批归档（`37a59aa`）。
- 同批新建本 DEVLOG（v1~v14 回溯编号，规则见顶层 AGENTS.md）。

## 阶段一 · 独立项目时期（2026-07-15 ~ 07-21）

> 这一时期本仓库（顶层 monorepo 的前身）就是 bambu 项目本身，文件在仓库根目录。

### v1 · 2026-07-15 · `38375b3` · init
**feat: 初始化拓竹3D打印预约系统**
- 首提骨架：feishu 四件套 + printer（client/manager）+ chat/reservation service。（同刻 `c5d83db` 为 GitHub 仓库初始化提交，仅 .gitignore，不单占版本号）

### v2 · 2026-07-15 · `ee474ca` · feat
**添加NAS部署脚本和Git配置**
- deploy.js / deploy-local.js 时期。（`49c2a08` 合并远端，并入本条说明）

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
- 与 approval-bot 同日立项（同套模板），此后本项目长期低活跃。

## 阶段二 · 并入 qianli 工作区（2026-08-28 ~ 09-01）

### v9 · 2026-08-28 · `c886f32` · chore
**工作区归位：本仓库转型 monorepo**
- bambu 全部文件移入 `bambu-print-reservation/` 子目录；approval-bot、project-management-robot 以 gitlink 挂载；SOP 站点与各项目 .env 配置归档。业务代码零改动。

### v10 · 2026-09-01 · `55fb002` · feat
**bambu 部署脚本与密钥分离（push.js 统一入口）；同批新增 feishu-gateway**
- deploy.js/deploy-local.js 删除，改 push.js 纯 SFTP 直传；接入网关消费事件。

## 阶段三 · 审批事件直连与自动审批（2026-09-02 ~ 09-04）

### v11 · 2026-09-02 · `147d491` · docs
**增加项目职能边界声明（发错会话防护，需求错位即提醒停手）**

### v12 · 2026-09-03 · `ee5ad39` · docs
**AGENTS.md 增加「顶层规则与交互性」段（独立会话内联交互契约，开工先读顶层总表）**

### v13 · 2026-09-04 · `44b0463` · feat
**分发改为官方审批实例事件直连（approval_instance 秒级）**
- 大版本：新增 `services/dispatcher.js`（审批通过→自动分发打印任务给打印机负责人）、`services/approvalService.js`、test 双件；printer/manager、reservation、chatService 全线联动改造。

### v14 · 2026-09-04 · `5260175` · feat
**网关审批事件双通道（approval_instance + approval_task）——.env.example 增补双通道消费配置**

---

**备注**：push.js 为纯 SFTP 直传，改动即时上线；顶层归档提交仅作版本锚点，可能与实际上线时刻有分钟级偏差。

## 阶段六 · 全项目审查修复批次（2026-09-06）

### v17 · 2026-09-06 · 顶层归档 `dbbdaf5` · fix
**全项目审查修复：缺料忙等死循环 + 文件传输超时 + FTP/SFTP 状态残留 + 人工分发越权**
- dispatcher 缺料忙等修复：trigger 的 finally 在「队列有就绪任务+有空闲打印机但全部匹配不上」时条件恒真，setImmediate 无节流重跑（CPU 空转、reason 字符串无限拼接）；改为仅本轮确有分发动作才立即重跑，缺料等待靠新入队/空闲事件再触发。
- 分发链路加超时：飞书 API fetch 20s、附件下载 120s、SFTP 上传 120s、FTP connect/pasv 30s、FTP put 60s——原先任一环节挂起会让 matching 永久为 true，此后所有入队/空闲触发的匹配被静默丢弃，进程不退出也无告警只能重启。
- printer/client：FTP 连接失败/上传出错置空 ftpClient 强制下轮重连（原先残留死客户端，if(!ftpClient) 判定失效永不重连）并加 connTimeout/pasvTimeout；SFTP 旧连接的 close 不再误清新会话的 sftpReady（原只判 this.sshClient 非空），被顶掉的旧连接显式 end 防泄漏，上传超时断开会话；缺附件先校验再写「打印中」（消除镜像表打印中→已通过假抖动）；manualDispatch 加忙碌校验（原先直接 dispatch 会顶掉 printing 映射，原任务永远无法写「已完成/失败」且可能与自动匹配双上传）。
- 文档对齐：README 工作流改为审批事件主通道（原表格事件旧图自相矛盾）、状态流转补「排队中」、指令表补 /print-help、事件链路补自动审批与重试配置；.env.example 补 DISPATCH_MAX_RETRIES/DISPATCH_RETRY_COOLDOWN_MS、空 APPROVAL_CODE 误打印风险警示、对账间隔仅后备模式生效标注；DEVLOG 头部「当前最新」指针 v15→v16；AGENTS.md 职能描述对齐（打印控制仅 HTTP API）。
- 附：审查发现「MQTT 断线无重连」不成立——bambu-link SDK 自带 reconnectPeriod=5s 自动重连。

## 阶段七 · 审批事件丢失自愈（2026-09-06）

### v18 · 2026-09-06 · 顶层归档 `b68773e` · feat
**审批事件丢失自愈：失败登记重拉 + APPROVAL_CODE 窗口列表对账兜底**
- 背景：监听链路时效审查发现——网关转发审批事件单发无重试（8s 超时只记日志），本端拉实例详情失败也只记日志即丢；审批源任务不写镜像表，旧对账兜底在主通道下已关闭且本就覆盖不到审批源。丢一次事件该单永久滞留，只能人工 /print-dispatch。
- ① 失败登记重拉：`handleApprovalEvent` 拉详情失败登记 instance_code 进 retryQueue，对账定时器优先重拉（详情接口只要 instance_code，不依赖 APPROVAL_CODE）；窗口内一直失败打「放弃，请人工核对」日志，防实例已删导致永久重试。
- ② 窗口列表兜底：配置 APPROVAL_CODE 时每轮 `POST /approval/v4/instances/list` 拉回看窗口内实例 ID（默认 24h，按提交时间），跳过引擎已登记（dispatcher 新增 `isKnown`）与对账确认过终态否决的，其余补拉详情——APPROVED 补入队（enqueue 幂等+播报排队卡片）、终态移出队列。**APPROVAL_CODE 留空时 ② 不生效，启动日志显式警示**（生产现状即未配置，当前仅 ① 生效）。
- 接线与配置：兜底随审批主通道在 `startEventSubscription` 启动（后备模式不启，它走旧表格对账），启动 15s 先跑一轮补停机窗口遗漏；新增 `POST /api/approval/reconcile` 手动触发（与 /api/dispatch/reconcile 对称）；`APPROVAL_RECONCILE_MINUTES`（默认 5，0=关）/`APPROVAL_RECONCILE_WINDOW_MINUTES`（默认 1440），.env.example 同步；终态清单收敛为 TERMINAL_STATUSES 常量供事件/对账两路径共用。
- 验证：dispatcher 18 项单测全过；部署后 health 200、启动日志见「[审批对账] 兜底已启动（每 5 分钟，回看窗口 1440 分钟）」、POST /api/approval/reconcile 空载 `{"success":true,"handled":0}`。
- 部署附记：push 前本地/NAS .env 键级 diff 无差异；另确认生产 `PRINTER_HOSTS` 为空（0 台打印机登记，部署前既有状态）——审批→入队链路可用，自动匹配需先配打印机。

## 阶段八 · 晚间静默——播报时段限制（2026-09-06）

### v19 · 2026-09-06 · 顶层归档 `cca9970` · feat
**02:00–09:00（Asia/Shanghai）静默窗口：打印生命周期/预约通知积压到 09:00 原样补发（可配可关）**
- 新增 `src/utils/quietHours.js`（顶层 AGENTS.md「晚间静默」规则的本仓实现）：群播卡片与私聊通知落在窗口（`QUIET_HOURS_START/END` 默认 2→9，支持跨午夜写法，`QUIET_HOURS_DISABLED=1` 关闭）内时载荷落盘积压（`.quiet-backlog.json` 持久化，重启不丢），窗口结束整点按入队顺序原样补发；启动时过点立即补冲刷（initQuietHoursFlush 接入 startServer）；补发失败保留重试 ≤3 次。
- 接线（dispatcher 7 处 + reservation 4 处）：排队卡/开始卡/完成卡/失败卡（重试与放弃两种）/缺料提醒（原 30 分钟节流不变）/预约审批提醒卡+审批人私聊/审批结果卡+申请人私聊。
- **挤压要为挤压之后的事情负责**：打印机控制、写表、队列匹配、审批流转发照常进行，只有消息延后；补发的是事发时刻快照（完成卡含实际完成时间），夜间过队后卡片排位可能滞后，队列实况以 /print 指令查询为准。
- 豁免：chatService 对 /print-* 指令的回复（交互回路）不积压。
- 其他：/api/health 附 quietHours 状态；.gitignore/.env.example 同步；README 播报段补静默说明；顶层 AGENTS.md 新增「晚间静默」规则段。

### v20 · 2026-09-06 · 顶层归档 `85e95cc` · fix
**例行维护全仓 debug——审批自愈②窗口列表兜底三处纠偏（自 v18 上线以来从未生效）**
- 对账 ②（窗口列表兜底）静默空转，三处叠加：①响应字段读错——`/approval/v4/instances/list` 返回 `instance_code_list`，原代码读 `instance_list`（那是另一接口 instances/query 的字段），`|| []` 把空转吞掉不报错；②`start_time/end_time` 传毫秒字符串，官方要求秒级 Unix 时间；③官方限制单次查询范围 ≤10 小时而回看窗口 24h，且未跟 `has_more/page_token` 分页。改为 8h 切片逐段拉取 + 段内翻页 + 秒级时间戳 + `instance_code_list`（SDK typings 与官方文档双证）。生产未配 `APPROVAL_CODE`，②此前休眠、无线上影响；配置后兜底才真正可用。
- 顺带（文档）：README 部署命令去掉被 push.js 忽略的「提交说明」参数（纯 SFTP 无 git 步骤）；PRINTER-LAN-API.md dispatcher 全部行号按 v19 后代码回填（v19 接线 quietHours 后 +10~20 行系统性偏移）。
- 已知限制（意图不明，未动）：approval_task 自动审批路径拉详情失败不登记重拉（与 instance 路径 v18 前失败模式同构，是否自愈待裁定）；对账对「APPROVED 无附件 / PENDING」实例不做已见登记，窗口内每轮重复拉详情（噪音非正确性）；数值型 env 无 NaN 防护。
- 单测：test/approval-test.js、test/dispatcher-test.js 全部通过；README「审批单测 10 项」计数核对无误。

### v21 · 2026-09-12 · 265a429 · fix

**静默积压文件可挪项目外 + 配置补齐（清空部署不再丢积压）**

- `src/utils/quietHours.js`：积压文件路径支持 `QUIET_BACKLOG_FILE` 环境变量——本仓纯 SFTP 部署每次 `rm -rf` 清空 /opt/bambu-print-server，默认项目根的 `.quiet-backlog.json` 每次部署必丢，静默积压的「重启不丢」承诺在部署场景从未成立；加载时对目标目录 `mkdirSync(recursive)`（项目外数据目录无人预建）。
- `.env` 补配 `QUIET_BACKLOG_FILE=/home/qianli/bambu-data/quiet-backlog.json`（push.js 随部署上传 NAS 生效）；`.env.example` 补注释键（补齐「新增配置同步改 example」约定欠账）。
- 顶层 AGENTS「晚间静默」口径不变：积压文件位置变化不影响冲刷语义（任务类重跑/一次性通知原样补发）。

### v22 · 2026-09-12 · 64ce352 · feat

**动态广场事件流接入（打印排队/开始/完成/失败 → 机器人项目看板）**

- 新增 `src/services/plaza.js`：打印生命周期四态事件写机器人项目看板「动态广场」表（`config.plaza` 默认表已内置，`PLAZA_BITABLE_TABLE_ID` 可覆盖）；失败仅 warn 绝不影响打印主链路。
- 插桩：`dispatcher` 的 enqueue（排队，silent 不计）/ dispatch 开始 / completeTask 完成 / failTask 失败。
- 测试：`test/dispatcher-test.js` 补 `PLAZA_BITABLE_TABLE_ID=''` 隔离（防测试污染生产表），回归全过。

### v23 · 2026-09-13 · 随顶层 v52 归档 · feat

**定制窗口 `GET /api/print/policy` 上线（只读全景）**

- 打印机登记清单（id/名称/型号；accessCode/serial 不外泄）、审批主通道/自动审批/对账参数、分发匹配参数（颜色阈值/重试上限/冷却/AMS）、队列与打印中快照。
- 运维台「功能激活」面板接通真实数据（dashboard fetchActivity 增 printPolicy/ticketPolicy 探针，与 ticket v64 同批）。
- README 补「定制窗口」节；dispatch/approval 两套离线测试全过。

### v24 · 2026-09-13 · 随顶层 v56 归档 · feat

**分发引擎状态持久化：重启不丢打印队列（用户拍板：后续有算力，预约可持久化）**

- 新增队列/打印中映射/已知记录（known）/完成计数的磁盘落盘：`DISPATCH_STATE_FILE`（默认项目外 `/home/qianli/bambu-data/dispatch-state.json`，与静默积压同目录，部署清目录不再影响）；变更防抖 300ms 合并写入 + 临时文件原子改名；`start()` 时恢复，进程 SIGINT/SIGTERM（pm2 restart）退出前强制冲刷。
- known 截尾 2000 条防无限增长（保存时截尾、恢复时队列/打印中的活动 recordId 回加）；状态文件损坏按空队列启动（审批事件与对账可重新入队），文件缺失静默跳过。
- 落盘点：trigger 匹配轮结束（覆盖入队/分发/完成/失败引发的变更）、dequeue、manualDispatch；exit hook 只挂一次。
- 测试：新增 `test/dispatcher-persist-test.js`（落盘生成/重载恢复队列与打印中与完成计数/known 截尾/损坏文件按空启动/文件缺失静默 9 项）；dispatcher/approval 既有单测回归全过。
- README 补「状态持久化」节与测试清单；`.env` 配置生产路径 `/home/qianli/bambu-data/dispatch-state.json`，`.env.example` 同步。

### v25 · 2026-09-13 · 随顶层 v57 归档 · fix

**人工指定与自动匹配分发互斥：分钟级 TOCTOU 竞态关闭（遗留待办销项）**

- 病灶：dispatch 是分钟级 await 链（飞书下载 → SFTP 上传 → MQTT 下发），printing 占用登记在链尾才发生；manualDispatch 不走 matching 串行段且 busy 校验在链前——窗口期内两路对同一台打印机双双下发（上传互覆/顶掉任务，原任务永远无法写「已完成/失败」）。
- 修复：按打印机的分发闸门——`dispatching` Set 在 dispatch 入口同步 check+add（单线程事件循环无插入窗口），finally 释放（失败/重试路径也保证）；自动匹配候选过滤掉分发中的打印机；manualDispatch busy 校验追加「正在有任务分发中」判定，且 dispatch 入口闸门兜底二次拒绝。**闸门刻意不持久化**（崩溃后清零重新评估，残留锁才危险）。
- 测试：新增 `test/dispatcher-manual-race-test.js` 8 项（可控 deferred 模拟分钟级下载链：分发中自动匹配不可见/并发 dispatch 二路拒绝且任务留队/manualDispatch 判定/链路完成后闸门释放任务继续分发）；persist/dispatcher/approval 三套既有测试回归全过。
- README 补「分发互斥」节与测试清单。

### v26 · 2026-09-13 · 随顶层 v62 归档 · fix

**深度代码审查批：四处确认 bug 修复（含两个高影响）**

1. 分发进行中重启/崩溃 → 任务永久丢失：中间态（已出队未入 printing）被 known 永久拦截重入队，已审批单静默消失且无任何通知。改为显式 in-flight 追踪：dispatch 进出 inFlight 数组、落盘携带，重启时中断任务重回队列完整重发（新增往返用例）。
2. finish 事件落在停机/打印机离线窗口 → printing 幽灵滞留（重连首报无 prevState 不产生事件）——新增 10 分钟 printing 巡检：打印中超过预估时长（6h×2 倍数保守）且打印机实况空闲即补完成收尾。
3. manualDispatch 非 autoDispatch 分支不移出队列——人工指定的闪铸单随后被自动匹配分到别的 Bambu 覆盖。移出队列 + known 登记 + 落盘。
4. 审批源任务重试耗尽后 /print-dispatch 永远找不到（instance_code 不在镜像表）——重试耗尽时保留 givenUp 列表，人工恢复通道打通。

### v27 · 2026-09-13 · 随本提交落地 · feat

**管理端点鉴权 + 部署前测试闸门（体系推荐 R2/R4）**

- 新增 src/auth.js：打印机控制（print/pause/resume/stop）与 /api/approval/reconcile 需 X-API-Token（fail-closed）；/api/reservations 与 /api/chat/command 为用户可达链路不挂闸。
- push.js 加部署前测试闸门：dispatcher/persist/manual-race/approval 四套全过才部署。

### v28 · 2026-09-15 · 顶层归档 7c836f9 · fix

**全项目深度审查修复批：写端点鉴权补齐（铁律）**

- 六个写端点漏挂 X-API-Token（与同仓 printers print/pause/resume/stop、/api/approval/reconcile 的既有鉴权自相矛盾，违反顶层 AGENTS「管理/写端点必须鉴权」铁律）：POST/PUT/DELETE /api/reservations*（含 review——可直接「通过」预约并入队）与 POST /api/dispatch/manual（可绕审批直接驱动真机）、/api/dispatch/reconcile。运维台代理 POST 自动附 token，不受影响；本机脚本直调需自带 X-API-Token 头。
- .gitignore 增补 .dispatch-state.json（本地不配 DISPATCH_STATE_FILE 跑一次就会在项目根生成，顶层 git add -A 易误扫入库——wecom v68 前车之鉴）。
- DEVLOG 头部指针修正 v26 → v28（v27 时漏更，该指针历史上已漏过一次）。

### v29 · 2026-09-15 · 顶层归档 8f8a4f9 · fix

**R8 分发可靠性包（全项目审查推荐落地批）**

- failTask 运行期失败接入与分发失败同款的重试/让位通道：此前打印机上报 failed 只把镜像表写回「排队中」而不重排，known 拦截重入队 → 单据永久滞留（失败卡却承诺「会重新排队」）。现按 dispatchRetries 冷却重排，耗尽进 givenUp 并在失败卡给出 /print-dispatch 人工恢复指引。
- givenUp 落盘（GIVEN_UP_CAP=200 截尾）：此前纯内存，重启后人工恢复通道（v26-B4）静默失效——known 已拦重入队、审批源单不在镜像表。恢复时随状态载入。
- sweepStalePrinting 补审批源守卫（同 completeTask）：审批源 task 写 instance_code 到预约表必然失败，每 10 分钟白刷错误日志；改为跳过写表保留内存收尾。
- config：FEISHU_USE_LONG_CONNECTION 缺省翻转为 false（长连接模式在本仓是空壳只打日志，误配即静默收不到全部事件；网关转发模式才是真实链路）。
- .env：FEISHU_VERIFICATION_TOKEN 补配共享密钥（/api/feishu/event 此前零校验，LAN 可伪造事件驱动分发）；DISPATCH_STATE_FILE POSIX 路径显式化 C:/home。
- dispatcher-persist-test 新增 6 断言（givenUp 往返/重排/让位/落盘恢复），四套测试全过。

### v30 · 2026-09-17 · 顶层归档 cc97019 · fix

**全量 debug 批：分发引擎三处修复 + 超时与配置收口**

- start() 审批直连分支恢复队列后统一 `trigger('restore')`（此前提前 return，重启后恢复的队列+空闲打印机无人点火，任务可无限期滞留）。
- sweepStalePrinting 补完成后 `persistState()`（释放过打印机再 trigger）——防 300ms 防抖窗口外崩溃后幽灵 printing 复活、重复发完成卡/重复计完成数。
- approval_task 自动审批去重改拉详情成功后登记（旧逻辑先登记后拉取，失败即永久丢失且不进重试）。
- webhook 发送（sendMessage/sendTextMessage）补 15s 超时（裸 fetch 挂起会卡死晚间静默冲刷循环）。
- .env.example：QUIET_BACKLOG_FILE 注释态改显式项目外路径（与 DISPATCH_STATE_FILE 同待遇）；NAS 三键迁小电脑实值；README givenUp「保留在内存」改已落盘口径（v29 遗留）。
- 测试：approval/dispatcher/dispatcher-persist/dispatcher-manual-race 四套全过。

### v31 · 2026-09-19 · 顶层归档随批 · chore

**npm test 与 push.js 闸门同源（R27）**

- package.json `test` 由 `echo "Error: no test specified"` 占位符改为与 push.js 测试闸门完全相同的四套清单（dispatcher/dispatcher-persist/dispatcher-manual-race/approval）——此前直接 `npm test` 得到误导输出（09-18 全量 debug 批观察项 R27）。
- 纯元数据批，无行为改动；npm test 实跑验证全过。版本锚点=顶层归档提交。

### v32 · 2026-09-20 · 顶层归档随批 · chore

**用户拍板：动态广场机器人停写（PLAZA_ENABLED 开关）**

- 2026-09-20 用户拍板：动态广场相关功能由用户自维护，机器人只对各自现有业务看板负责。plaza.js `enabled()` 加 `PLAZA_ENABLED` 开关（默认关，显式设 `1` 才恢复写入）；打印生命周期（排队/开始/完成/失败）四处广场钩子保留代码不动，仅由开关关断。
- `.env.example` 补注释；npm test 四套全过。版本锚点=顶层归档提交。

### 附记 · 顶层 v84 联动批归档（非本仓版本号 · 2026-09-20）

> 勘误（2026-09-24 复查批）：本条原被误贴为本仓 `## v84` 条目——版本号与层级均不属 bambu 自身 v1~vN 序列（该批本仓正式条目即上行 v32），系顶层 DEVLOG 联动摘要的复制。按「历史条目不改写、版本号不重排」原则改为附记保留原文，不再占用/干扰本仓版本序列。

**用户拍板批：动态广场机器人停写（四仓 PLAZA_ENABLED）**

- 2026-09-20 用户拍板：**动态广场相关功能由用户自维护，机器人只对各自现有业务看板负责**。duty-bot v34 / hub v102 / ticket-bot v78 / bambu v32 四仓 `src/services/plaza.js` 统一加 `PLAZA_ENABLED` 停写开关（代码默认关，显式设 `1` 才恢复机器人写入），事件钩子保留、fire-and-forget 语义不变；「动态广场」表（在回收站）的恢复/重建由用户自理，机器人不再参与。
- 附带效果：表在回收站期间各仓持续刷的 `TableIdNotFound` warn 终结；用户日后恢复/重建广场表也不会被机器人自动灌数据。
- gateway 的「网关日活跃」upsert 是另一张在役表，不在停写范围。`.env.example` 四仓补注释；顶层 AGENTS「机器人项目看板」节改口径；桌面意图文档待拍板 #1 销项并记入已定口径。
- 测试：duty flow+express / ticket 三套 / hub duty-branch / bambu 四套全过。部署顺序：duty → hub → ticket → bambu（SFTP）→ 顶层。

### v33 · 2026-09-24 · 顶层归档随批 · fix

**manualDispatch 审批源守卫 + 事件端点 fail-closed + auth 废除 ?token=（全仓复查批）**

- 提交说明：fix: manualDispatch 非自动机型分支补审批源守卫 + /api/feishu/event fail-closed + auth 废除 ?token=
- **manualDispatch 守卫（P2）**：非自动机型（闪铸）分支原无条件写镜像表——审批源任务 recordId=instance_code 非镜像表 record_id，updateRecord 必抛错，且此时任务已出队、不进 givenUp，单据静默消失（重启才可能从旧状态文件捞回）。照 dispatchLocked 口径补 task.fileSource !== approval 守卫；出队 + known 去重保留，人工按提示上传不受影响。
- **fail-closed**：/api/feishu/event 补「未配置 token 403 拒绝 approval_instance / approval_task 帧」（表格事件后备镜像通道不受影响）。现网 .env 已配 token，行为无实际变化。
- src/auth.js 废除 ?token= 回退（R10②）。
- **DEVLOG 勘误**：文末错贴的顶层 v84 条目改为「附记」（版本号/层级不属本仓序列，见该附记注），不再干扰版本锚点回溯。
- 测试：四套桩全过（dispatcher 18 检查点 / persist / manual-race 8 项 / approval 9 项）。

## v34 · 2026-09-25 · 顶层归档随批 · docs

**全量审查文档批（纯文档，无代码改动）**

- PRINTER-LAN-API.md：§4.1/§4.6/§4.7/§4.8 行号随 v33 fail-closed 插入系统性偏移修正，§4.6 补 v33 fail-closed 行为记录（token 未配置拒收消息帧）。
- AGENTS.md：push 命令口径修正（npm run push 不带参数，本仓无 git 步骤）；速览补 duty/wecom。
- README：DISPATCH_STATE_FILE 生产路径带盘符（C:/home/...）；.env.example 同步。
- 随批 SFTP 同步文档到部署目标（无 pm2 重启必要，代码零改动——push.js 常规执行）。
