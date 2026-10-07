# bambu-print-reservation · 拓竹 3D 打印自动分发系统

飞书多维表格审批 + 拓竹打印机（MQTT/SFTP）全自动分发：切片产出 3mf → 表单提交 → 专人审批 → **秒级事件监听** → 按 AMS 耗材自动选机 → 上传并开始打印 → 全程群播报。

> **架构转向（2026-10-05 路线 A）**：断开飞书审批链，转为**自建前后端**——浏览器页面（本服务同源伺服 `public/index.html`）提交预约（源文件上传 + 需求标签勾选）、页面审批（X-API-Token 口令），预约真相源为本服务本地存储（`RESERVATIONS_STORE_FILE`）；多维表格镜像/审批实例事件/自动审批/对账自愈整链退役（`approvalService.js`/`eventSubscription.js` 保留文件不再接线，`/api/feishu/event` 端点删除）。飞书仅剩**群 webhook 播报**（通知通道，非数据依赖；`BOT_WEBHOOK_URL` 清空即静默）与 `/api/chat/command` 查询指令入口。需求标签池 + 工艺映射规则库（下两节）为自动切片铺路。

## 工作流

```
浏览器页面（public/index.html）提交：源文件(stl/step/3mf) + 材料/颜色 + 需求标签勾选
   ↓ 提交即过规则引擎（applyRules）定档切片参数并快照存档；硬冲突当场打回
   ↓ 审批人在页面审批（X-API-Token）→ 通过即入队（本地任务 fileSource=local）
   ↓ 打印机空闲触发匹配
   ↓ AMS 装料匹配：材料类型(精确→家族) + 颜色(redmean 近似)
   ↓ 本地文件读取 → SFTP/FTP 上传打印机 /sdcard/ → MQTT project_file 下发
   ↓ gcodeState 变迁监听：开始/完成/失败 → 群 webhook 播报
```

> 多维表格不再是数据面（打印机状态写表已停用）；需求标签体系与规则库见下两节，为「上传 STEP/STL 自动切片」铺路。

## 打印机支持

| 机型 | 接入方式 | 自动分发 |
| --- | --- | --- |
| X1C / H2D | MQTT 8883 + SFTP 22（bblp + Access Code），AMS 完整 | ✅ |
| P1 / A1 | MQTT 8883 + FTP 21 | ✅（AMS 有则匹配） |
| 闪铸等非 Bambu | 仅 .env 登记 | ❌ 人工通道（页面/运维台指定后提示手动上传） |

## 指令（群内 @对话型机器人 或经网关转发）

| 指令 | 说明 |
| --- | --- |
| `/print-help` | 显示帮助（`/help` 同效） |
| `/print-status` | 打印机状态 + AMS 耗材 + 当前任务进度 + 等待队列 |
| `/print-ams` | 所有打印机装载耗材明细 |
| `/print-list` | 全部预约记录 |
| `/print-pending` | 待审批预约 |

> 指令收窄（2026-10-05）：聊天通道仅保留**查看类**；提交/审批/人工指定分发请用打印预约页面（人工恢复 `POST /api/dispatch/manual`，reviewer+）。

播报（webhook 群机器人）：新预约通知、入队、打印开始/完成/失败、缺料提醒（30 分钟节流）——路线 A 下播报仍走群机器人 webhook（`BOT_WEBHOOK_URL` 清空即静默）。**晚间静默**：上述播报落在 02:00–09:00（`QUIET_HOURS_START/END` 可配、`QUIET_HOURS_DISABLED=1` 关闭）内时积压到 09:00 原样补发（打印机控制/写表不延迟，只有消息延后；/print-* 指令回复不积压），详见 `src/utils/quietHours.js` 与顶层 AGENTS.md「晚间静默」。

## 分发匹配规则（按序）

