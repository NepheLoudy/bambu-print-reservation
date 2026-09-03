# DEVLOG · bambu-print-reservation（拓竹 3D 打印预约机器人）

版本隔离单位：一次 `npm run push`（= 一次部署）。本项目 push.js 为纯 SFTP 直传、无 git 步骤，**版本锚点取顶层 monorepo 中触碰本路径的归档提交**——两次归档之间的个别部署可能无版本记录。v1~v14 于 2026-09-04 回溯编号，此后每次 push 在文末追加新版本（规则见顶层 [AGENTS.md](../AGENTS.md)）。

当前最新：**v15**（2026-09-04，顶层归档 `37a59aa`）。

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
