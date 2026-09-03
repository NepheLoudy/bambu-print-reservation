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

---

**本 DEVLOG 自身**：v1~v25 为 2026-09-04 回溯建档；v26 起按「每次 push 记一版」规则持续追加（规则见 [AGENTS.md](AGENTS.md)，qianli-deploy skill 部署流程同有提醒）。
