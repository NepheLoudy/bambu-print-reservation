# DEVLOG · zklink-attendance-bot

> 版本隔离单位 = 一次 `npm run push`（git 提交 + 部署）；最新条目在最下。本仓在顶层 monorepo 内（repo:top），版本锚点=顶层提交。

## v1 · 2026-10-07 · （哈希随本批顶层提交，待下批回填） · feat

**ZKLink 打卡周报机器人开仓**：每周自动统计打卡时长（按人按上海挂钟日「末卡−首卡」，孤条不计）→ 值日群飞书自定义机器人 webhook 播报周报卡（有孤条/缺勤 orange）→ 飞书云文档留档本周全部记录（曼波指定 wiki 节点 `cquqianli.feishu.cn/wiki/NFUS…`，代码自动 get_node 换算成 docx；本地 archive/ JSON+CSV 兜底）。

- 数据源双通道：`import`（默认，ZKLink 网页端考勤组维度导出上传，容错列匹配兼容「打卡时间」单列与「日期+时间」两列分列）/ `http`（ZKLink 接口直拉——平台是 qiankun 微前端壳 + OAuth Bearer 指纹，真实端点待凭据校准，`scripts/zklink-probe.js` 一键探测）；
- 定时周一 09:30 上海 + 每小时补发看门狗（首启保护；播报/留档独立水位，重试只补未完成通道）；晚间静默闸门全过（同 wecom 口径）；
- HTTP 仅回环 :3017：/api/health、/api/attendance/policy（定制窗口）、members 增删、import、preview、test-broadcast（写端点 X-API-Token fail-closed）；
- push.js 复制 wecom-attendance-bot 版（测试闸门 → 顶层 monorepo git → SFTP 直传小电脑 → pm2 `zklink-attendance`；members.json 备份+条数守卫）；
- 测试 8 套 147 断言全过；踩坑记录：①`toShanghaiMs` 初版漏 `v instanceof Date` 分支，Date 单元格整行被静默跳过（桩测试拦下，wecom 版同款分支补齐）；②Excel 序列号浮点往返有 ±1s 精度损失，断言给 ±2s 容差；③`node -e` 子进程相对 require 以 cwd 为基解析，必须传绝对路径；④多时间列（上下班分列统计模板）防呆报错挡下（wecom 2026-09-16 事故路径）；
- 待办：曼波侧补 ZKLink 账号、值日群 webhook、飞书应用凭据（docx+wiki 权限、加文档协作者）后跑 probe 校准 → 部署激活。
