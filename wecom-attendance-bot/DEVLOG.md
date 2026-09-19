# DEVLOG · wecom-attendance-bot（企业微信考勤周报机器人）

版本隔离单位：一次 `npm run push`（= 一次 git 提交 + 一次部署）。本项目无独立远端（repo:top 模式），push.js 只暂存 `wecom-attendance-bot/` 路径提交进顶层 monorepo——版本即顶层仓库中触碰本路径的提交。此后每次 push 在文末追加新版本（规则见顶层 [AGENTS.md](../AGENTS.md)）。

当前最新：**v8**（2026-09-20，随本提交落地）。

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

### v3 · 2026-09-15 · 随本提交落地 · feat
**播报通道扩展：并入现有飞书体系（飞书群机器人 webhook 主通道 + 现有应用发 CSV）**
- 用户提供飞书负责人群自定义机器人 webhook（ee726bc4-…），应用改为「数据源在企微、播报在飞书（企微通道可选双发）」：新增 `src/feishu.js`——群 webhook 卡片（签名算法/错误码提示对齐 duty-bot webhook.js，经典 1.0 卡片，lark_md 不渲染表格改逐人一行）+ `pickChannels` 通道门控（至少配一个）+ CSV 经现有应用 im API 发文件（FEISHU_APP_ID/SECRET + FEISHU_CSV_CHAT_ID，未配仅落盘 exports，warn 不阻断）；
- 调度器改**每通道独立投递水位**（`state.delivery`，duty「重试只补失败群」模式）：重试只补未送达通道；CSV 附件独立水位尽力而为；失败告警向所有配置通道发（保留 v2 静默闸门与 manual 豁免；告警去重改 `alertedWeekKey`——v2 的 lastError 去重在 lastError 已前移到 runWeekly 记录后失效）；health/policy 增加通道布尔；
- 连通性已真发验证（测试卡 code:0 成功入群，该机器人无签名/关键词限制，FEISHU_WEBHOOK_SECRET 留空）；企微侧 WECOM_* 三键仍待用户建应用回填；
- 新增 stub-test-feishu（18 断言，签名/门控/卡片/截断/错误码），六套桩全过；修异常明细行日期重复（`day`+`time` 拼出「2026-09-08 09-08 09:41」，两渲染统一只用含日期的 `time`）与飞书空周报判定（按 totals.punches 而非 users.length）。

### v4 · 2026-09-15 · 随本提交落地 · fix

**R10/R13 收尾批**

- auth.js 废除 ?token= 查询串传参（R10②）：X-API-Token 头为唯一通道，防 token 进访问日志。
- push.js 重启步骤改 delete + 应用目录内 start（R13①）：pm2 进程首启的 cwd/环境快照会随 restart 永久保留（本服务首启曾挂在用户目录），delete 清快照、cd 应用目录修正 cwd。
- 注：本批部署因本机随用户离站（校园网，家庭 LAN 不可达）暂缓，代码已推 GitHub，回站后 npm run push 补部署。

### v5 · 2026-09-15 · 随本提交落地 · feat

**方案4：数据源改打卡报表人肉周导（可信IP门槛不可行的落地替代）**

- 企微自建应用配置可信 IP 被强制门槛拦截（须先有可信域名或接收消息回调 URL，均需公网可达——家里 NAT 形态无解，用户拍板走方案4）。凭据本身有效：gettoken 实测通过；打卡接口当前 48002 forbidden（from ip 正确），API 链路整体保留，`ATTENDANCE_DATA_SOURCE=api` 一键切回（届时只差可信IP 配置）。
- 新增 src/importService + POST /api/attendance/import（X-API-Token，body {dataBase64, filename}）：xlsx/csv 报表解析为 getcheckindata 同构记录流，表头模糊匹配（姓名/账号/打卡时间/类型/异常/地点/规则），时间统一按上海时区换算（字符串/Date/Excel 序列号三态）；解析即名单自动合并落盘（userid 取「账号」列，无则姓名兜底）——**名单不再需要手工维护**。
- runWeekly 增数据源分支：import 模式按播报窗口过滤已导入记录，窗口未覆盖时给出明确错误（09:30 cron 未导入时走失败告警，负责人群可见）；名单=名册∪导入衍生。
- 依赖新增 xlsx（SheetJS）；新增 stub-test-import 15 断言（列识别/时区三态/名单合并/窗口过滤/缺列报错/聚合兼容），七套桩全过。

