# 打印机局域网接入查证与逻辑链路 · bambu-print-reservation

> 覆盖范围：拓竹（Bambu Lab）与闪铸（FlashForge）打印机「局域网接入」方式的官方/社区资料查证（查证日 2026-09-06），以及本系统当前打印机链路的完整现状。
> 行号以 2026-09-06 工作区代码为准；代码改动后请同步更新本文件。
> 本文只描述「现在是什么」。官方口径与社区事实逐条标注；对接入决策、协议选型的改动决策记在各项目 DEVLOG.md。
> 资料核验程度约定：✔ = 已抓取原文核对正文；△ = 检索结果/摘要条目（未逐一抓取正文，谨慎引用）。

---

## 0. 结论摘要

- **拓竹官方没有面向个人开发者的局域网 API 文档**。官方 wiki 仅公开《打印机网络端口》✔ 一页网络事实（局域网模式：MQTT 8883、FTP 990+50000~50100、视频 6000；发现 SSDP 1990/2021）；官方对第三方开放的开发者通道是 **Fleet Hub 开发者中心**（企业授权：设备激活 Key + 客户端证书 + 本地 HTTP API，△）。局域网 MQTT 的用户名 `bblp`、topic、命令 JSON 等细节**均为社区逆向事实标准**（本仓库内 `node_modules/bambu-link` 即按此实现，已核源码）。
- **闪铸同样没有公开的局域网 API 开发文档**。官方口径只有「局域网模式/LAN Only + 屏幕 8 位 Printer ID（社区亦称 Check Code）」配合官方切片软件 FlashPrint 5 / Orca-FlashForge 绑定的操作说明（△）；协议事实（8898 HTTP / 8899 TCP / 8080 摄像头）来自社区对官方工具与固件的分析。
- **两家架构本质差异**：拓竹 = 打印机作为 MQTT broker 的**推送式长连接**（状态主动上报）；闪铸 AD5M 系 = **无状态 HTTP 轮询 + TCP 文本口**，没有公开的 MQTT/事件推送通道。
- **本系统现状：只实接拓竹**，走局域网直连（不经拓竹云）：MQTT 8883 状态/命令 + SFTP/FTP 文件上传，参数全部来自 `.env`；闪铸 AD5M 仅「登记展示 + 人工通道」（详见第 4 章）。

---

## 1. 拓竹 Bambu Lab：局域网接入

### 1.1 官方依据（wiki.bambulab.com《打印机网络端口》✔，已抓取核对）

官方把端口分成三组，本表只列与本系统相关的行（原文分组如下）：

| 模式 | 用途 | 端口/协议 |
|---|---|---|
| 云模式 | HTTP API | 80 / 443 / 8080（TCP） |
| 云模式 | MQTT | 8883（TCP，连 `us.mqtt.bambulab.com` / `cn.mqtt.bambulab.com`） |
| 云/局域网共用 | 设备发现 | 1990 / 2021（SSDP，multicast/broadcast） |
| 云/局域网共用 | NTP | 123（TCP/UDP） |
| **局域网模式** | **LAN MQTT** | **8883（TCP）** |
| **局域网模式** | **LAN FTP** | **990、50000~50100（TCP）** |
| 局域网模式 | LAN 视频 | 6000（TCP） |

官方页原文要点（引号内为页面原话）：
- 「当打印机处于局域网模式时，所有域名/IP地址都是无用的」——局域网模式下打印机不依赖任何云域名，可整机断外网自包含。
- 「域名/IP地址在未来可能会被改变」——云侧地址不保证长期不变。

官方对第三方的接入通道（△ 检索结果，未抓正文）：**Fleet Hub 开发者中心**（企业授权，创建设备激活 Key、签发客户端证书、提供 API 文档与示例代码，商务邮箱 `devpartner@bambulab.com`）；面向个人的 Cloud API / LAN API 开发文档官方未公开。

### 1.2 接入要素与获取步骤