1. 打印机空闲（gcodeState=IDLE/FINISH）且 Bambu 系
2. 表单「指定打印机」优先
3. AMS 精确材料匹配 + 颜色近似（ΔE 阈值可配）
4. 家族匹配（PLA-CF ↔ PLA）
5. 加急优先出队，队首缺料不阻塞后续任务

## 分发互斥（2026-09-13）

人工指定打印机（页面/运维台 → `POST /api/dispatch/manual`）与自动匹配共用**按打印机的分发闸门**：dispatch 的下载/上传/下发是分钟级 await 链（占用登记在链尾），闸门在入口同步判定——分发中的打印机对自动匹配不可见、对人工指定回「正在有任务分发中，请稍候再试」；失败/重试路径由 finally 释放，闸门刻意不持久化（崩溃后清零重新评估，残留锁才危险）。

## 多维表格与审批表单字段

主通道下材料/颜色/指定打印机是**官方审批表单字段**，按标题关键词自适应解析（`APPROVAL_CODE` 留空时依赖「表单含附件」识别打印审批，建议配置 code 收窄）；`scripts/add-dispatch-fields.js` 仅对旧版表格直提交流程有意义。
状态流转：`待审批 → 已通过/已驳回 → 排队中 → 打印中 → 已完成`（分发失败回滚「排队中」重试；任意时刻可 `已取消`）。

> **文档权限**：需在飞书中把应用「爆米花机」添加为该多维表格的**可编辑协作者**，否则写状态会报 91403。

## 事件链路（qianli 架构）

事件由 feishu-gateway（共用应用唯一长连接）转发：**审批实例事件 approval_instance → `POST /api/feishu/event`（主通道，秒级）**；approval_task 事件驱动自动审批（`APPROVAL_AUTO_APPROVER_ID`）；表格事件（legacy 结构）仅后备模式（APPROVAL_PRIMARY=false 时启用+对账）；指令 → `POST /api/chat/command`。本服务 `FEISHU_USE_LONG_CONNECTION=false`。分发失败按 `DISPATCH_MAX_RETRIES` 次上限重试，每次间隔 `DISPATCH_RETRY_COOLDOWN_MS`，超限退出队列转人工。

前置配置（一次性）：① 开发者后台事件订阅添加「审批实例状态变更 approval_instance」；② 应用开通审批读取权限；③ 拿到审批定义 code 后调 subscribeApproval 订阅（见 .env.example）。

## 定制窗口

`GET /api/print/policy`（只读全景）：打印机登记清单、审批主通道/自动审批/对账参数、分发匹配参数（颜色阈值/重试上限/冷却）、队列与打印中快照。运维台「功能激活」面板消费。

## 部署

```
npm run push
```

详见顶层 `.agents/skills/qianli-deploy/SKILL.md`。部署路径 `/c/qianli/opt/bambu-print-server`，pm2 进程 `bambu-print-server`，端口 3001。

## 可靠性与自愈（2026-09-13）

- **分发中断自愈**：进程在下载/上传链中途重启，恢复时中断任务重回队列完整重发（不静默丢单；若打印机已被上次尝试开打，重发会覆盖——比丢单可感知）；
- **printing 幽灵巡检**：每 10 分钟检查打印中任务——超过预估时长（6h×2）且打印机实况已空闲的任务补「已完成」收尾（finish 事件落在停机/离线窗口时的兜底）；
- **人工恢复通道**：自动重试耗尽的任务保留在 givenUp 列表（已随 v29 落盘持久化，重启不丢），页面/运维台 `POST /api/dispatch/manual`（reviewer+）可直接恢复（审批源单 instance_code 不在镜像表也能找到）；
- 已知边界：审批取消落在分发链窗口内时打印仍会启动（取消与分钟级分发链的竞态，记录在案暂不修）。

## 状态持久化（2026-09-13 起）

