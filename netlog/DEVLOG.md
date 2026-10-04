# DEVLOG · qianli-netlog（实验室网络日志探针）

版本隔离单位：一次 `npm run push`（= 一次 git 提交 + 一次部署）。规则见顶层 [AGENTS.md](../AGENTS.md)「开发日志（DEVLOG）」节。

当前最新：**v8**（2026-10-04，随本提交落地，复活通知滞留根治批；v7 为 open_id 定稿补记）。上一版 v6（2026-09-28，机器人本体私聊通知）。上一版 v5（刷屏事故根治批）。上一版 v4（实测反馈批）。上一版 v3（账号池路径校准修复）。上一版 v2（复活引擎）。上一版 v1（探针开仓）。

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

## v2 · 2026-09-27 · 随本提交落地 · feat

**断网复活引擎：账号池(31108753 首选项) × Dr.COM eportal × 自适应慢速探针 × 月度弃用（曼波三项设计全落地）**

- **「网关实现途径」考古**（本轮关键侦查，详见 lab-network skill §十二）：主路由 WAN=纯 DHCP，自愈靠 Dr.COM MAC 无感知认证；重连真身=4A 时代 `ping.sh`（归档 `qianli-backups/4a-root-ping-archive-20260920.tar.gz`，内含 20230104/20243199 两账号——即曼波所说"存两个现有账号的地方"）；协议实锤 `http://10.10.8.162:801/eportal/portal/`（801=API 端口，登录页在 80/443），`online_list` 实测 200 返回主路由会话详情（IP/MAC/账号 20230104）。
- **src/campusAuth.js**：eportal 协议层（onlineList/login/fetchAuthIp/logout），账号格式 `,0,学号`、密码明文参数、wlan_user_ip 动态取认证页回显（=主路由 WAN IP）；成败以 onlineList/wan 真恢复裁决，不轻信响应文案。
- **src/accountPool.js**：策略池（preferred 首选项永远先试 → priority 轮换；bannedThisMonth 当月弃用自然月自动失效；tmp+rename 原子写回）。池文件 7 账号：曼波新给 5 个（31108753 首选项）+ ping.sh 归档 2 个兜底；工作区根 `campus-accounts.local.json` 为主副本（**/*.local.json 已 gitignore）。
- **src/wanGuard.js**：复活状态机（每 tick 一账号、wan 真恢复算成功、用尽→通知+30min 冷却）+ 慢速判定（恢复后 20s 宽限、3 次探针中位数 > 基线×3 → ban + 自动换号）+ forceRevive（手动实测通道）。基线=健康期滑动 20 样本中位数（下限 30ms）。
- **端点**：`POST /api/netlog/revive`（X-API-Token，timingSafeEqual + fail-closed，未配置=锁定——管理端点鉴权铁律）；summary 增 `guard` 字段。
- **push.js**：账号池上传带备份+条数守卫（权威在部署目标侧时跳过+回填，PUSH_FORCE_PRIVATE 才覆盖）。
- 测试：新增 `stub-test-wanguard.js` 18 断言（首选项优先/换号/慢速 ban/宽限/冷却/lan 断不复活/手动触发），test 链=两套 32 断言全绿。
- 部署后验证：guard 就位、revive 端点无 token 403 fail-closed ✓；真实登录未主动触发（网络健康时不无谓换绑主路由认证），等首次真断网实战或曼波手动按键。

## v3 · 2026-09-27 · 随本提交落地 · fix

**账号池路径校准——本地调试路径上线导致引擎读空池（手动触发实测抓到）**

- 曼波要求实测复活链路，forceRevive 首触发即报 `revive_no_candidates`：push.js 全量覆盖 .env 时把本地 `.env` 的调试路径（`C:/Users/0d00/Desktop/qianli/campus-accounts.local.json`）带了上线，小电脑无此文件 → loadPool 静默空池。
- 修：push.js 上传 .env 后强制 sed 改写目标侧 `NETLOG_ACCOUNT_POOL=C:/qianli/data/netlog/campus-accounts.local.json`（本地调试路径永不上线，目标/本地各得其所）。
- 教训：**部署后验证必须验「池非空」**，guard 就位≠池子就位；push 全量覆盖 .env 的模式对「本机各异路径」类配置天然不安全，此类键一律 push 时校准。

## v4 · 2026-09-27 · 随本提交落地 · fix

**实测反馈批：动作日志带 eportal 响应 msg + summary 队列残留清理**

- forceRevive 二次实测全链路通过：首选项 31108753 先试 → login（authIp=10.253.32.177）→ 44s wan 判定恢复 → 慢速判定运行（探针中位 17ms ≤ 基线 30ms×3，通过不 ban）。
- **实测新知**：eportal 对已在线 IP 返回 `ret_code:2 "IP 已经在线！"` 拒绝二次认证——同 IP 换账号登录在在线状态不可行（断网场景无此门槛）；`wlan_user_ip` 参数不改变判定（按来源 IP）；账号密码正确性仅离线可验，留待真断网实战。
- 修：wanGuard 动作日志记录 login 响应 msg（诊断价值高，如「已经在线」vs「密码错误」一眼可辨）；summary 的 queueRemaining 仅复活态展示（判定通过后不再残留旧队列）。

## v5 · 2026-09-28 · 随本提交落地 · fix

**财务群刷屏事故根治：事件分级 + 空池冷却 + 通知静音（曼波报告批）**

- **事故**：曼波发现财务群被 `[netlog] revive_no_candidates（wan 断且 lan 正常）` 持续刷屏。全量审计对质（日志 0 断采样/0 ban/积压空/事件仅 3 条实测）证明**生产机清白**——真凶=本地开发残留进程（09-27 22:45 本地验证时 kill %1 未杀到 node 子进程，PID 36720 活了一夜），跟着曼波笔记本的「31.1 可达+公网探测不通」状态每分钟触发空池复活，用本地 .env 复制的财务群 webhook 轰炸。
- **根治三连**：①事件分级——`NOTIFY_IMMEDIATE` 白名单（lan/wan 断通、出口 IP 变化、revive_exhausted）才尝试即时外发，过程事件（revive_start/success/no_candidates/account_throttled）只落盘+进积压（断网恢复后由汇总卡带上，平时零打扰）；②空池冷却——`revive_no_candidates` 触发与 exhausted 同款 30 分钟冷却，不再每 tick 重发；③webhook 全线静音——本地 .env 与部署目标侧 NETLOG_WEBHOOK_URL 均置空（财务群不该收 netlog 消息；等曼波指定通知群后再配）。本地残留进程已处决（PID 36720）。
- 测试：新增事件分级回归断言（过程事件 process-event 标记积压不外发/关键事件积压语义），两套 35 断言全绿。
- 教训：①bash 后台 job 的 `kill %1` 不可靠（node 子进程可能脱离 job 表），本地跑服务类进程后必须 `tasklist/netstat` 复核；②本地 .env 与生产共键的 webhook 类配置，本地调试前先置空；③「一直在播报」类报告先做数据对质再定责——本案生产机三方证据（日志/积压/ban 记录）全部清白。

## v6 · 2026-09-28 · 随本提交落地 · feat

**通知出口切换：不用 webhook，机器人本体私聊直发（曼波拍板）**

- **src/feishu.js**：共用应用（对话型「爆米花机-对话型」同款应用）tenant_access_token 获取+内存缓存（提前 5min 刷新）+ IM API 私聊文本（`receive_id_type=open_id`）。性质=机器人主动播报（同 ticket-bot 私聊结单提醒先例），不消费消息事件，不违反对话铁律。webhook 通道整体移除（sendWebhook/CONFIG.webhookUrl 删除）。
- **sendNotify 多目标分派**：NETLOG_NOTIFY_OPEN_IDS（逗号分隔多 open_id）逐个私聊，Promise.allSettled——任一成功即送达（部分失败记 warn），全失败抛错进积压（恢复后汇总补发）。事件分级（v5）不变：过程事件只落盘+积压，关键事件（断/通/IP 变化/exhausted）即时私聊。
- 配置：`NETLOG_FEISHU_APP_ID/SECRET`（共用应用凭据，approval-bot 同源）+ `NETLOG_NOTIFY_OPEN_IDS`（当前=审批域两个候选 open_id，等曼波确认哪个是他本人后收敛）。
- 测试：feishu 桩（require.cache 替换 + __dmFail 失败开关）——私聊失败积压/恢复汇总补发经私聊/冲刷期间新落盘不丢/过程事件不外发，两套 35 断言全绿。踩坑记录：bash heredoc 的 `
` 多层转义会被折叠成真实换行（agent-ops-gotchas 的 chr() 教训再次应验）。
- 实测：两个候选 open_id 各发一条通道测试私聊，均发送成功（飞书 API 200）；等曼波确认收件情况后收敛 open_id 列表。


## v7 · 2026-09-28 · `8a96b72`（顶层 v123 联动记账）· chore

**通知 open_id 收敛定稿：曼波本人（A/B 实测闭环）**

- v6 向两个候选 open_id 各发通道测试私聊后，曼波确认本人收件：`NETLOG_NOTIFY_OPEN_IDS` 收敛为 `ou_249993fe…`（曼波本人；另一候选 `ou_54493ce1…` 为催办兜底人配置位，非本人，重号调正）。纯 `.env` 变更（不入库），随顶层 v123 提交记账，本条目为 DEVLOG 补记——闭环 v6 文末「等曼波确认后收敛」。
- 通知链路行为无变化（私聊多目标分派，配置剩一个目标照样跑）；无代码改动。

## v8 · 2026-10-04 · 随本提交落地 · fix

**复活通知积压滞留根治 + DownSince 清零（10-03/10-04 两起实况复盘批）**

- 实况复盘（曼波问「网关状态播报是探知有问题还是真的有问题」）：10-03 目标机白天断电停机约 10h（RTC 停在 09-30，16:22 NTP 校时跳变 3.4 天——断电窗口 netlog 同机同命无记录，属「通知与被监控网络同生死」设计固有盲区；校时跳变另在 approval-bot 侧诱发 qrcode crash 风暴，见其 v67）；10-04 凌晨 02:29–07:02 多轮 lan+wan 同时失败为**真断**（机器活着在记录，路径级故障）；20:21 wan 认证掉线为**真断**，复活引擎 55s 自愈（第二次实战胜，首选项一发命中）。
- **Bug① 复活通知滞留**：复活引擎用当轮原始信号触发（有意抢在 2 轮防抖前自愈），短暂断网常不产生状态机 down→up 翻转 → flushBacklog 只认翻转触发，revive_start/success 通知卡永远滞留积压（20:21 实况：自愈成功但复活通知未达，backlog 挂着 2 条 process-event）。修正：**wanOk 每轮尝试冲刷**（空积压零成本），部署后首个 tick 自动补发历史滞留；「原始信号 vs 防抖态」语义在 index.js/wanGuard 注释对齐成文（原注释误写「防抖后语义」）。
- **Bug② DownSince 不清零**：恢复后 summary 的 lanDownSince/wanDownSince 仍挂旧断开时刻。修正：flip up 时清零。
- 测试：stub 22+18=40 断言全绿；新增 复活自愈冲刷三断言 + DownSince 清零断言。README 冲刷时机成文。
- 随批并入 v7 遗留未提交改动（.env.example 移除废弃 NETLOG_WEBHOOK_URL、index.js 文案）；push.js 新增部署后健康检查（approval-bot v67 同款）。