| 要素 | 说明 | 本系统对应 |
|---|---|---|
| 局域网 IP | 打印机与机器人同一网段；可用官方发现端口（SSDP 1990/2021）或打印机屏幕「网络设置」查看 | `.env` `PRINTER_HOSTS` |
| Access Code | 8 位数字，打印机屏幕「设置 → 网络 → 局域网模式/开发者模式」下显示；社区经验：约 3 个月过期需重取 | `.env` `PRINTER_ACCESS_CODES` |
| 序列号 SN | 打印机「关于」页/Bambu Studio 可见；MQTT topic 与 TLS 登录名的组成部分 | `.env` `PRINTER_SERIALS` |
| 机型 | 决定文件上传通道（见 1.4） | `.env` `PRINTER_MODELS` |

获取步骤（官方操作口径 + 社区注记）：同网段 → 打印机屏幕开启局域网模式（LAN Only / 开发者模式）→ 记录屏幕显示的 IP 与 8 位 Access Code → 填入 `.env` 四列数组（`src/config.js:9-22` 按位置对齐）→ 重启服务，`manager.js` 自动建连（见 4.2）。

### 1.3 MQTT 协议事实（社区标准；本仓库 `node_modules/bambu-link` 源码已核 ✔）

| 项 | 事实 |
|---|---|
| Broker | 打印机本机，`mqtts://<host>:8883`，MQTT over TLS（自签证书，客户端跳过校验 `rejectUnauthorized: false`） |
| 用户名/密码 | 用户名固定 `bblp`，密码 = Access Code |
| Topic | 状态上报与命令收发共用 `device/{serial}/report`（bambu-link 订阅与 publish 同一 topic；社区文档中另有多实现把命令发到 `device/{serial}/request` 的写法，两套对固件均兼容） |
| 建连后首帧 | `{"pushing":{sequence_id, command:"pushall", version:1, push_target:1}}` 拉全量状态（bambu-link `dist/index.js:865-870`，sequence 自 10 起） |
| 后续数据 | 打印机持续推送增量状态 JSON（print/temps/ams/network 等分段） |
| 命令回包 | 命令帧带 `sequence_id`，回包中回显（`print.sequence_id` / `system.sequence_id`），按序号匹配挂起命令；超时默认 10s（bambu-link `dist/index.js:479,564-598`） |
| 命令类型 | 打印 3mf：`project_file`；打印 gcode 文件/控制：`print`（`print_gcode_file` 等）；`pause` / `resume` / `stop`；拉全量：`pushall` |
| 重连 | `reconnectPeriod: 5000ms`（bambu-link `dist/index.js:836`） |

> 注：1.3 全部内容均为社区协议事实，**官方未公开过上述字段级文档**；以官方 wiki 端口表佐证「8883 = LAN MQTT」这一点与社区一致。

### 1.4 文件上传通道（本系统现状 + 与官方表差异注记）

- 官方端口表将局域网 FTP 记为 **990 + 50000~50100**（FTPS，TLS 加密数据口），未区分机型。
- 本系统按机型走社区约定通道（`src/printer/client.js:278-284`）：**X1/H2D → SFTP:22**（`client.js:338-344`），**P1/A1 → FTP:21**（`client.js:373-380`）；凭证同为 `bblp` + Access Code，远端目录 `/sdcard/`。
- 注记：22/21 不在官方端口表内，属社区实现事实（不同机型暴露的服务集不同，实机可用）；官方 990 FTPS 本系统未使用。

---

## 2. 闪铸 FlashForge（AD5M / AD5X 系）：局域网接入

> 本节素材核验程度：官方部分为检索到的官方页面条目 △（未逐一抓取正文，仅确认存在与大意）；协议部分为社区资料条目 △。引用时注意。

### 2.1 官方口径（△）

闪铸没有面向第三方的局域网 API 开发文档；官方对局域网的使用说明只覆盖「绑定官方切片软件」：
1. 打印机与电脑/服务同网段；
2. 打印机开启**局域网模式（LAN Mode / LAN Only）**；
3. 在打印机「网络设置」中查看屏幕显示的 **Printer ID**（社区资料亦称 8 位 Check Code；绑定失败可刷新重取）；
4. 在 FlashPrint 5（老机型）或 **Orca-FlashForge**（5M/AD5X 新机型）中自动扫描或手动填 IP，输入 Printer ID 完成绑定。

来源条目：flashforge.jp 的 AD5X LAN 连接 FAQ、uk.flashforge.com「5M Series Printing Tips」、wiki.flashforge.com FlashPrint 5 连接说明（△）。

### 2.2 社区协议事实（△，Parallel-7/flashforge-api-docs 等；固件 3.2.x 验证）

