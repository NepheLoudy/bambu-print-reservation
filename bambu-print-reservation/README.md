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

使用飞书审批功能创建多维表格，字段如下：

#### 预约表字段（审批表）

| 字段名 | 类型 | 说明 |
|--------|------|------|
| 申请编号 | 自动编号 | 系统自动生成 |
| 申请状态 | 单选 | 待审批/已通过/已驳回/排队中/打印中/已完成/已取消 |
| 发起时间 | 日期时间 | 预约发起时间 |
| 发起人 | 人员 | 预约发起人 |
| 是否为千里内部项目 | 复选框 | 是否为内部项目 |
| 切片文件 | 文件 | 3MF/STL切片文件 |
| 切片文件详情截图 | 图片 | 切片预览截图 |
| 是否加急 | 复选框 | 是否加急处理 |

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
- `bitable.record.create` — 多维表格记录创建（新预约申请）
- `bitable.record.update` — 多维表格记录更新（审批结果）

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
| `/help` | 显示基础帮助（项目看板） |
| `/print-help` | 显示打印相关详细帮助 |
| `/print-status` | 查看所有打印机状态 |
| `/print-list` | 查看所有预约记录 |
| `/print-pending` | 查看待审批预约 |

### 指令区分

两个系统共用同一个机器人，通过前缀区分：

| 系统 | 指令前缀 | 功能 |
|------|----------|------|
| 项目看板 | `/` | DDL播报、关键词监听、状态查询 |
| 3D打印 | `/print-` | 打印机状态、预约列表、待审批 |

### 示例

```
@爆米花机-对话型 /help          # 项目看板帮助
@爆米花机-对话型 /status        # 项目看板状态
@爆米花机-对话型 /print-help    # 3D打印帮助
@爆米花机-对话型 /print-status  # 打印机状态
```

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
| `/api/reservations/:id/review` | POST | 处理审批结果 |
| `/api/printers` | GET | 打印机状态列表 |
| `/api/printers/:id/print` | POST | 开始打印 |
| `/api/printers/:id/pause` | POST | 暂停打印 |
| `/api/printers/:id/resume` | POST | 恢复打印 |
| `/api/printers/:id/stop` | POST | 停止打印 |
| `/api/feishu/event` | POST | 飞书事件回调 |

## 🔄 工作流程

```
1. 用户在飞书审批多维表格填写预约（发起人、发起时间、切片文件、打印机）
2. 系统监听到表格新增记录，通知审批者
3. 审批者在Bambu Studio中审查3MF切片文件
4. 审批者在多维表格中填写审批结果（通过/驳回）
5. 审批通过 → 系统自动下载文件并上传到打印机 → 排队打印
6. 审批驳回 → 系统通知发起人修改后重新提交
7. 打印进度实时同步回多维表格
```

## ⚠️ 注意事项

- 打印机必须启用「开发者模式」才能通过API控制
- 服务器需与打印机在同一局域网（或配置端口转发）
- 复用knowledge-tracker的飞书应用和机器人webhook时，两个系统消息会发到同一个群
- 端口默认为3001，与knowledge-tracker（3000）不冲突
- 飞书事件统一由 **feishu-gateway**（本机 :3010）持有长连接并转发到本服务 `/api/feishu/event`，本服务设置 `FEISHU_USE_LONG_CONNECTION=false`；网关会把 V2 表格事件转换为本服务期望的 `bitable.record.create/update` 旧版结构（含 `record.fields`），预约/打印队列事件链路依赖此转发

## 🛠️ 技术栈

| 模块 | 技术 |
|------|------|
| 后端框架 | Express.js |
| 打印机通信 | bambu-link (MQTT) + FTP |
| 飞书API | @larksuiteoapi/node-sdk |
| 定时任务 | node-cron |
| 数据存储 | 飞书多维表格 |

## 🚀 部署到 NAS

### 一键部署

```bash
npm run deploy
```

部署脚本会自动完成：
1. SSH 连接到 NAS（`10.253.33.233:8500`）
2. 创建 `/opt/bambu-print-server` 目录
3. 从 GitHub 拉取最新代码
4. 安装依赖
5. 写入 `.env` 配置文件
6. PM2 启动服务（进程名 `bambu-print-server`）
7. 开放防火墙 3001 端口

### 检查 NAS 运行状态

```bash
npm run deploy:check
```

会输出最近50行日志和健康检查结果。

### 前置条件

1. 代码已推送到 GitHub：
   ```bash
   git add -A
   git commit -m "your message"
   git push origin main
   ```
2. NAS 上已安装 Node.js、npm、pm2
3. NAS 的 `.env` 中的 `BITABLE_APP_TOKEN`、`PRINTER_HOSTS` 等需手动填写实际值

### Git 工作流

```bash
# 提交代码
git add -A
git commit -m "feat: your feature"
git push origin main

# 部署到 NAS
npm run deploy

# 检查部署状态
npm run deploy:check
```

### NAS 上手动操作

```bash
# SSH 登录 NAS
ssh -p 8500 qianli@10.253.33.233

# 查看PM2进程
pm2 list

# 查看日志
pm2 logs bambu-print-server

# 重启服务
pm2 restart bambu-print-server

# 更新代码
cd /opt/bambu-print-server
git pull origin main
npm install --production
pm2 restart bambu-print-server
```