分发引擎的**队列 / 打印中映射 / 已知记录 / 完成计数**落盘到 `DISPATCH_STATE_FILE`（代码默认项目根 `.dispatch-state.json`，生产 `.env` 配置为项目外数据目录 `C:/home/qianli/bambu-data/dispatch-state.json`——部署目标为 Windows 小电脑，路径带盘符）——进程重启（含部署 pm2 restart，SIGINT/SIGTERM 退出前强制冲刷）后自动恢复，**打印预约排队不再因重启丢失**。变更防抖 300ms 合并写入、临时文件原子改名；`known` 截尾 2000 条防无限增长；文件损坏按空队列启动（审批事件/对账可重新入队）。

## 需求标签池（taxonomy，2026-10-05 起）

「勾选 → 规则引擎 → 自动切片」体系的第一层词汇表：用户在审批表单勾选**需求标签**（载荷方向/受力类型/耐温等级/使用寿命……），由映射规则库（待建）翻译成切片参数，实现「上传 STEP/STL + 勾选项 → 自动切出合适的片」。设计口径见 DEVLOG 对话定稿：

- **四条铁律**：①每标签必须能回答映射到什么切片参数（`mapsHint` 强制非空）；②维度正交（方向×类型×性质拆分，组内单选/组间多选）；③默认不勾=常规件一键提交；④词汇表（`taxonomy.js`，`TAXONOMY_VERSION`）与映射规则库（`processRules`，待建，`rulesVersion`）分离，版本号独立；
- **受力参照系**：方向标签按**此件工作时的朝向**（Z=工作时竖直向上，可多选）——Z 向受力≈打印层缝方向（最弱），是规则引擎调朝向的依据；材料类型**可不填**（2026-10-05 曼波定）：勾选标签由规则引擎反推材料约束（materialExclude/materialPrefer 随单下发，分发匹配时对 AMS 实装料槽求值）；配合需求精简为间隙/过盈/精密（去过渡配合）；连接方式含「打印件自配合（插接/卡扣）」；份数仅在表单顶部（标签池不重复设）；
- **冲突双级**：`block`（表单端拦截，如耐温≥80°C×PLA、电气绝缘×CF 系——碳纤导电、长期静载×PLA 蠕变）/ `warn`（警告放行，如高速×外观件）；材料类冲突需提供材料字符串时才判定；
- **落地物**：`src/services/taxonomy.js`（标签池 v2：8 组 24 字段 + 7 条冲突规则）、`validateSelection(selection, {material})`（校验）、`selectionFromFormFields([{title,value}])`（审批表单字段 → 标准化勾选，供 parseForm 后续接线）、`GET /api/print/taxonomy`（只读窗口：标签全景+映射提示+冲突规则，运维台展示与打标指南取数）；
- 测试：`node test/taxonomy-test.js`（19 项，已并入 npm test 与 push 闸门）。

## 工艺映射规则库（processRules，2026-10-05 起）

体系的第二层：标签勾选 → **切片参数集**。`src/services/processRules.js`：

- **参数白名单**（22 个，CLI 可消费的核心参数全集；2026-10-05 细化批新增顶/底面实心层数、支撑悬垂阈值角、支撑密度、裙边宽度、喷嘴温度Δ）：`directionStrategy/layerHeight/wallLoops/infillDensity/infillPattern/supportType/speedProfile/seamPosition/xyHoleComp/xyContourComp/ironing/brim/temperatureDelta/materialExclude/materialPrefer`；规则 `set` 引用白名单外参数、`when` 引用池外字段、缺 `reason` 一律拒收（可审计铁律）；
- **应用语义**：`BASELINE`（出厂默认）为底，规则按 `priority` 升序叠加，同名参数 priority 大者赢；标签级冲突不做二次裁判——`applyRules` 入口统一走 `taxonomy.validateSelection`，errors 非空即 `blocked`（含材料类冲突，需传 `material` 才判定）；
- **材料裁定**：`materialExclude/materialPrefer` 存 regex 源（如 `'^PLA'`），对材料字符串求值得 `materialVerdict`（选机匹配层消费；表单端 block 是第一道闸，此处是引擎端兜底）；
- **版本**：`rulesVersion` = 规则集内容 hash 短码，与 `taxonomyVersion`、baseline 版本、Bambu Studio 版本共同构成切片产物缓存 key 四件套；
- **窗口**：`GET /api/print/process-rules`（基线/白名单/规则集全景）；`POST /api/print/process-rules`（X-API-Token 鉴权，`{op:'upsert'|'remove'|'reset', rule?, id?}`，内存热改 + 原子写回规则文件）；
- **存储**：出厂种子规则内置代码（23 条，翻译自 taxonomy 各标签 mapsHint）；外部规则文件 `PROCESS_RULES_FILE`（默认项目根 `.process-rules.json`，生产配项目外数据目录，防 push 清目录丢失——同 `DISPATCH_STATE_FILE` 模式）；文件加载失败回退种子；
- 测试：`node test/process-rules-test.js`（17 项，已并入 npm test 与 push 闸门）。

