# LOGIC-MAP · zklink-attendance-bot

> 播报时机/静默行为有改动时必须同步本文件（顶层 AGENTS「晚间静默」要求）。

## 播报时刻表

| 任务 | 时刻 | 行为 |
| --- | --- | --- |
| 周播 | `ZK_ATT_BROADCAST_CRON`（默认周一 09:30 上海） | 统计上一完整周（发送日 00:00 往前 7 天）→ 值日群 webhook 周报卡 + 云文档留档 |
| 补发看门狗 | 每小时 5 分 | 已过本周发送时刻且水位落后 → 立即补跑（承担漏播重试与失败重试） |
| 失败告警 | 失败即时（同周一次） | 向 webhook 发红色告警卡；全挂则只落 state.lastError 供巡检 |

## 晚间静默闸门（02:00–09:00 上海，`QUIET_HOURS_*` 可配）

- 周播 cron 命中静默窗口 → **整轮跳过**，窗口后整点看门狗 tick 按最新状态补跑（可重扫型，无需积压落盘）；
- 看门狗补发、失败告警命中静默 → 同样跳过（人工 `/test-broadcast` 是当下主动触发，不受限）；
- 默认发送时刻 09:30 在窗外不受影响。

## 水位语义

- `lastSentWeekKey`：最近成功播报的周键（=该周周一日期）；**首启保护**：水位为空不自动补发（防部署即广播），等首个 cron 周期或手动触发；
- `delivery`：本周期分通道投递快照 `{feishu, archived}`——重试只补未完成通道，不重复轰炸已完成通道；
- 云文档留档未配置（无应用凭据或 doc token）→ `archived='skipped'`，不进重试循环（本地 `archive/` 兜底）；
- `weekOffset>0` 补看历史周成功也不回拨水位（防 watchdog 误判当周漏播重复轰炸）；
- 已知边界：云文档追加成功但响应丢失的极端场景，重试可能追加重复小节（概率极低，人肉删一次即可，不做文档内容级去重）。

## 数据流

1. **取数**：import 档从 state.imported（最近一次导入的全量明细）按窗口过滤；http 档经 zklink.js 拉窗口内记录（候选端点，probe 校准后为准）；
2. **聚合**：report.aggregateDuration 按人按上海挂钟日「末卡−首卡」，孤条不计时长；
3. **落盘**：exports/ 播报附件 CSV（warn-only）；archive/ 留档 JSON+CSV（warn-only）；
4. **留档**：云文档按周追加一节（heading2 周标题 → 口径/合计 → 本周汇总逐人 → 打卡明细逐条），wiki token 自动 get_node 换算并缓存；
5. **播报**：webhook 交互卡（有孤条/缺勤=orange，全勤=green）。

## 导入端点与并发

- `/api/attendance/import` 解析成功即**整包覆盖** `state.imported`（最近一次导入为准）+ 名单合并落盘；
- 播报运行中（running 锁）导入不受影响；runWeekly 保存水位用 merge-save（以磁盘最新 state 为底叠加），不会回滚并发导入。