| 端口 | 用途 |
|---|---|
| **8898 HTTP** | 主通道：JSON 请求/响应（状态查询与绝大多数控制） |
| **8899 TCP** | 低层文本协议口（G/M-code 级，社区库做查询/兜底） |
| **8080 HTTP** | 摄像头 MJPEG 流（Pro 机型） |

- **认证**：请求体携带 `serialNumber` + `checkCode`（每台打印机专属，屏幕「网络设置 → 局域网模式」下显示，社区提示会过期）。
- **端点样例**：`/detail`（状态详情，**状态靠轮询获取，无事件推送**）、`/product`、`/gcodeList`、`/gcodeThumb`、`/uploadGcode`、`/printGcode`、`/checkCode`、`/control` 等；控制命令有 `jobCtl_cmd`、`printerCtl_cmd`、`lightControl_cmd`、`temperatureCtl_cmd`、`stateCtrl_cmd` 等（社区文档所列，未逐条核验）。
- 社区实现仓库（Python/TS/HA 集成）均基于对 **Orca-FlashForge 局域网流量**的逆向，无官方 SDK。

### 2.3 拓竹 vs 闪铸：架构差异对照

| 维度 | 拓竹（Bambu Lab） | 闪铸 AD5M 系 |
|---|---|---|
| 连接形态 | 推送式 MQTT 长连接（打印机即 broker） | 无状态 HTTP 轮询（+TCP 文本口兜底） |
| 状态获取 | 订阅即推送，秒级主动回流 | 周期轮询 `/detail` 类端点 |
| 命令通道 | 同一 MQTT 帧流，按 `sequence_id` 回包 | HTTP 请求/响应（命令名带 `_cmd` 后缀） |
| 认证 | `bblp` + 8 位 Access Code（屏幕） | `serialNumber` + `checkCode`/Printer ID（屏幕） |
| 文件上传 | X1/H2D SFTP:22；P1/A1 FTP:21（社区）；官方表 990 FTPS | HTTP `/uploadGcode` 类端点 |
| 局域网模式开关 | 屏幕「局域网模式/开发者模式」 | 屏幕「LAN Mode / LAN Only」 |
| 官方开发者文档 | 无个人级；企业走 Fleet Hub（证书体系） | 无 |

**对本系统的含义（现状结论）**：拓竹的推送架构恰好匹配本系统「空闲即分发 + 任务变迁播报」的事件驱动模型；闪铸若接入需把状态回流从「事件推送」改为「定时轮询」并新增一套 HTTP 客户端与上传适配，模型与现有 `jobEvent` 驱动链不兼容，属新工程（本文不展开方案）。

---

## 3. 当前系统逻辑链路总图（现状：仅拓竹 LAN 直连）

```
【上游 · 飞书】 审批实例事件 approval_instance / 审批任务事件 approval_task（feishu-gateway 长连接收到后转发）
      │  POST /api/feishu/event（index.js:241，verificationToken 校验后 setImmediate 异步处理）
      ▼
【分发引擎 dispatcher】（src/services/dispatcher.js）
      enqueue（幂等：known/queue 双查，dispatcher.js:122-139）→ 触发匹配 trigger/match
      匹配：指定打印机优先 → AMS 材料类型精确/家族 + 颜色 redmean 近似 → 加急优先
            （dispatcher.js:222-249）；打印机空闲（jobEvent idle）同样触发（bindPrinterEvents :77-89）
      ▼ 匹配成功
【执行分发 dispatch】（dispatcher.js:290-373）
      ① 下载 3mf：审批附件 downloadApprovalAttachment（fileSource='approval'，不写预约镜像表）
      ② 上传：printerManager.uploadFileToPrinter → /sdcard/print_{recordId}.3mf
             model 含 X1/H2D → SFTP:22；否则(P1/A1) → FTP:21（client.js:278-284）
      ③ 下发：startProjectOnPrinter → MQTT project_file 帧（高段位 sequence_id，client.js:216-235）
      ④ 登记 printing[printerId]=task、updateState activeTask（dispatcher.js:324-325）
      ⑤ 群播报「开始打印」卡片
      ┆ 失败：回滚/重新排队，maxRetries 上限后退出队列转人工（dispatcher.js:341-371）
      ▼
【打印机 LAN 通道】（src/printer/client.js + node_modules/bambu-link）
      MQTT mqtts://<ip>:8883，bblp + Access Code
      topic device/{serial}/report：pushall 全量 + 增量状态 JSON（命令也 publish 到同一 topic）
      文件通道：SFTP:22 / FTP:21 → /sdcard/
      ▼
【状态回流】（src/printer/manager.js）
      state/stateUpdate → handleStateChange（manager.js:99-135）
      gcodeState 归一化（IDLE/PRINTING/PAUSE/FINISH/FAILED…，client.js:6-15）
      → updateState 内存 printerStates（statusChange 事件，展示/查询用）
      → 关键变迁 jobEvent（start/finish/failed/idle，manager.js:121-134）
      ▼
【下游动作】
      finish → completeTask：清映射、播报完成卡片、触发下轮匹配（dispatcher.js:375-392）
      failed → failTask：写回队列态、播报失败卡片（dispatcher.js:394-410）
      idle   → 下一轮匹配（新任务自动上机）
      每 60s → 打印机状态镜像表 upsert（manager.js:256-297, 308-310，仅展示）
【控制面（仅 HTTP，无聊天指令）】POST /api/printers/:id/{print,pause,resume,stop}（index.js:191-239）
      取消任务（dequeue → stopPrint）是引擎内唯一控制调用（dispatcher.js:146）
```