## 学习链路（2026-10-05 第三批：「机器学人」落地）

`src/services/ruleSuggestions.js`（待审池）+ `src/services/slicerExtract.js`（3mf 提取）：

- **修正回路**：审批人/使用者在记录上点「建议修正」→ 编辑参数 + 填理由 → 自动携带该单勾选组合（`normalizeWhen` 归一化单据 selection 为规则 when 形态）入待审池；**相同 when+set 自动聚合计数**（高频修正浮顶，审核负担不随修正次数增长）；
- **冷启动（专家作品导入）**：上传专家手工切片 3mf → `extractFrom3mf` 解包（zip：`project_settings.config` JSON 优先 / gcode 头部注释兜底）→ Bambu 参数名映射白名单内核心参数（`%/枚举`清洗）→ 与 baseline 的 diff 即候选草稿 → 以页面当前勾选为条件提交待审池。⚠️ 映射表按 Bambu Studio 常见导出字段编写，首次真机导入以 raw 键值人工核对并校准；
- **审核闸门（强制）**：待审池建议一律不直接生效——reviewer 及以上「采纳」才经 `processRules.upsertRule` 转正（默认 priority 120，介于外观 100 与高速 200 之间，可指定）；拒绝即归档。采纳/拒绝不可重复操作；
- **使用效率**：提交页**参数实时预览**（勾选变化即调 `POST /api/print/process-rules/preview`，提交前看到「本单会怎么切」与材料裁定）；勾选记忆（上次选择自动恢复）；审批卡展示命中规则与理由（既有）；
- 端点：`POST /api/print/process-rules/preview`（登录）、`POST /api/print/rule-suggestions`（登录可提）、`GET /api/print/rule-suggestions?status=` 与 `/:id/adopt`、`/:id/reject`（reviewer+）、`POST /api/print/slicer-extract`（reviewer+，multipart 3mf）；
- 存储：`RULE_SUGGESTIONS_FILE`（默认项目根 `.rule-suggestions.json`，生产配项目外）；
- 测试：`node test/learning-loop-test.js`（10 项，已并入 npm test 与 push 闸门）。规划中：失败原因打标反馈回路（只记录不自动调参）、规则命中率统计上 policy 窗口。

## 账号体系（2026-10-05 第二批：防止未授权使用）

- **角色**：`member`（注册即得：提交预约/查看/取消自己的单）→ `reviewer`（审批通过/驳回/人工恢复）→ `admin`（用户角色管理/打印机控制/状态强改）；**首位注册者自动成为 admin**（bootstrap），审批人由 admin 在页面「用户与角色」卡升权；
- **安全实现**：scrypt + 随机盐口令哈希、`timingSafeEqual` 比对、同用户名 5 次失败锁 10 分钟、会话 token（HttpOnly cookie，30 天，落盘重启不掉线）；发起人强制取登录身份（`submittedBy` 归属键），body 里的 applicant 一律忽略——**冒名提交不可能**；
- **鉴权双通道**：页面走 `bambu_session` cookie（`requireUser(roles)`）；运维台/脚本走 `X-API-Token`（视作 admin，既有管理链路不破）；
- **聊天指令收窄（2026-10-05 曼波定）**：飞书侧仅保留**群 webhook 播报**与**查看类指令**（`/print-status` `/print-ams` `/print-list` `/print-pending` `/print-help`）；`/print-dispatch` 动作指令移除（人工恢复走页面/运维台，reviewer 及以上）；
- 存储：`AUTH_STORE_FILE`（默认项目根 `.auth-users.json`，生产配项目外数据目录）；
- 测试：`node test/auth-test.js`（13 项，已并入 npm test 与 push 闸门）。

