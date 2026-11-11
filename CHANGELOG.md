# Changelog

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.2.0] - 2026-11-11

针对「大部分时间都报抓取失败」做的一轮改造。根因是链路（GitHub 的机器连不上校园网），
但原来的沉默/告警策略让「没消息」和「挂了」在收件箱里无法区分，所以顺带把可观测性补齐。

### 新增

- **心跳邮件**：`email.heartbeat`，超过 N 小时没发过任何信就报一次平安（`N/M 个站点正常` + 各站上次成功时间）。
  发过汇总或告警也算报过平安，不会同一天收两封
- **告警降噪**：`email.error_alerts.after_consecutive_failures`，同一站点连续失败到阈值才发「抓取失败」，
  偶发抖动只写日志和 Job Summary；状态里新增 `failStreak`
- **站点并行**：`request.site_concurrency`，三个站点不再排队等超时（原来串行 3 × 4 次尝试 ≈ 5 分钟）
- `state.json` 新增 `meta`（`lastHeartbeatAt` / `lastMailAt`）与站点级 `failStreak`
- Job Summary 增加「连续失败」列，并说明本次告警是被抑制还是已发出

### 变更

- 重试退避加 **±30% 随机抖动**：多个站点同时重试时不再踩同一个节奏
- 默认单次超时 20s → 10s、重试 3 次 → 4 次：跨境握手失败时 20s 纯属白等
- 工作流 cron 改为**每 2 小时跑一次**（`0 */2 * * *`）。实测 GitHub 的 schedule 会整体延后 6~8 小时，
  按「每天 9/12/15 点」卡点是做不到的；靠频次而不是靠准点
- 删除工作流里「失败后等两分钟重试一次」的步骤：实测从未触发，重试已下沉到抓取层

### 测试

- 61 个单元测试（新增心跳/告警决策、站点状态行等 11 个）

## [0.1.1] - 2026-11-04

### 新增

- **Cookie 挑战自动处理**：站点返回「发 cookie 再跳回原页」的 403 时，自动保存 cookie 并重试一次（川大就业网就是这种，不需要代理）
- **抓取代理**：`site.proxy` / `FETCH_PROXY` / `--proxy`，解决“本地能抓、GitHub Actions 报 403”的机房 IP 拦截问题；附 Cloudflare Worker 实现（`examples/cloudflare-worker.js`）与 [docs/proxy.md](docs/proxy.md)
- GitHub Actions 失败时自动写 **Job Summary**，直接给出原因和修复步骤，不用翻日志
- 工作流增加 Secrets 预检查，缺哪个 Secret 直接点名

### 变更

- `actions/checkout`、`actions/setup-node` 升级到 v5，消除 Node 20 弃用警告
- runner 固定 `ubuntu-24.04`，CI 矩阵改为 Node 22 / 24
- 配置 Dependabot：月度分组升级，major 版本不自动提 PR

### 测试

- 单测从 38 增至 49，新增代理地址构造、GBK 解码、Cookie 挑战识别与重试、代理链路端到端

## [0.1.0] - 2026-11-06

首个可用版本。

### 新增

- 列表页解析：CSS 选择器提取标题 / 链接 / 日期，支持一个站点配多个列表页（`urls`）
- 关键词规则：`include`（任一命中）、`include_mode: all`（全部命中）、`exclude`、`regex`
- 正文匹配：`match_in: title+content`，可按需抓详情页
- 去重：链接规范化 + 站点内标题二次去重 + 状态持久化（默认保留 120 天）
- 邮件汇总：HTML + 纯文本双版本，命中词高亮，按站点分组，首次订阅附样例
- 失败告警：站点解析不到条目时发提醒邮件，避免静默失效
- 三个命令：`doctor`（体检）、`inspect`（选择器探测）、`demo`（离线演示）
- GitHub Actions：定时运行 + 状态回写，附 CI 工作流
- 38 个单元测试，覆盖匹配、日期、去重、解析、选择器探测、邮件渲染
- 配置样例：四川大学、复旦大学、武汉大学

### 已知限制

- 不支持 JS 渲染的页面（详情页正文常抓不到，标题级匹配不受影响）
- 不支持登录态页面（统一身份认证后的内网通知）
- 站点改版后需要重新 `inspect`