---

## 4. 逻辑链路逐段说明（文件:行号）

### 4.1 配置载入：`.env` → printers[]

- 四列逗号分隔数组按位置对齐成 `printers[]`：`src/config.js:9-22`（`PRINTER_HOSTS / PRINTER_ACCESS_CODES / PRINTER_SERIALS / PRINTER_NAMES / PRINTER_MODELS`），`id` 从 1 起；默认 model 兜底 P1S（`config.js:18`）。
- 分发相关参数：材料/颜色字段名、颜色近似阈值、对账/缺料提醒间隔、`useAms`、重试上限与冷却（`config.js:87-105`）；审批主通道开关 `approval.enabled`（`config.js:107-116`）。

### 4.2 常驻连接：模块级单例，require 即连

- `manager.js:306` 模块级 `new PrinterManager()`——**任何 require `printer/manager` 的模块都会触发初始化**，初始化即建连（`init` `manager.js:19-55`）。
- 自动分发白名单 `isAutoDispatchable`（X1/H2D/P1/A1，`manager.js:6-9`）：白名单外机型（如闪铸 AD5M）**不建 PrinterClient、不连接**，仅登记为状态条目并打日志（`manager.js:38-41`）。
- 多台错峰连接：`printer.id * 2000ms` 延迟（`manager.js:51`）；连接失败置 `status: 故障`（`manager.js:57-70`）。

### 4.3 MQTT 会话与状态归一化

- `client.js:42-48`：`new BambuLink(accessCode, host, 0, 8883, serial)`；库内真实连接参数见 1.3（`node_modules/bambu-link/dist/index.js:833-843`）。
- 事件转发：`connect/disconnect/state/stateUpdate/error`（`client.js:50-75`）。
- 状态归一化以 **gcodeState** 为准（`job.stage` 是数值型判不准，`client.js:129-151` 注释）；gcodeState → 中文状态映射表 `client.js:6-15`。
- **剩余时间单位注记**：`mc_remaining_time` 单位是分钟，bambu-link 误命名为 `remainingSeconds`，勿再除以 60（`client.js:144`）。
- AMS 耗材清单：`existBits` 判定槽位实装、`trayNow` 判活跃、`vtTray` 含外部料架（`client.js:157-195`）。

### 4.4 状态事件分级（manager）

- `handleStateChange`（`manager.js:99-135`）：先 `updateState` 全字段刷新（仅变化时发 `statusChange`，`manager.js:142-151`）；再按 gcodeState 变迁发 `jobEvent`——PRINTING（非 RESUME 而来）→ `start`、FINISH → `finish`、FAILED → `failed`、PRINTING→IDLE/FINISH → `idle`（`manager.js:121-134`）。
- `jobEvent` 只被 dispatcher 消费（`bindPrinterEvents`，`dispatcher.js:77-89`）；`statusChange` 供查询接口/页面使用。