## 自建前后端 API（路线 A 主通道）

| 端点 | 鉴权 | 说明 |
| --- | --- | --- |
| `GET /`（public/index.html） | 无 | 页面：登录/注册 → 提交 → 列表 → 审批（reviewer）→ 用户管理（admin） |
| `POST /api/auth/register`、`/login`、`/logout`、`GET /api/auth/me` | 无/会话 | 注册（首位=admin）、登录发 cookie、登出、当前用户 |
| `GET /api/auth/users`、`POST /api/auth/users/:id/role` | admin | 用户名册与角色升降 |
| `POST /api/reservations` | 登录 | multipart：`file`（≤200MB）+ materialType*/color/quantity/assignedPrinter/selection(JSON)；发起人取登录身份；提交即 `applyRules` 定档，硬冲突 400 |
| `GET /api/reservations`、`GET /api/reservations/:id` | 登录 | 本地存储查询（含参数快照/规则依据/状态轨迹） |
| `POST /api/reservations/:id/approve`、`/reject`、`/review` | reviewer+ | 审批动作（仅待审批单可批/驳；通过即入队并回写排队中） |
| `POST /api/reservations/:id/cancel`、`DELETE /api/reservations/:id` | 本人或 reviewer+ | 取消（排队/分发中/打印中均由 dequeue 兜住） |
| `PUT /api/reservations/:id` | admin | 状态变更走本地状态机 |
| `POST /api/printers/:id/print/pause/resume/stop` | admin | 打印机控制（会话 admin 或管理 token） |
| `POST /api/dispatch/manual` | reviewer+ | 人工指定分发/恢复 givenUp |
| `GET /api/print/taxonomy`、`GET/POST /api/print/process-rules` | 读无 / 写 token | 标签池与规则库窗口（提交页勾选 UI 的数据源） |

存储：`RESERVATIONS_STORE_FILE`（记录）、`RESERVATIONS_UPLOAD_DIR`（上传文件）、`AUTH_STORE_FILE`（账号），默认项目根隐藏文件，生产均配项目外数据目录防部署清目录丢失。状态机：待审批→已通过/已驳回/已取消；已通过→排队中；排队中⇄打印中（失败重排）→已完成；终态锁定。

## 测试

```
node test/dispatcher-test.js          # 分发引擎匹配逻辑单测（18 项）
node test/approval-test.js            # 审批事件解析/自动审批逻辑单测（9 项）
node test/dispatcher-persist-test.js  # 分发引擎状态持久化往返测试（落盘/重启恢复/截尾/损坏兜底）
node test/dispatcher-manual-race-test.js  # 分发互斥闸门测试（人工指定 vs 自动匹配竞态修复回归，16 项）
node test/taxonomy-test.js            # 需求标签池单测（结构铁律/校验/冲突/表单提取，19 项）
node test/process-rules-test.js       # 工艺映射规则库单测（种子自洽/叠加优先级/材料裁定/热改，17 项）
node test/local-reservation-test.js   # 本地预约系统单测（存储/状态机/规则快照/审批入队集成，12 项）
node test/auth-test.js                # 账号体系单测（注册/登录限速/会话/角色/中间件双通道，13 项）
node test/printer-upload-channel-test.js  # 上传通道分流单测（FTPS 990 优先/FTP 21 回退/SFTP 机型分流/连接参数，8 项）
```
