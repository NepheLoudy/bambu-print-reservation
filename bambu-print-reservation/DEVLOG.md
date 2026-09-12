# DEVLOG · bambu-print-reservation（拓竹 3D 打印预约机器人）

版本隔离单位：一次 `npm run push`（= 一次部署）。本项目 push.js 为纯 SFTP 直传、无 git 步骤，**版本锚点取顶层 monorepo 中触碰本路径的归档提交**——两次归档之间的个别部署可能无版本记录。v1~v14 于 2026-09-04 回溯编号，此后每次 push 在文末追加新版本（规则见顶层 [AGENTS.md](../AGENTS.md)）。

当前最新：**v23**（2026-09-13，随顶层 v52 归档）。

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