### v6 · 2026-09-16 · 随本提交落地 · fix

**全量 debug 回归批：导入解析防呆两处**

- 识别到 ≥2 个时间列时直接报错（提示导「打卡记录明细」模板）：此前误传「打卡日报/统计」模板（上下班时间分列）会静默只取第一列时间，下班打卡整周丢失、全员假异常的周报无报错播进群。
- 有打卡时间但姓名与账号全空的行跳过（合并单元格导出的续行），防产生空名幽灵用户。

### v7 · 2026-09-17 · 顶层归档 cc97019 · fix

**全量 debug 批：导入崩溃修复 + 名册守卫盲区 + 九处审查修复（09-21 首播前收口）**

- importService 对 const 赋值崩溃修复：数据行「姓名空+账号非空」（xlsx 合并单元格续行形态）触发 TypeError 整单导入失败，改 let 并补桩回归（此前该分支零覆盖）。
- push.js 私有名册守卫盲区：本地缺 members.json 时 planPrivate/applyPrivate 直接跳过该文件，rm -rf 后远端名册无人恢复——照 duty-bot 同款改迭代完整清单：本地缺文件→备份+远端回填本地+跳过上传。
- CSV 落盘 exports 兑现：runWeekly 生成后写 `config.exportsDir`（此前四处文案承诺、实际无处可取）；失败仅 warn。
- 周播 cron 回调过 `inQuietHours()` 闸门（此前只有 watchdog 过闸，cron 改时刻会绕过晚间静默）。
- `/api/attendance/policy` 不再整包返回 `imported.records` 全量打卡明细（个人信息泄露面，改摘要；坏状态文件不再 500）。
- 导入覆盖天数 +8h 口径（上海 00:00–07:59 打卡此前少记一天，与 report.toWall 单源）。
- 企微侧四条 fetch（getToken/callQyapi/sendWebhook/upload_media）补 15s 超时（挂起占住 guardedRun 锁、后续轮次全跳过）。
- quietHours 解析器兼容纯小时数字与 HH:mm（与 duty-bot 同名键跨仓同值不再静默回落；越界/解析失败 warn 回落默认）。
- .env.example 补 ATTENDANCE_DATA_SOURCE（import 语义注释）与 QUIET_HOURS_* 三键。
- 测试：七套桩全过（import 18 项含新回归、quiethours 23 项含新格式断言）。
- 备注：头部指针此前滞留 v3（v4~v6 期间未同步），本批一并修正 v3→v7。

## v8 · 2026-09-20 · 随本提交落地 · fix

**全量 debug 批：飞书 API fetch 补 15s 超时 + 发送失败告警文案修正（09-21 首播前收尾）**

- `src/feishu.js` 的 `getTenantToken`/`feishuApi` fetch 此前无 AbortSignal——挂起会占住 guardedRun 锁拖死整轮任务（`wecom.js` 同批已补、此处漏）。补 15s 超时。当前 FEISHU_CSV_CHAT_ID 为空该路径未激活，属潜伏问题预防性修复。
- 发送失败告警文案「每小时自动重试，成功后补发本周报」与首启保护矛盾：首次成功前无水位、watchdog 不会自动重试（`catchupNeeded` 首启直接返回）。企微/飞书两处告警文案补「首次成功前无水位不自动补发，可 POST /api/attendance/test-broadcast 手动补」，避免首播失败时误以为会自动恢复。
- 测试：七套桩全过（npm test 链式全绿）。
