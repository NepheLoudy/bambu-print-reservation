# DEVLOG · bambu-print-reservation（拓竹 3D 打印预约机器人）

版本隔离单位：一次 `npm run push`（= 一次部署）。本项目 push.js 为纯 SFTP 直传、无 git 步骤，**版本锚点取顶层 monorepo 中触碰本路径的归档提交**——两次归档之间的个别部署可能无版本记录。v1~v14 于 2026-09-04 回溯编号，此后每次 push 在文末追加新版本（规则见顶层 [AGENTS.md](../AGENTS.md)）。

当前最新：**v16**（2026-09-05，顶层归档 `5efc0ca`）。

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

### v17 · 2026-09-06 · 顶层归档（本批，hash 见回填） · fix
**全项目审查修复：缺料忙等死循环 + 文件传输超时 + FTP/SFTP 状态残留 + 人工分发越权**
- dispatcher 缺料忙等修复：trigger 的 finally 在「队列有就绪任务+有空闲打印机但全部匹配不上」时条件恒真，setImmediate 无节流重跑（CPU 空转、reason 字符串无限拼接）；改为仅本轮确有分发动作才立即重跑，缺料等待靠新入队/空闲事件再触发。
- 分发链路加超时：飞书 API fetch 20s、附件下载 120s、SFTP 上传 120s、FTP connect/pasv 30s、FTP put 60s——原先任一环节挂起会让 matching 永久为 true，此后所有入队/空闲触发的匹配被静默丢弃，进程不退出也无告警只能重启。
- printer/client：FTP 连接失败/上传出错置空 ftpClient 强制下轮重连（原先残留死客户端，if(!ftpClient) 判定失效永不重连）并加 connTimeout/pasvTimeout；SFTP 旧连接的 close 不再误清新会话的 sftpReady（原只判 this.sshClient 非空），被顶掉的旧连接显式 end 防泄漏，上传超时断开会话；缺附件先校验再写「打印中」（消除镜像表打印中→已通过假抖动）；manualDispatch 加忙碌校验（原先直接 dispatch 会顶掉 printing 映射，原任务永远无法写「已完成/失败」且可能与自动匹配双上传）。
- 文档对齐：README 工作流改为审批事件主通道（原表格事件旧图自相矛盾）、状态流转补「排队中」、指令表补 /print-help、事件链路补自动审批与重试配置；.env.example 补 DISPATCH_MAX_RETRIES/DISPATCH_RETRY_COOLDOWN_MS、空 APPROVAL_CODE 误打印风险警示、对账间隔仅后备模式生效标注；DEVLOG 头部「当前最新」指针 v15→v16；AGENTS.md 职能描述对齐（打印控制仅 HTTP API）。
- 附：审查发现「MQTT 断线无重连」不成立——bambu-link SDK 自带 reconnectPeriod=5s 自动重连。
