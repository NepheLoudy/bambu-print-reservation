# wecom-attendance-bot · 企业微信考勤周报机器人

在负责人群（企业微信群机器人 webhook）**每周播报一次考勤打卡数据**：markdown_v2 周报卡
（每人打卡天数/记录数/异常数 + 异常明细）+ CSV 明细附件（替代手机手动导出）。
数据源为企业微信「打卡」记录（考勤机打卡已同步进企微），全程不触碰考勤机本身。

## 架构位置（与飞书项目群的关系）

- **企业微信域项目**：不消费任何飞书消息事件、不接 feishu-gateway、不受对话铁律约束；
  纯定时任务 + 被动 HTTP 窗口（出站调企微 API/webhook）；
- 部署链路与飞书五仓共用：`npm run push` 一条命令（git 进顶层 monorepo + SFTP 直传
  小电脑 DESKTOP-FE1MIGI + pm2 重启），模式同 feishu-gateway（repo:top，无独立远端）；
- 定制配置窗口化（顶层 AGENTS「机器人后端定制窗口」）：`GET /api/attendance/policy`
  全景只读、`POST /api/attendance/members` 名单增删（X-API-Token）。

## 数据链路

```
考勤机 ──(已打通)──> 企业微信打卡记录（云端）
                          │
       每周一 09:30（Asia/Shanghai，可配 cron）
       1. gettoken（缓存，失效自动重取）
       2. checkin/getcheckindata 拉上一完整周（周一00:00 ~ 周一00:00）
       3. 按人聚合（打卡天数/异常；异常判定直接用企微返回的 exception_type）
       4. webhook/upload_media 传 CSV → webhook/send 发 markdown_v2 周报卡
                          │
                          v
                    负责人群（群机器人）
```

接口约束（官方文档 94205 / 91770）：拉数跨度 ≤30 天（一周绰绰有余）、单批 userid ≤100
（自动分批）、600 次/分；webhook 20 条/分；upload_media 的 media_id 3 天有效（发完即弃）。

## 可靠性口径

- **补发看门狗**：每小时 5 分对表——已过发送时刻而水位（`lastSentWeekKey`）没跟上
  （发送时段进程不在线）立即补发；失败重试复用同一机制（失败不改水位，下个整点自动再试）；
- **失败告警**：拉数失败时向同一负责人群发失败卡（webhook 不走可信 IP 校验，一定发得出去），
  同一周只告警一次；60020（可信 IP 失效）附处理提示；
- **首启保护**：水位为空（从未成功播报）不补发，避免部署即广播；
- **静默口径**：单次周播，默认发送时刻 09:30 落在晚间静默窗口（02:00–09:00）之外，
  不引入积压机制；改 `ATTENDANCE_BROADCAST_CRON` 时请保持白天发送。

## 企微侧一次性配置（管理后台 work.weixin.qq.com）

1. 负责人群 → 添加群机器人 → 复制 webhook 的 `key`；
2. 应用管理 → 自建 → 创建应用（如「考勤播报」）→ 记下 `corpid`（我的企业→企业信息）与 Secret；
3. 管理后台「打卡」应用 → **可调用接口的应用** → 勾选该自建应用（拉打卡数据的前提，
   2023-12 起系统应用 secret 不能用，必须走此授权）；
4. 自建应用详情 → 开发者接口 → **可信IP** → 填部署目标出口公网 IP
   （家宽 IP 变动后要回来更新，否则拉数报 60020——webhook 播报不受影响）；
5. 成员加入应用可见范围。

## 成员名单（播报范围）

`config/members.json`（**不进 git**，权威在部署目标侧，push 有备份+守卫，
见顶层 AGENTS「运行时数据保护」）：

```json
{ "members": [ { "userid": "企微通讯录账号", "name": "显示名" } ] }
```

- userid 从企微管理后台「通讯录→成员详情→账号」取；名单外的人不在拉数范围；
- 运行时增删走窗口（即时生效、不重启）：`POST /api/attendance/members`
  `{"action":"add|remove","userid":"...","name":"..."}`（X-API-Token 头）。

