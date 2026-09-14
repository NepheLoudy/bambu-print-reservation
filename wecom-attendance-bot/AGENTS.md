# wecom-attendance-bot · 项目边界声明

**职能（对号入座，发错会话立即提醒并停止开发）**：企业微信考勤域——在负责人群每周
播报一次考勤打卡数据（markdown_v2 周报卡 + CSV 明细附件）、打卡数据拉取与聚合、
成员名单窗口管理。关键词：考勤、打卡周报（企业微信侧）。

## 归属裁定

- **企业微信域**：本服务只与企业微信开放接口（`qyapi.weixin.qq.com`）和群机器人 webhook
  打交道，**与飞书无关**——不消费飞书消息事件、不接 feishu-gateway、不在网关登记路由、
  不受「对话铁律」「队员/功能统计上报」约束（那些规则的口径是飞书侧机器人）；
- 打卡数据口径：考勤机打卡已同步进企微「打卡」，本服务以企微打卡记录为单一数据源，
  不对接考勤机硬件；管理后台「打卡」应用的数据授权与可信 IP 是拉数前提（见 README）；
- 部署/运维归 qianli 顶层链路（`npm run push`，repo:top 模式同 feishu-gateway，
  部署目标=小电脑 DESKTOP-FE1MIGI）；`.env` 的 `NAS_*` 键为历史命名，语义=部署目标。

## 铁律与红线（本项目落地即遵守）

- **晚间静默**：单次周播（默认周一 09:30）天然在 02:00–09:00 窗口外，不引入积压机制；
  改 `ATTENDANCE_BROADCAST_CRON` 必须保持白天发送，新增定时播报点时先在顶层 AGENTS
  过静默闸门口径；
- **运行时数据保护**：`config/members.json` 权威在部署目标侧（运维台/窗口直写），
  push.js 已内置「先备份现网 + 本地条目少于现网即跳过并回填」守卫；状态文件与 CSV
  导出走 `ATTENDANCE_DATA_DIR`（部署目标上=项目外 `/home/qianli/wecom-attendance-data`）；
- **管理/写端点必须鉴权**：`POST /api/attendance/members`、`POST /api/attendance/test-broadcast`
  挂 X-API-Token（模板=feishu-gateway/src/auth.js）；只读 GET 与 /api/health 不受限；
- **行为改动必须过桩测试**：push 前跑 `npm run test`（四套桩），push.js 有测试闸门；
- 权能/端口/窗口变动同批更新 `dashboard/registry.js`（单一事实来源）与本 README。
