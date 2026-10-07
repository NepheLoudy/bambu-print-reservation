# zklink-attendance-bot · 项目边界声明

**职能**：ZKLink 打卡域（zklink.zktecoiot.com，ZKTeco 云考勤平台）——每周自动统计一次打卡时长，用值日群的飞书自定义机器人 webhook 播报周报卡，并在飞书云文档留档本次全部记录。

**架构定位**：
- 不消费任何消息事件（飞书/企微都不收），不进 feishu-gateway CONSUMERS，纯定时任务 + webhook 出站，不违反对话铁律；
- 播报主通道 = 值日群自定义机器人 webhook（与 duty-bot 看板卡同款链路）；定时播报过顶层「晚间静默」闸门；
- HTTP 仅回环 127.0.0.1 监听（运维台经 SSH 代理访问），LAN 拓扑探测恒 ✗ 属正常。

**数据源双通道**（ZKLINK_DATA_SOURCE）：
- `import`（默认）：ZKLink 网页端（Timecard → Clocking Records，考勤组维度）导出打卡明细 → `POST /api/attendance/import` 上传（base64），解析容错列匹配；
- `http`：ZKLink 接口直拉——平台是 qiankun 微前端壳（考勤模块 zkbio_att 动态挂载），真实登录/拉数端点需凭据到位后跑 `node scripts/zklink-probe.js` 校准回填 .env，未校准前切过去只会周周报错。

**时长口径**：按人按上海挂钟日聚合，单日 ≥2 条打卡记「末卡−首卡」，1 条=0（记孤条），周合计。平台侧考勤组/班次规则只影响 ZKLink 自己的报表，不影响本口径。

**部署**：`npm run push`（SFTP 直传小电脑 DESKTOP-FE1MIGI，pm2 `zklink-attendance` :3017，同 wecom-attendance-bot 模式）；`config/members.json` 不进 git，权威在部署目标侧（push 备份+守卫）。

**易混裁定**：企微侧考勤（考勤机数据同步企业微信）→ wecom-attendance-bot；本仓只管 ZKLink 云平台侧打卡。需求落在值日排班/轮岗本身 → duty-bot。
