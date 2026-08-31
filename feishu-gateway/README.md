# feishu-gateway 飞书事件网关

统一解决 qianli 工作区下所有飞书机器人「共用同一个飞书应用、各自开长连接抢事件」的问题。

## 问题背景

qianli 项目群的所有机器人共用同一个飞书自建应用（`cli_aac7e6f6cdf8dcc0`）。此前每个机器人项目都各自启动一个 `WSClient` 长连接，而**飞书对同一应用的多条长连接是随机分发事件**——每条事件只投递给其中一条连接，导致：

- `im.message.receive_v1`（@机器人消息）：随机落到某个机器人，指令时灵时不灵；
- `drive.file.bitable_record_changed_v1`（多维表格变更）：随机落到某个机器人，靠各项目自己的轮询对账兜底补漏。

各项目此前的缓解办法（现保留为兜底，不再是唯一防线）：

| 项目 | 缓解办法 |
| --- | --- |
| ticket-bot | 事件仅作快速触发 + 每分钟轮询对账 + 「已播报」标记防重 |
| approval-bot | 5 分钟轮询对账（`BITABLE_POLL_MINUTES`）+ `/approval-*` 指令转发契约 |
| project-management-robot (hub) | 收到消息后代转发 `/approval-*`、`/print-*` 指令给对应机器人 |
| bambu-print-reservation | 端口错开（3001）；事件订阅实际为空操作，预约事件链路长期失效 |

## 统一方案：单连接 + 本地路由

**只有本网关持有共用应用的唯一长连接**，收到事件后按规则通过本机 HTTP 转发给各机器人已有的 `/api/feishu/event` 端点（机器人全部设置 `FEISHU_USE_LONG_CONNECTION=false`）。事件从此确定性到达，不再被抢。

```
                       飞书开放平台（共用应用，长连接订阅模式）
                                      │ 唯一 WebSocket 长连接
                                      ▼
                            ┌──────────────────┐
                            │  feishu-gateway  │  :3010
                            │  (本机唯一连接)   │
                            └────────┬─────────┘
              消息事件：路由规则命中单一目标      多维表格事件：广播（各机器人按 table_id 过滤）
        ┌───────────────────┬───────────────────┬───────────────────┐
        ▼                   ▼                   ▼                   ▼
  hub :3000           approval :3002      bambu :3001         ticket :3003
  项目管理机器人        审批机器人           打印预约机器人        工单机器人
  (对话/关键词/DDL)    (/approval-*)       (/print-*, legacy)  (/ticket-*, 接单)
```

### 消息事件路由（按顺序匹配，命中即停；未命中走默认目标 hub）

| 规则 | 目标 | 模式 |
| --- | --- | --- |
| 文本以 `/approval` 开头 | approval | command（解析指令 POST `/api/chat/command`，网关代为回复结果） |
| 文本以 `/print` 开头 | bambu | command |
| 文本以 `/ticket` 开头 | ticket | event（转发原始事件，机器人自行回复） |
| @机器人 且包含「接单」 | ticket | event（接单确认） |
| 其他所有消息（默认） | hub | event（对话 / 关键词 / DDL 确认 / 会议提醒） |

> 接单确认的完整语义是「在工单群内 @机器人（任意文本）」。网关默认规则只拦截「@ + 含接单」的消息直送 ticket-bot；其他 @ 消息走 hub。漏掉的接单不用担心——ticket-bot 每分钟对账自带「接单补录回扫」，会扫描工单群里的 @机器人 消息补录。若想让某个工单群的所有 @ 消息都直送 ticket-bot，在 `MESSAGE_ROUTES` 里加一条 `{"match":{"chatId":"oc_xxx"},"target":"ticket","mode":"event"}` 即可。

规则可用环境变量 `MESSAGE_ROUTES`（JSON 数组）整体覆盖，支持 `chatId` / `mention` / `prefix` / `contains` 四种匹配条件（同一规则内 AND 关系），例如把审批群整体划给 approval-bot：

```json
[{"match":{"chatId":"oc_xxx"},"target":"approval","mode":"event"},
 {"match":{"prefix":"/approval"},"target":"approval","mode":"command"}]
```

### 多维表格事件

广播给全部消费者（可用 `BITABLE_TARGETS` 收窄）。各机器人已有 table_id 过滤，互不干扰。对标记 `legacy` 的消费者（bambu），网关把 V2 `action_list` 事件拆成旧版 `bitable.record.create/update` 单记录事件并附上 `after_value` 字段，bambu 无需改代码即可恢复预约事件链路。

## 部署与切换步骤

1. **部署网关**（先部署网关，再切机器人，顺序不能反）：
   ```
   cd feishu-gateway
   npm install
   npm run deploy:sftp
   ```
   部署后验证：`curl http://10.253.33.233:3010/api/health`，`ws` 应为 `running`。

2. **切换各机器人**（改 `.env` 后 `pm2 restart`，各项目 deploy.js 模板已同步改为 false）：
   - project-management-robot：`FEISHU_USE_LONG_CONNECTION=false`
   - approval-bot：`FEISHU_USE_LONG_CONNECTION=false`
   - bambu-print-reservation：`FEISHU_USE_LONG_CONNECTION=false`
   - ticket-bot：`FEISHU_USE_LONG_CONNECTION=false`

3. **验证**：在群里 @机器人 发 `/help`，网关日志应出现 `[路由] 消息走默认目标 → hub`；改一条工单表记录，应在网关日志看到 bitable 广播到各机器人。

## 回滚

任意机器人把 `FEISHU_USE_LONG_CONNECTION` 改回 `true` 并重启即恢复旧模式（随机分发 + 轮询兜底）；停掉网关（`pm2 delete feishu-gateway`）则回到完全旧架构。两边可并存观察，但并存期间消息事件仍会被随机抢走，验证完尽快统一。

## 本地开发

```
npm install
copy .env.example .env   # 填入 APP_SECRET
npm run dev
```

未配凭证时网关只起 HTTP 服务，可用 `POST /api/dispatch` 手动投递模拟事件测试路由：

```
curl -X POST http://localhost:3010/api/dispatch -H "Content-Type: application/json" ^
  -d "{\"type\":\"im.message.receive_v1\",\"event\":{\"message\":{\"message_type\":\"text\",\"message_id\":\"test_1\",\"content\":\"{\\\"text\\\":\\\"/approval-list\\\"}\"}}}"
```

## 新增一个飞书机器人项目的步骤

1. 机器人本身：监听本机一个未占用端口，实现 `POST /api/feishu/event`（处理 `{header, event}` 标准回调结构），`.env` 设 `FEISHU_USE_LONG_CONNECTION=false`；
2. 网关 `CONSUMERS` 追加一行 `名称|http://localhost:端口/api/feishu/event`（需要指令模式再加指令 URL）；
3. 如需多维表格事件：机器人内按 table_id 过滤；如需消息事件：在 `MESSAGE_ROUTES` 加规则或走默认 hub。
