# bambu-print-reservation · 拓竹 3D 打印自动分发系统

飞书多维表格审批 + 拓竹打印机（MQTT/SFTP）全自动分发：切片产出 3mf → 表单提交 → 专人审批 → **秒级事件监听** → 按 AMS 耗材自动选机 → 上传并开始打印 → 全程群播报。

## 工作流

```
本地切片(Bambu Studio 等) → 3mf
   ↓ 飞书官方审批表单提交（附件 + 材料类型 + 颜色 + 可选指定打印机）
   ↓ 审批人通过（或机器人按 AMS 匹配规则自动同意，APPROVAL_AUTO_APPROVER_ID）
   ↓ feishu-gateway 秒级推送 approval_instance / approval_task 事件（主通道）
本服务：解析表单 → 进入队列（加急优先）
   ↓ 打印机空闲触发匹配
   ↓ AMS 装料匹配：材料类型(精确→家族) + 颜色(redmean 近似)
   ↓ 飞书下载 3mf → SFTP/FTP 上传打印机 /sdcard/ → MQTT project_file 下发
   ↓ gcodeState 变迁监听：开始/完成/失败 → 群 webhook 播报
```

> 多维表格「打印预约表」只是审批数据的半小时级镜像（后备模式才作为事件来源），主通道下改表格状态不会触发分发。

## 打印机支持

| 机型 | 接入方式 | 自动分发 |
| --- | --- | --- |
| X1C / H2D | MQTT 8883 + SFTP 22（bblp + Access Code），AMS 完整 | ✅ |
| P1 / A1 | MQTT 8883 + FTP 21 | ✅（AMS 有则匹配） |
| 闪铸等非 Bambu | 仅 .env 登记 | ❌ 人工通道（/print-dispatch 指定后提示手动上传） |

## 指令（群内 @对话型机器人 或经网关转发）

| 指令 | 说明 |
| --- | --- |
| `/print-help` | 显示帮助（`/help` 同效） |
| `/print-status` | 打印机状态 + AMS 耗材 + 当前任务进度 + 等待队列 |
| `/print-ams` | 所有打印机装载耗材明细 |
| `/print-list` | 全部预约记录 |
| `/print-pending` | 待审批预约 |
| `/print-dispatch <申请编号> <打印机名>` | 人工强制指定分发（打印机有在打任务时会拒绝） |

播报（webhook 群机器人）：新预约通知、入队、打印开始/完成/失败、缺料提醒（30 分钟节流）。主通道下审批结果卡由飞书审批消息承担，本服务不再重复发。**晚间静默**：上述播报落在 02:00–09:00（`QUIET_HOURS_START/END` 可配、`QUIET_HOURS_DISABLED=1` 关闭）内时积压到 09:00 原样补发（打印机控制/写表不延迟，只有消息延后；/print-* 指令回复不积压），详见 `src/utils/quietHours.js` 与顶层 AGENTS.md「晚间静默」。

## 分发匹配规则（按序）

1. 打印机空闲（gcodeState=IDLE/FINISH）且 Bambu 系
2. 表单「指定打印机」优先
3. AMS 精确材料匹配 + 颜色近似（ΔE 阈值可配）
4. 家族匹配（PLA-CF ↔ PLA）
5. 加急优先出队，队首缺料不阻塞后续任务

## 多维表格与审批表单字段

主通道下材料/颜色/指定打印机是**官方审批表单字段**，按标题关键词自适应解析（`APPROVAL_CODE` 留空时依赖「表单含附件」识别打印审批，建议配置 code 收窄）；`scripts/add-dispatch-fields.js` 仅对旧版表格直提交流程有意义。
状态流转：`待审批 → 已通过/已驳回 → 排队中 → 打印中 → 已完成`（分发失败回滚「排队中」重试；任意时刻可 `已取消`）。

> **文档权限**：需在飞书中把应用「爆米花机」添加为该多维表格的**可编辑协作者**，否则写状态会报 91403。

## 事件链路（qianli 架构）

事件由 feishu-gateway（共用应用唯一长连接）转发：**审批实例事件 approval_instance → `POST /api/feishu/event`（主通道，秒级）**；approval_task 事件驱动自动审批（`APPROVAL_AUTO_APPROVER_ID`）；表格事件（legacy 结构）仅后备模式（APPROVAL_PRIMARY=false 时启用+对账）；指令 → `POST /api/chat/command`。本服务 `FEISHU_USE_LONG_CONNECTION=false`。分发失败按 `DISPATCH_MAX_RETRIES` 次上限重试，每次间隔 `DISPATCH_RETRY_COOLDOWN_MS`，超限退出队列转人工。

前置配置（一次性）：① 开发者后台事件订阅添加「审批实例状态变更 approval_instance」；② 应用开通审批读取权限；③ 拿到审批定义 code 后调 subscribeApproval 订阅（见 .env.example）。

## 部署

```
npm run push
```

详见顶层 `.agents/skills/qianli-deploy/SKILL.md`。NAS 路径 `/opt/bambu-print-server`，pm2 进程 `bambu-print-server`，端口 3001。

## 测试

```
node test/dispatcher-test.js   # 分发引擎匹配逻辑单测（18 项）
node test/approval-test.js     # 审批事件解析/自动审批逻辑单测（10 项）
```
