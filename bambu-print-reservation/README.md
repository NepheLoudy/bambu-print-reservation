# bambu-print-reservation · 拓竹 3D 打印自动分发系统

飞书多维表格审批 + 拓竹打印机（MQTT/SFTP）全自动分发：切片产出 3mf → 表单提交 → 专人审批 → **秒级事件监听** → 按 AMS 耗材自动选机 → 上传并开始打印 → 全程群播报。

## 工作流

```
本地切片(Bambu Studio 等) → 3mf
   ↓ 飞书「打印审批表」提交：切片文件附件 + 材料类型 + 颜色 + 是否加急
   ↓ 专人审批（多维表格改「申请状态=已通过」）
   ↓ feishu-gateway 秒级推送表格变更事件（对比旧版半小时轮询）
本服务：回查记录 → 进入队列（加急优先）
   ↓ 打印机空闲触发匹配
   ↓ AMS 装料匹配：材料类型(精确→家族) + 颜色(redmean 近似)
   ↓ 飞书下载 3mf → SFTP 上传打印机 /sdcard/ → MQTT project_file 下发
   ↓ gcodeState 变迁监听：开始/完成/失败 → 群 webhook 播报
```

## 打印机支持

| 机型 | 接入方式 | 自动分发 |
| --- | --- | --- |
| X1C / H2D | MQTT 8883 + SFTP 22（bblp + Access Code），AMS 完整 | ✅ |
| P1 / A1 | MQTT 8883 + FTP 21 | ✅（AMS 有则匹配） |
| 闪铸等非 Bambu | 仅 .env 登记 | ❌ 人工通道（/print-dispatch 指定后提示手动上传） |

## 指令（群内 @对话型机器人 或经网关转发）

| 指令 | 说明 |
| --- | --- |
| `/print-status` | 打印机状态 + AMS 耗材 + 当前任务进度 + 等待队列 |
| `/print-ams` | 所有打印机装载耗材明细 |
| `/print-list` | 全部预约记录 |
| `/print-pending` | 待审批预约 |
| `/print-dispatch <申请编号> <打印机名>` | 人工强制指定分发 |

播报（webhook 群机器人）：新预约通知、审批结果、入队、打印开始/完成/失败、缺料提醒（30 分钟节流）。

## 分发匹配规则（按序）

1. 打印机空闲（gcodeState=IDLE/FINISH）且 Bambu 系
2. 表单「指定打印机」优先
3. AMS 精确材料匹配 + 颜色近似（ΔE 阈值可配）
4. 家族匹配（PLA-CF ↔ PLA）
5. 加急优先出队，队首缺料不阻塞后续任务

## 多维表格字段

审批表（已有字段之外新增）：`材料类型`（单选）、`颜色`（单选）、`指定打印机`（单选，可空）。
状态流转：`待审批 → 已通过/已驳回 → 打印中 → 已完成`（任意时刻可 `已取消`）。

> **文档权限**：需在飞书中把应用「爆米花机」添加为该多维表格的**可编辑协作者**，否则写状态会报 91403。

## 事件链路（qianli 架构）

事件由 feishu-gateway（共用应用唯一长连接）转发：**审批实例事件 approval_instance → `POST /api/feishu/event`（主通道，秒级）**；表格事件（legacy 结构）仅后备模式（APPROVAL_PRIMARY=false 时启用+对账）；指令 → `POST /api/chat/command`。本服务 `FEISHU_USE_LONG_CONNECTION=false`。

前置配置（一次性）：① 开发者后台事件订阅添加「审批实例状态变更 approval_instance」；② 应用开通审批读取权限；③ 拿到审批定义 code 后调 subscribeApproval 订阅（见 .env.example）。

## 部署

```
npm run push "提交说明"
```

详见顶层 `.agents/skills/qianli-deploy/SKILL.md`。NAS 路径 `/opt/bambu-print-server`，pm2 进程 `bambu-print-server`，端口 3001。

## 测试

```
node test/dispatcher-test.js   # 分发引擎匹配逻辑单测（18 项）
```