## HTTP 窗口（127.0.0.1:3007）

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| GET | /api/health | 无 | 健康检查 + 配置布尔 + 水位/最近错误 |
| GET | /api/attendance/policy | 无 | 定制全景：播报参数/企微配置布尔/名单/状态 |
| GET | /api/attendance/preview?weekOffset=N | 无 | 拉数并渲染周报（markdown/CSV 预览），不发送 |
| POST | /api/attendance/members | X-API-Token | 名单增删（即时生效） |
| POST | /api/attendance/test-broadcast | X-API-Token | 真实播报；body 可带 `{"weekOffset":0,"dryRun":true}` |

写端点鉴权照 feishu-gateway/src/auth.js 模板（timingSafeEqual + fail-closed：
未配置 `ATTENDANCE_API_TOKEN` = 写端点整体锁定），值与全工作区共享 token 同值。

## 播报内容样例

```markdown
## 📋 考勤周报（2026-09-07 ~ 2026-09-13）
> 打卡 **86** 条 · 异常 **2** 条 · 涉及 12 人（有打卡 11 人）

| 成员 | 打卡天数 | 记录数 | 异常 |
| --- | --- | --- | --- |
| 张三 | 5 | 10 | 1 |

### ⚠ 异常明细
> 张三 09-08 09:41 **时间异常**（默认规则）

> 数据来自企业微信打卡接口 · 打卡明细见附件 CSV
```

注意：企微群机器人旧版 markdown 不支持表格，本服务用 `markdown_v2`（表格可用；
4.1.36/安卓 4.1.38 以下旧客户端会退化为纯文本——明细始终有 CSV 附件兜底）。

## 配置（.env，模板见 .env.example）

服务：`PORT`；企微：`WECOM_CORP_ID` / `WECOM_ATTENDANCE_SECRET` / `WECOM_WEBHOOK_KEY`；
播报：`ATTENDANCE_BROADCAST_CRON`（默认 `30 9 * * 1`）/ `ATTENDANCE_TIMEZONE`；
鉴权：`ATTENDANCE_API_TOKEN`；运行时数据：`ATTENDANCE_DATA_DIR`（部署目标上指向
项目外 `/home/qianli/wecom-attendance-data`，状态/CSV/备份都在那，push 覆盖代码不影响）；
部署：`NAS_HOST/NAS_PORT/NAS_USER/NAS_PASSWORD`（历史命名，语义=部署目标）。

## 测试（部署前闸门强制跑，SKIP_TESTS=1 可跳）

```bash
npm run test            # 全部：window / report / store / wecom 四套桩
npm run test:window     # 周窗口语义：锚定日/跨月/跨年/发送时刻/下次发送
npm run test:report     # 聚合/异常拆分/markdown 表格转义/CSV BOM 与转义
npm run test:store      # 名单增删校验/持久化/水位读写
npm run test:wecom      # userid 分批(≤100)/错误码提示/无配置安全
```

本地起服务：`npm start` → http://127.0.0.1:3007/api/health

## 部署

```bash
npm run push "feat: 说明"   # 测试闸门 → git 进顶层仓 → SFTP 传小电脑 → pm2 重启+save
```

部署后验证：`pm2 ls` online；`curl 127.0.0.1:3007/api/health`；名单加人后
`GET /api/attendance/preview` 出数（需先回填企微凭据）；首次真发用
`POST /api/attendance/test-broadcast`。

## 已知限制 / 后续

- 「缺卡/未打卡」判定需要打卡规则（`checkin/getcheckinoption`）对照班次，v1 未做——
  当前只播实际打卡记录与企微判好的记录级异常（时间/地点/WiFi/设备异常）；
- 拉数依赖可信 IP，家宽出口 IP 变动需人工更新管理后台配置（60020 告警会提示）；
- 名单为显式配置（企微通讯录 API 需要额外授权范围，v1 不引入）。
