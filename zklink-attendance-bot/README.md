# zklink-attendance-bot

ZKLink 打卡周报机器人：**每周自动统计一次打卡时长 → 值日群飞书 webhook 播报周报卡 → 飞书云文档留档本次全部记录**（2026-10-07 曼波定需求）。

数据源是 ZKTeco 云考勤平台 **ZKLink**（`zklink.zktecoiot.com`，实验室考勤机上传，考勤组/规则已在平台侧配好）。不消费任何消息事件，不接飞书网关，纯定时任务 + webhook 出站。

## 每周链路

```
考勤机 → ZKLink 云（考勤组） → [每周一 09:30 上海] 统计打卡时长
  ├─ 值日群自定义机器人 webhook 播报周报卡（过晚间静默闸门）
  ├─ 飞书云文档追加本周留档（wiki 节点自动换算，汇总+全部记录逐条）
  └─ 本地 archive/ 落盘 JSON（全量）+ CSV（日明细）兜底
补发看门狗：每小时 5 分对表，漏播/失败自动补（播报与留档独立水位）
```

## 时长口径

按人按上海挂钟日聚合：单日 ≥2 条打卡记「末卡 − 首卡」为当日时长，恰 1 条记 0（标「孤条」），周合计。平台侧考勤组/班次只影响 ZKLink 自己的报表，不影响本口径；跨零点通宵按挂钟日切断。

## 数据源双通道（`ZKLINK_DATA_SOURCE`）

| 通道 | 说明 | 状态 |
| --- | --- | --- |
| `import`（默认） | ZKLink 网页端 → 考勤 → 打卡记录 按考勤组导出 xlsx/csv → `POST /api/attendance/import`（base64）上传。列名容错匹配，支持「打卡时间」单列与「日期+时间」两列分列两种形态 | ✅ 今天就能用 |
| `http` | ZKLink 接口直拉。平台是 qiankun 微前端壳（考勤模块 zkbio_att 动态挂载、OAuth Bearer 指纹），真实端点待凭据校准：`.env` 填 `ZKLINK_USERNAME/PASSWORD` → `node scripts/zklink-probe.js` → 按输出回填 `ZKLINK_LOGIN_PATH/ZKLINK_TRANSACTION_PATH` → 切 `ZKLINK_DATA_SOURCE=http` 再部署 | ⏳ 待凭据+校准 |

## HTTP 端点（仅 127.0.0.1 回环监听）

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/health` | 无 | 健康检查（运维台巡检） |
| GET | `/api/attendance/policy` | 无 | 定制窗口：数据源/考勤组/通道配置布尔/名单/水位全景只读 |
| POST | `/api/attendance/members` | X-API-Token | 播报名单增删 `{action: add/remove, userid, name}` |
| POST | `/api/attendance/import` | X-API-Token | 打卡明细导入 `{dataBase64, filename?}`，名单自动合并 |
| GET | `/api/attendance/preview?weekOffset=N` | 无 | 干跑预览（拉数渲染不发送，含云文档块数预览） |
| POST | `/api/attendance/test-broadcast` | X-API-Token | 手动播报+留档 `{dryRun?, weekOffset?}` |

写端点 fail-closed：未配 `ZK_ATT_API_TOKEN` 整体锁定。

## 云文档留档

`ARCHIVE_DOC_TOKEN` 兼容两种形态：**wiki 节点 token**（如 `https://cquqianli.feishu.cn/wiki/<token>` 的后段，代码经 wiki get_node API 自动换算出真实 docx，需应用有 `wiki:wiki:readonly` 权限）或 docx 文档 token 直填。需要：飞书应用开通 **docx 权限**（查看、编辑和管理云文档）+ 应用被加为目标文档的**协作者（可编辑）**。未配置时本地 `archive/` 目录兜底，卡片照发。

## 播报通道

值日群 → 设置 → 群机器人 → 添加自定义机器人，webhook URL 填 `FEISHU_WEBHOOK_URL`；机器人若开「签名校验」则填 `FEISHU_WEBHOOK_SECRET`。

## 测试（部署前自动过闸）

```
npm run test   # 8 套：window / duration / import / quiethours / feishu / archiver / zklink / store
```

## 部署

```
npm run push "提交说明"   # 测试闸门 → git（顶层 monorepo，只暂存本目录）→ SFTP 直传小电脑 → pm2 zklink-attendance
```

`.env` 原样上传部署目标；`config/members.json` 不进 git（备份+条数守卫，权威在部署目标侧）。

## 相邻项目

- `wecom-attendance-bot`：企业微信侧考勤（考勤机数据同步企微），与本仓（ZKLink 云侧）平行，勿混。