### 4.5 分发引擎（dispatcher，单例 `dispatcher.js:485`）

- 启动 `start`（`dispatcher.js:58-75`）：主通道开启（`approval.enabled` 默认 true）时**关闭预约镜像表对账**（防重复入队），仅靠事件秒级驱动；主通道关闭时退回分钟级对账兜底（`reconcile` `dispatcher.js:92-117`，幂等补漏 + 重启后恢复打印中映射）。
- 队列与幂等：`queue + known Set + printing Map`；入队三查（known/queue）防事件与对账重复（`dispatcher.js:122-139`）。
- 匹配串行化：`matching` 锁 + 完成后按需 `setImmediate` 重跑（`trigger` `dispatcher.js:153-174`）；队首匹配不到不阻塞后续任务（`findAnyMatch`），全队列缺料才发缺料提醒（节流 `materialRemindMinutes`，`dispatcher.js:276-287`）。
- 分发执行链（`dispatch` `dispatcher.js:290-373`）：见总图；失败处理为「回滚表状态 → 重试计数 → 冷却 `nextMatchAt` → 重新入队 → 冷却后定时再触发」，达 `maxRetries` 退出队列并发人工介入卡片（`dispatcher.js:341-371`）。
- 完成/失败：`completeTask`（`dispatcher.js:375-392`）、`failTask`（`dispatcher.js:394-410`）——清 `printing` 映射与 `activeTask`、非审批源写预约镜像表状态、播报卡片、触发下轮。
- 取消：`dequeue`（`dispatcher.js:141-150`）对打印中任务调用 `stopPrintOnPrinter` 停机并释放映射。

### 4.6 事件入口（index.js）

- `POST /api/feishu/event`（`index.js:241-308`）：verificationToken 校验；`approval_instance` → `processApprovalEvent`（审批结果直接驱动入队/取消，秒级，主通道，`index.js:253-261`）；`approval_task` → 自动审批入口（`index.js:264-272`，配合 `APPROVAL_AUTO_APPROVER_ID`）；`bitable.record.create/update` → 镜像表事件后备模式（`index.js:274-295`）；`im.message.receive_v1` → 聊天消息（`index.js:297-305`）。长连接不属于本项目（`.env` `FEISHU_USE_LONG_CONNECTION=false`，事件由 feishu-gateway 转发）。
- `POST /api/chat/command`（`index.js:310-324`）：`{command,args}` → `{reply}`，回复由网关代发；`/print-status` 对非自动机型标注「仅登记，分发需人工」。
- HTTP 控制端点（`index.js:191-239`）：`POST /api/printers/:id/{print,pause,resume,stop}`（print 需 body `filePath`），透传 manager → client → MQTT 帧。**项目内无聊天指令对应**，供外部/人工调用。

### 4.7 群播报与镜像表

- 播报：入队/开始/完成/失败/缺料/人工介入卡片（`src/feishu/bot.js` 的 `buildQueueCard/buildJobStartCard/buildJobFinishCard/buildJobFailedCard/buildMaterialMissingCard`）→ 群自定义机器人 webhook（`.env` `BOT_WEBHOOK_URL`）。
- 镜像表：每 60s `syncPrinterStatusToBitable`（`manager.js:256-297` + `setInterval` `manager.js:308-310`）把全部登记打印机 upsert 到飞书打印机表（printerName/model/ipAddress/status/currentJob/progress/temperature/lastUpdate）；未配 `BITABLE_PRINTER_TABLE_ID` 时静默跳过。**注意**：审批源任务不回写预约镜像表（那是审批系统数据，`dispatcher.js:300-307` 注释），追踪在引擎内存完成。

### 4.8 闪铸等非自动机型的现状路径

登记展示（`manager.js:38-41`）→ `/print-status` 标注仅登记 → 人工指令 `/print-dispatch` 落到非自动机型时只写表并返回 `manualOnly: true`，提示用厂商工具上传（`dispatcher.js:454-464`）。**本系统对闪铸没有任何网络协议代码**（`.env.example` 中 `闪铸AD5M`/`ADVENTURER5` 仅为登记示例）。

---

## 5. 实现参数 × 官方 × 社区：一致性对照与风险注记

