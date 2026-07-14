# 🖨️ 爆米花机-对话型 | 拓竹3D打印预约系统

基于飞书多维表格 + 拓竹打印机MQTT协议的3D打印预约管理系统，支持飞书机器人指令查询、切片审查工作流、多打印机管理。

## ✨ 核心功能

- **飞书多维表格预约**：用户在飞书多维表格中填写预约，系统自动监听并处理
- **切片审查工作流**：3MF文件需经指定审查者在Bambu Studio中审查后才能发送至打印机
- **飞书机器人指令**：通过 `/指令` 方式查询打印机状态和预约信息（不主动播报）
- **多打印机管理**：支持同时管理多台拓竹打印机
- **实时状态同步**：打印机状态自动同步回飞书多维表格

## 📋 预约状态流转

```
待审查 → 审查通过 → 排队中 → 打印中 → 已完成
         审查驳回 → 通知申请人修改
```

## 🚀 快速开始

### 1. 安装依赖

```bash
cd d:\qianli\bambu-print-server
npm install
```

### 2. 配置环境变量

```bash
copy .env.example .env
```

编辑 `.env` 文件，填入以下配置：

```env
# 飞书应用配置（可复用knowledge-tracker的配置）
APP_ID=cli_xxxx
APP_SECRET=xxxx

# 机器人配置（可复用knowledge-tracker的webhook）
BOT_NAME=爆米花机-对话型
BOT_WEBHOOK_URL=https://open.feishu.cn/open-apis/bot/v2/hook/xxxx

# 多维表格配置（需新建）
BITABLE_APP_TOKEN=bascn_xxxx
BITABLE_RESERVATION_TABLE_ID=tbl_xxxx
BITABLE_PRINTER_TABLE_ID=tbl_xxxx

# 打印机配置（多台用逗号分隔）
PRINTER_HOSTS=192.168.1.100,192.168.1.101
PRINTER_ACCESS_CODES=xxxxxxxx,xxxxxxxx
PRINTER_SERIALS=SNxxxx,SNxxxx
PRINTER_NAMES=打印机1,打印机2
PRINTER_MODELS=P1S,P1S

# 审查者open_id（逗号分隔）
REVIEWERS=ou_xxxx
```

### 3. 创建飞书多维表格

#### 预约表字段

| 字段名 | 类型 | 说明 |
|--------|------|------|
| applicant | 人员 | 预约申请人 |
| startTime | 日期时间 | 预约开始时间 |
| endTime | 日期时间 | 预约结束时间 |
| fileName | 文本 | 文件名 |
| fileToken | 文本 | 飞书云文档文件Token |
| printer | 单选 | 选择打印机 |
| status | 单选 | 预约状态 |
| reviewer | 人员 | 审查者 |
| reviewResult | 单选 | 通过/驳回 |
| reviewComment | 文本 | 审查意见 |
| printProgress | 数字 | 打印进度(%) |
| estimatedTime | 数字 | 预计打印时间(分钟) |
| actualTime | 数字 | 实际打印时间(分钟) |

#### 打印机状态表字段

| 字段名 | 类型 | 说明 |
|--------|------|------|
| printerName | 文本 | 打印机名称 |
| printerModel | 文本 | 打印机型号 |
| ipAddress | 文本 | IP地址 |
| status | 单选 | 空闲/打印中/故障/维护中 |
| currentJob | 文本 | 当前任务 |
| progress | 数字 | 打印进度(%) |
| temperature | 文本 | 温度信息 |
| lastUpdate | 日期时间 | 最后更新时间 |

### 4. 飞书事件订阅配置

在飞书开发者后台配置事件订阅，启用以下事件：
- `im.message.receive_v1` — 接收消息（用于指令响应）
- `bitable.record.create` — 多维表格记录创建
- `bitable.record.update` — 多维表格记录更新

回调地址填写：
```
http://你的服务器IP:3001/api/feishu/event
```

### 5. 打印机准备

1. 在打印机设置中启用「开发者模式」
2. 获取打印机IP地址、Access Code（8位）、Serial Number
3. 确保服务器与打印机在同一局域网

### 6. 启动服务

```bash
npm start
```

或开发模式：
```bash
npm run dev
```

## 💬 机器人指令

在群聊中 @爆米花机-对话型 后发送指令，或私聊直接发送。

| 指令 | 说明 |
|------|------|
| `/help` | 显示基础帮助 |
| `/print-help` | 显示打印相关详细帮助 |
| `/print-status` | 查看所有打印机状态 |
| `/print-list` | 查看所有预约记录 |
| `/print-pending` | 查看待审查预约 |
| `/print-start <ID> <文件路径>` | 开始打印 |
| `/print-pause <ID>` | 暂停打印 |
| `/print-resume <ID>` | 恢复打印 |
| `/print-stop <ID>` | 停止打印 |

## 📁 项目结构

```
bambu-print-server/
├── src/
│   ├── feishu/
│   │   ├── client.js              # 飞书API客户端封装
│   │   ├── bitable.js             # 多维表格CRUD操作
│   │   ├── bot.js                 # 机器人消息通知
│   │   └── eventSubscription.js   # 飞书事件订阅
│   ├── printer/
│   │   ├── client.js              # 打印机MQTT客户端
│   │   └── manager.js             # 打印机状态管理
│   ├── services/
│   │   ├── reservation.js          # 预约业务服务
│   │   └── chatService.js          # 指令处理服务
│   ├── config.js                  # 配置管理
│   └── index.js                   # API入口
├── .env.example                   # 环境变量模板
└── package.json
```

## 📡 API接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/health` | GET | 健康检查 |
| `/api/reservations` | GET/POST | 预约列表/创建预约 |
| `/api/reservations/:id` | GET/PUT/DELETE | 预约详情/更新/取消 |
| `/api/reservations/:id/review` | POST | 处理审查结果 |
| `/api/printers` | GET | 打印机状态列表 |
| `/api/printers/:id/print` | POST | 开始打印 |
| `/api/printers/:id/pause` | POST | 暂停打印 |
| `/api/printers/:id/resume` | POST | 恢复打印 |
| `/api/printers/:id/stop` | POST | 停止打印 |
| `/api/feishu/event` | POST | 飞书事件回调 |

## 🔄 工作流程

```
1. 用户在飞书多维表格填写预约（申请人、时间、文件、打印机）
2. 系统监听到表格新增记录，通知审查者
3. 审查者在Bambu Studio中审查3MF切片文件
4. 审查者在多维表格中填写审查结果（通过/驳回）
5. 审查通过 → 系统自动下载文件并上传到打印机 → 排队打印
6. 审查驳回 → 系统通知申请人修改后重新提交
7. 打印进度实时同步回多维表格
```

## ⚠️ 注意事项

- 打印机必须启用「开发者模式」才能通过API控制
- 服务器需与打印机在同一局域网（或配置端口转发）
- 复用knowledge-tracker的飞书应用和机器人webhook时，两个系统消息会发到同一个群
- 端口默认为3001，与knowledge-tracker（3000）不冲突

## 🛠️ 技术栈

| 模块 | 技术 |
|------|------|
| 后端框架 | Express.js |
| 打印机通信 | bambu-link (MQTT) + FTP |
| 飞书API | @larksuiteoapi/node-sdk |
| 定时任务 | node-cron |
| 数据存储 | 飞书多维表格 |
