# DEVLOG · qianli-netlog（实验室网络日志探针）

版本隔离单位：一次 `npm run push`（= 一次 git 提交 + 一次部署）。规则见顶层 [AGENTS.md](../AGENTS.md)「开发日志（DEVLOG）」节。

当前最新：**v1**（2026-09-27，随本提交落地）。

## v1 · 2026-09-27 · 随本提交落地 · feat

**开仓：superqianli 网络日志探针（用户需求：生产内网连不上时想知道主路由/出口的工作状态）**

- 提交说明：feat: netlog 开仓——superqianli/校园网出口连通性探针，断网事件落盘+恢复后飞书汇总补发
- **背景**：全家流量骑在主路由 superqianli（192.168.31.1）学生账号校园网会话上，被踢是常态（lab-network §四）；断网期间任何内网手段都看不到现场，本服务跑在生产机持续探测落盘。路由器本体 miwifi 固件装不了自定义工具，故取「内网侧外部视角」形态。
- **探测**：lan=主路由 192.168.31.1:80 TCP；wan=223.5.5.5/119.29.29.29:443 任一通（纯 IP 排除 DNS 因素）；egress IP=wan 恢复时+每 30min 心跳查（3322/ipify 轮试），变化记 `egress_ip_changed`（飞书 IP 白名单风险信号）。防抖：连续 2 次失败才记 down，一次成功即记 up（带历时）。
- **通知语义**：通知通道与被监控网络同生死，实时通知物理不可能——事件即时尝试推 webhook（与 approval-bot BOT_WEBHOOK_URL 同群），失败/未配置均入积压（backlog.json，上限 50），wan 恢复瞬间汇总成一张卡补发；启动时也尝试补发历史积压。补发按 id 精确剔除，冲刷期间新落盘不覆盖丢失（quiet-flush v87 同款教训回归断言）。
- **落盘**：`NETLOG_DATA_DIR`（部署目标 `C:/qianli/data/netlog`，项目外）下 `net-log.jsonl`（状态行+事件行+15min 心跳行，~100 行/天）+ `backlog.json`。
- **端点**：:3016 `GET /api/health`、`GET /api/netlog/summary`（只读，无写端点/无鉴权项；不收飞书事件不进 CONSUMERS，不违反架构铁律）。
- **部署**：push.js 复制 wecom 版精简（repo:top+SFTP 直传+测试闸门+pm2 delete+start+save）；pm2 名 `qianli-netlog`，save 后并入 `qianli-bots-autostart` resurrect 清单。**零 npm 依赖**（node 内置 http/https/net/fs），不重蹈 dayjs 事故。
- 测试：`scripts/stub-test-netlog.js` 14 断言全绿（防抖/恢复历时/积压补发/冲刷竞态/egress 变化/JSONL 结构）；本地真实冒烟通过（本机在校园网直连场景下正确记录 lan=false/wan=true，正是当下现场画像）。
