# DEVLOG · wecom-attendance-bot（企业微信考勤周报机器人）

版本隔离单位：一次 `npm run push`（= 一次 git 提交 + 一次部署）。本项目无独立远端（repo:top 模式），push.js 只暂存 `wecom-attendance-bot/` 路径提交进顶层 monorepo——版本即顶层仓库中触碰本路径的提交。此后每次 push 在文末追加新版本（规则见顶层 [AGENTS.md](../AGENTS.md)）。

当前最新：**v1**（2026-09-15，随本提交落地）。

### v1 · 2026-09-15 · 随本提交落地 · feat
**项目诞生：企业微信考勤周报机器人——每周打卡数据聚合播报（markdown_v2 周报卡 + CSV 明细附件）**
- 功能：定时（默认周一 09:30 上海时间）拉企微打卡数据（`checkin/getcheckindata`，考勤机打卡已同步进企微）→ 按人聚合打卡天数/异常 → 负责人群群机器人 webhook 播报 markdown_v2 周报卡 + CSV 明细附件（替代手机手动导出）；
- 可靠性：每小时 5 分补发看门狗（漏播/失败自动补，水位 `lastSentWeekKey` 防重复）；拉数失败向同群发告警卡（webhook 不走可信 IP；60020 附可信 IP 处理提示，同一周只告警一次）；首启保护（水位为空不补发，避免部署即广播）；
- 窗口：`GET /api/attendance/policy` 全景只读、`POST /api/attendance/members` 名单增删（X-API-Token，照 gateway auth.js 模板 fail-closed）、`GET /api/attendance/preview` 干跑预览、`POST /api/attendance/test-broadcast` 真发/dryRun、`GET /api/health`；
- 部署：repo:top 模式同 feishu-gateway（无独立远端，SFTP 直传小电脑 `C:\qianli\opt\wecom-attendance-bot`，pm2 名 `wecom-attendance`，端口 3007）；`config/members.json` 不进 git，push 沿用 duty-bot 的备份+守卫（本地条目少于现网跳过上传，`PUSH_FORCE_PRIVATE=1` 强制）；
- 测试：四套桩 51 断言（窗口语义/聚合渲染/存储/企微纯函数）全过，push.js 内置部署前测试闸门；开发期修三处：weekWindow 双重时区转换（锚点已还原真实时刻又当挂钟用）、分批断言边界、nextSendTime 方向（向前看的天数差）；
- 踩坑：node-cron 3.x 不暴露 nextDates，下次执行时刻自算（`nextSendTime`，仅支持标准周播 cron 形态）；企微群机器人旧版 markdown 不支持表格，选用 markdown_v2（旧客户端退化纯文本，CSV 附件兜底）；
- 待办：管理后台建自建应用+打卡授权+可信 IP 后回填 `.env` 的 `WECOM_*` 三项与名单，`POST /api/attendance/test-broadcast` 真发验证；「缺卡判定」（对照打卡规则接口）留 v2。