| 项 | 本实现 | 官方 | 社区事实 | 结论/注记 |
|---|---|---|---|---|
| 局域网 MQTT 端口 | 8883 | ✔ 8883（LAN MQTT） | 8883 | 一致 |
| MQTT 用户名 | `bblp` | 未公开 | `bblp` 通用 | 社区约定 |
| 密码 | 屏幕 8 位 Access Code | 屏幕取码（操作口径） | 通用 | Access Code **可能过期**（社区经验约 3 个月），需重取并更新 `.env` 重启 |
| TLS | mqtts 自签、跳过校验 | 未公开细节 | 通用 | 固件若升级（社区注记：2025-01 后部分固件要求 X.509 证书/认证演进），连不上先查固件与库版本 |
| MQTT topic | 订阅与发布同一 `device/{sn}/report` | 未公开 | 另有 request/report 分流写法 | 当前库实机可用；换库/换固件需回归验证 |
| 拉全量 | `pushall`（`version:1, push_target:1`） | 未公开 | 通用 | — |
| 文件上传 | X1/H2D SFTP:22；P1/A1 FTP:21 | ✔ 官方表记 LAN FTP 990+50000~50100（FTPS） | 多通道并存，按机型 | **差异注记**：22/21 不在官方表；官方 990 通道未使用，实机可用为先 |
| 命令帧 | `project_file`（`url: ftp:///sdcard/…`）/ print / pause / resume / stop | 未公开 | 通用 | `url` 用 `ftp:///` 字面量是社区标准写法（`client.js:214` 注释） |
| 状态判定 | `gcodeState` + `job`/`temps`/`ams` 字段 | 未公开 | 通用 | 依赖库内字段名（如 `remainingSeconds` 实为分钟，见 4.3） |

风险注记汇总：
1. **Access Code 过期**：重取需人工上机操作，社区经验约 3 个月；过期症状为 MQTT 认证失败（`[打印机] xxx 已断开/连接失败` 且无状态回流）。
2. **固件与库演进**：协议无官方承诺，bambu-link 为第三方库（本项目锁 1.1.0），固件侧 2025-01 后存在证书/认证演进社区注记；升级任一侧需回归「连接 → 全量 → 分发 → 完成」全链。
3. **单 topic 收发**：命令与上报共用 report topic，依赖固件对「report 上收命令」的兼容行为（bambu-link 实现事实）。
4. **闪铸接入成本**：无官方 API 文档 + 轮询式架构 + 需自研 HTTP/上传适配（见 2.3），与现有事件驱动链不兼容，接入前需单独立项评估。

---

## 6. 参考资料清单（查证日 2026-09-06）

**官方（拓竹）**
- ✔ [Bambu Lab 官方 wiki《打印机网络端口》](https://wiki.bambulab.com/zh/general/printer-network-ports)——云/局域网模式端口表（8883 MQTT、990 FTP、SSDP 1990/2021 等）与局域网模式说明。
- △ [Bambu Lab Fleet Hub 开发者中心](https://bambulab.com/zh/fleet-hub/developer) 及[开发者协议](https://bambulab.com/zh/fleet-hub/developer/develop-agreement)——企业级第三方接入通道（设备 Key/证书/本地 HTTP API），个人级 LAN API 文档不存在。

**官方（闪铸）**
- △ flashforge.jp AD5X 局域网（LAN Only）连接 FAQ、uk.flashforge.com「Flashforge 5M Series Printing Tips」、wiki.flashforge.com FlashPrint 5 连接说明——「局域网模式 + 屏幕 Printer ID + 官方切片软件绑定」操作口径；均无 API 开发文档。

**社区（协议事实标准，非官方）**
- ✔ `node_modules/bambu-link`（本仓库依赖源码，已核：mqtts 8883 / `bblp` / 单 report topic / pushall / 10s 命令超时）。
- △ [Doridian/OpenBambuAPI](https://github.com/Doridian/OpenBambuAPI)——拓竹局域网协议文档化仓库。
- △ [Parallel-7/flashforge-api-docs](https://github.com/Parallel-7/flashforge-api-docs)——闪铸 AD5M 系局域网 HTTP/TCP 协议文档（8898/8899/8080、serialNumber+checkCode、端点与命令清单）。
- △ GhostTypes/ff-5mp-api 系、schwarztim/bambu-mcp 等社区实现条目（检索摘要引用，未逐一抓取正文）。
