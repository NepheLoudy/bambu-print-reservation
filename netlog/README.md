# qianli-netlog · 实验室网络日志探针

> 2026-09-27 v1 上线（用户需求：「给 superqianli 系统做个网络日志，生产内网连不上时想知道它的工作状态」）。

## 定位与边界

**superqianli = 主路由 192.168.31.1（RD08）**，全家唯一校园网出口（学生账号认证会话，qianli-lab-network skill §一/§四）。路由器本体是 miwifi 固件，装不了自定义日志工具，且断网时路由器自身日志也取不出来——所以本服务跑在**生产机（小电脑 DESKTOP-FE1MIGI）**上，从内网侧持续探测「superqianli 活着没 + 校园网出口活着没」，落盘记录，恢复后把断网期间的事件汇总补发到飞书群。**通知通道与被监控网络同生死：实时通知物理上不可能，「落盘 + 恢复补报」是唯一正确语义**（断网一结束、wan 一通，汇总卡即达）。

本服务不是飞书机器人：不收事件、不进网关 CONSUMERS、无长连接（不违反架构铁律）；无写端点（两个只读 GET，不涉管理端点鉴权规则）。

## 探测项

| 项 | 目标 | 判定 | 含义 |
| --- | --- | --- | --- |
| lan | 主路由 `192.168.31.1:80` TCP | 通/不通 | 路由器与内网活着没 |
| wan | `223.5.5.5:443` / `119.29.29.29:443` 任一通 | 通/不通 | 校园网认证会话活着没（用 IP 不用域名，排除 DNS 因素） |
| egress IP | 3322/ipify 等回显源轮试 | IP 文本 | 校园网会话重连后出口 IP 变化 → 飞书 IP 白名单风险信号（lab-network §四） |

- **防抖**：连续 `NETLOG_FAIL_THRESHOLD`（默认 2，即 2 分钟）次失败才记 `*_down`；一次成功即记 `*_up`（带断开历时）。单次抖动不刷屏。
- **出口 IP 限频**：wan 刚恢复时 + 每 30 分钟心跳时才查（多候选源轮试，失败不阻塞）。

## 事件与通知

- 事件：`lan_down` / `lan_up` / `wan_down` / `wan_up` / `egress_ip_changed`；
- 每个事件即时尝试推飞书 webhook（`NETLOG_WEBHOOK_URL`）——**断网时必然推不出去，自动入积压**（`backlog.json`，上限 50 条丢最旧）；wan 恢复瞬间把积压**汇总成一张卡**补发（哪断的、断了几段、各多久，一眼看完）；
- webhook 未配置时事件同样入积压，配置补上并重启后由启动补发送达；
- 补发按条目 id 精确剔除已发——冲刷期间新落盘的积压不被覆盖丢失（quiet-flush v87 同款教训回归，stub 有断言）。

## 数据落盘

- 默认 `~/qianli-data/netlog/`（部署目标 .env 显式配 `NETLOG_DATA_DIR=C:/qianli/data/netlog`），**项目外**，重部署不丢；
- `net-log.jsonl`：状态行（每轮）+ 事件行（状态变化必记 + 15 分钟心跳行防纯空白），~100 行/天，不做轮转；
- `backlog.json`：待补发通知积压。

## 查询端点（GET，只读）

```
curl localhost:3016/api/health          # {ok, lan, wan, egressIp, uptime}
curl localhost:3016/api/netlog/summary  # 当前状态 + 最近 50 条事件（内网可达时人工查现场用）
```

## 配置（.env，见 .env.example）

探测参数默认即可；`NETLOG_WEBHOOK_URL` 当前与 approval-bot `BOT_WEBHOOK_URL` 同群（审批播报群），要换群改这里重推；`NAS_*` 为部署凭证（历史命名，语义=部署目标）。

## 部署

```bash
npm run push "提交说明"   # 测试闸门 → git(顶层 monorepo netlog/ 路径) → SFTP → .env → pm2 delete+start+save
```

pm2 名 `qianli-netlog`，`pm2 save` 后并入小电脑 `qianli-bots-autostart`（pm2 resurrect）自启清单。端口 3016（只收出站探测 + 本机回环 HTTP，不开防火墙——如需从笔记本跨机访问 summary，需在部署目标防火墙放行 3016，属人工操作）。

## 测试

```bash
node scripts/stub-test-netlog.js   # 14 断言：防抖/恢复历时/积压补发/冲刷竞态回归/egress 变化/JSONL 结构
```

## 已知限制

- 断网根因若为**生产机自身断电/系统挂**，探针同死——物理上无解，靠 pm2 resurrect + 路由器侧排查兜底；
- lan 断而 wan 未断的组合（路由器半死）理论上可能：探测独立并行，各自如实记录；
- egress 回显源全挂时该轮跳过（不误报 IP 变化）。
