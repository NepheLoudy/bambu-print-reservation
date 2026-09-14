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

### v2 · 2026-09-15 · b2ab98c · fix

**全项目深度审查修复批：部署路径/守卫时序/静默闸门/长度熔断**

- 部署目标 .env 四个路径键原为开发机路径（C:/Users/0d00/...），推送后状态/名册/导出全部落空——改指 C:/home/qianli/wecom-attendance-data 与部署机应用目录（本地与目标机同批修正，目标机已先期直改+重启验证）。
- push.js 私有配置守卫时序修复：原实现在 `rm -rf` 之后才读现网 members.json（永远 ENOENT），守卫+备份整体失效（2026-09-12 duty-bot 事故同款路径）。改为盘点（读现网→备份→判定种子是否过期）前置于代码目录替换；本地种子过期时跳过上传并把现网内容显式回写（rm 后恢复）。restart 步骤补 PATH 导出（小电脑非交互 shell 无 node/pm2）。
- 补发看门狗与失败告警接入晚间静默闸门（新增 src/utils/quietHours.js，02:00–09:00 可配）：窗口内整轮跳过，窗口后首个 tick 按最新状态补发/告警；人工 test-broadcast 不受限。
- markdown_v2 周报卡按 UTF-8 字节熔断（默认 3800）：名单几十人即触企微 4096 上限导致永久发送失败，超限截断成员表并提示看 CSV 附件；CSV 空兜底行补齐 10 列与表头对齐。
- /api/health 对名册/状态文件损坏免疫（membersError/stateError 字段），巡检端点不再被配置错误打挂。
- 新增 stub-test-quiethours（15 断言）+ report 熔断/列对齐断言，五套桩测试全过。
- 待办（需用户）：企微管理后台建应用后回填 WECOM_CORP_ID/SECRET/WEBHOOK_KEY（目标机与本地 .env 均空），并经 POST /api/attendance/members 回填负责人名单——当前 members=0，周一 09:30 首播前必须完成，否则按设计走失败告警（webhook 未配也发不出）。
