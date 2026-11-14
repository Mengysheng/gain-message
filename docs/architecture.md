# 项目全解：notice-radar 是怎么做的、别人怎么用

> 这份文档写给两种人：想读懂这个项目每个零件的人，和想拿它去监控**自己学校**的人。
> 如果你是后者，直接跳到 [第 7 节：别人要用，改哪里](#7-别人要用改哪里)。

---

## 1. 它解决什么问题

学校的推免、夏令营、交换项目、实习岗位，通常只挂在一个**没有 RSS、没有 API、还会改版**的通知栏里，
报名窗口可能只有三天。你需要的是「有新东西且和我有关时才通知我」。

通用网页监控（changedetection.io / Distill / Visualping）解决的是「页面变了就通知」，放到通知栏上有三个坑：

1. 访问量、轮播图、时间戳一动就告警，噪音淹没真正的通知；
2. 同一条通告同时出现在首页、列表页、详情页，会推三遍；
3. 不区分新旧，也没法只推关键词相关的那几条。

所以这个项目的做法是**按条目（entry）处理**，而不是按页面差异：

```
抓列表页 → 解析出每一条（标题/链接/日期）→ 链接规范化 + 标题二次去重
        → 关键词匹配 → 只保留「没推过的命中条目」→ 邮件汇总 → 落状态
```

一句话：**它维护一份「哪些条目已经见过」的账本，只在账本里没记过、且命中关键词时才打扰你。**

---

## 2. 整体架构

```
                        ┌──────────────────────────────┐
   config.yaml ───────▶ │ config.js  合并默认值+校验    │
   (站点/关键词/邮箱)    └──────────────┬───────────────┘
                                       │
                        ┌──────────────▼───────────────┐
                        │ cli.js  cmdRun  主流程         │
                        └───┬───────────┬───────────┬──┘
                            │           │           │
              ┌─────────────▼──┐  ┌─────▼──────┐  ┌─▼──────────────┐
              │ fetch.js       │  │ parse.js   │  │ store.js       │
              │ 抓页面/重试/编码 │  │ DOM→条目    │  │ 去重账本        │
              └────────┬───────┘  └─────┬──────┘  └────────────────┘
                       │                │
              ┌────────▼───────┐  ┌─────▼──────┐
              │ match.js       │  │ mail.js    │
              │ 关键词规则      │  │ 渲染+发信   │
              └────────────────┘  └─────┬──────┘
                                        │
                              ┌─────────▼─────────┐
                              │ export.js  Markdown│
                              └───────────────────┘
```

**没有任何服务端**：要么跑在 GitHub Actions，要么跑在你自己的机器上（Windows 计划任务 / cron / Docker）。
所有状态就是一个 `state/state.json` 文件。

### 目录结构

```
config.yaml                你的配置（站点 + 关键词 + 邮件）
config.example.yaml        配置模板（换学校时复制这个）
src/
  cli.js        771 行   命令入口、主流程、发信决策（decideMail）
  fetch.js      212 行   抓取：编码识别、Cookie 挑战、代理、重试退避、错误翻译
  parse.js       76 行   HTML → [{title,url,date}]，以及详情页正文
  match.js       83 行   关键词规则编译与匹配、命中高亮
  store.js       79 行   去重账本：读/写/标记已见/失败计数
  mail.js       278 行   邮件 HTML+纯文本渲染、心跳、SMTP 发送
  export.js      55 行   Markdown 汇总（out/latest.md + 归档）
  inspect.js    154 行   自动探测「列表页的选择器该写什么」
  config.js     106 行   配置合并、环境变量注入、启动校验
  util.js       124 行   URL 规范化、日期抽取、文本清洗、日志
scripts/
  run-local.ps1          本地跑一轮（加载 .env、等网络、写日志）
  install-boot-task.ps1  注册/卸载 Windows 计划任务
tools/
  run-history.mjs        读 state 提交历史，复盘每次运行哪个站成功
test/                    65 个单元测试（node:test，不联网）
examples/                复旦/武大/川大的现成配置 + 演示数据
docs/                    部署、选择器、代理、发布、以及本文
```

---

## 3. 每个模块在做什么

### 3.1 `util.js` — 洗干净数据

| 函数 | 作用 | 为什么需要 |
|---|---|---|
| `canonicalUrl` | 去掉 `#锚点`、`utm_*`/`spm`/`from`/`share`/`_t`/`t` 等跟踪参数，query 排序，去尾部 `/` | 同一条通告在首页/列表页/详情页的链接往往不同，不规范就会重复推 |
| `normalizeText` | 合并空白、去零宽字符、`&nbsp;` 还原 | 学校 CMS 输出的空白字符一塌糊涂 |
| `normalizeForMatch` | 小写 + 全角转半角 | 让「实习」和「实习」、`ABC` 和 `ａｂｃ` 都能匹配 |
| `parseDate` | 从任意文本抽 `YYYY-MM-DD`：`2026-10-28` / `2026年10月28日` / `20261028` / `10-28` / `3天前` / `昨天` | 有的栏目把日期和标题拌在同一个 `<li>` 里 |
| `formatDateTime` | 按 `Asia/Shanghai` 格式化 | 服务器是 UTC，邮件里要写北京时间 |

### 3.2 `fetch.js` — 抓取（这个项目一半的坑在这儿）

`fetchPage(url, {timeout, retries, charset, proxy, headers})` 的返回是 `{html, status, finalUrl, charset, fetchedVia}`。

**编码识别**（国内学校站大量是 GBK）：
1. 先看 `Content-Type: text/html; charset=gb2312`
2. 没有再扫 HTML 前 4KB 的 `<meta charset>`（用 latin1 读，避免先按 UTF-8 解成乱码）
3. 都没有就当 UTF-8
4. `gb2312`/`gb18030`/`x-gbk` 统一映射到 `iconv-lite` 认识的编码名

**Cookie 挑战**：不少国内公告站会先返回 `403 + 极短 HTML + window.location.href + Set-Cookie`，
浏览器会自动跳回去。脚本这边用 `isCookieChallenge()` 识别（状态码 403/412/202 + 页面 < 2000 字节 + 含 `window.location=` 或 `document.cookie`），
存下 cookie 后立刻重放一次。每个域名一个简易 cookie 罐。

**代理**：`buildRequestUrl(url, proxy)`，模板里用 `{url}` 占位，值会被 `encodeURIComponent`。
最终 `finalUrl` 仍返回**原始地址**，这样页面里的相对链接还能正确补全（这是走代理最容易踩的坑）。

**重试**：`retryDelay(attempt)` = 1.5s / 6s / 13.5s / 24s，**再乘 ±30% 的随机抖动**。
抖动不是花活：三个站点同时失败时，固定节奏会让它们一起撞进同一段坏链路。

**错误翻译**：`describeFetchError` 把 `ETIMEDOUT`/`ECONNRESET`/`ENOTFOUND`/`UND_ERR_CONNECT_TIMEOUT` 等
翻译成「连接超时」「跨境链路被中断」这种人话，直接进日志和邮件。

### 3.3 `parse.js` — HTML 变条目

`parseList(html, site, pageUrl)` 返回 `[{title, url, date, rawDate}]`：

- 用 `list.item` 选中每条，`list.title`/`list.link`（默认 `a`）抽出标题和链接；
- 标题优先取 `title` 属性（有些站把长标题截断成 `...` 放在文字里，完整版在 `title` 属性）；
- 过滤纯图片链接、`更多`/`下一页`/`查看` 这类按钮文案；
- **页面内二次去重**：先按 URL 去重，再按「标题去掉所有标点空白后的小写形式」去重——
  同一条通告常常同时挂在「通知公告」和「教务动态」两个栏目里；
- 日期：先试 `list.date` 选择器，取不到就从整条文字里 `parseDate` 猜。

`parseDetail(html, selector, maxChars)` 抓正文：去掉 script/style，优先用配置的选择器，
否则退到 `article`、再退到 `body`；正文太短或是「加载中，请稍后」这类占位文案时返回空串。

### 3.4 `match.js` — 关键词规则

`compileRules(全局keywords, 站点keywords)` —— **两层规则合并**，站点的会叠加在全局之上。

| 字段 | 语义 |
|---|---|
| `include` | 子串匹配（忽略大小写、全半角、空格），命中任意一个即可 |
| `include_mode: all` | 必须全部命中 |
| `exclude` | 命中任意一个直接丢弃（优先级最高） |
| `regex` | 正则，和 include 是「或」的关系 |
| `match_in` | `title`（默认，快）/ `title+content`（连正文搜，要抓详情页，慢） |

匹配时会做**去空格匹配**：`haystack` 和 `compact`（去掉所有空白）都比一遍，
这样「交换 生」和「交换生」也能命中。`highlight()` 负责在邮件里把命中词标黄（先按长度倒序，避免短词把长词切碎）。

### 3.5 `store.js` — 去重账本

```jsonc
{
  "version": 1,
  "sites": {
    "川大教务处·通知公告": {
      "lastRun": "2026-11-11T12:03:26.000Z",
      "lastOk":  "2026-11-11T12:03:26.000Z",   // 只有成功才更新
      "lastError": null,
      "lastCount": 13,
      "failStreak": 0                          // 连续失败次数，用于告警降噪
    }
  },
  "items": {
    "川大教务处·通知公告#229bf6bf7909d611": {   // 站点名 + sha1(url) 前 16 位
      "url": "https://jwc.scu.edu.cn/info/1069/10920.htm",
      "title": "关于选派本科生参加…",
      "site": "川大教务处·通知公告",
      "firstSeen": "2026-11-04T03:05:01.118Z",
      "lastSeen":  "2026-11-09T16:59:31.920Z"
    }
  },
  "meta": {
    "lastMailAt": "2026-11-11T12:03:27.000Z",     // 上次发信时间
    "lastHeartbeatAt": "2026-11-11T12:03:27.000Z" // 上次「报平安」时间
  }
}
```

- 键 = `站点名 + '#' + sha1(url).slice(0,16)`，所以**同一个链接出现在两个站点会被当成两条**（合理：两个栏目是两件事）；
- `pruneState` 按 `retention_days`（默认 120 天）清掉 `lastSeen` 过期的条目，防止文件无限膨胀；
- `recordSiteOk` / `recordSiteFail` 维护 `failStreak`；写文件用「临时文件 + rename」，避免写一半断电留下坏 JSON。

### 3.6 `mail.js` — 三种邮件

| 邮件 | 触发 | 内容 |
|---|---|---|
| 汇总（digest） | 有新命中 | 按站点分组，命中词高亮，附日期/摘要/原文链接 |
| 逐条（per_item） | `email.mode: per_item` 且有多条命中 | 一条一封 |
| 心跳（heartbeat） | 超过 `min_interval_hours` 没发过任何邮件 | `N/M 个站点正常` + 每站上次成功时间 |

邮件同时渲染 HTML 和纯文本（`renderDigest` / `renderDigestText`），纯文本是给不解析 HTML 的客户端兜底。
HTML 用内联样式 + table 布局（邮箱客户端对 `<style>` 支持很差）。

`sendMail` 用 nodemailer，`from` 是 `"通告雷达" <你的邮箱>`，SMTP 参数从 `config.email.smtp` 或
`SMTP_HOST/SMTP_PORT/SMTP_SECURE/SMTP_USER/SMTP_PASS` 环境变量来。

### 3.7 `export.js`

把同一份数据写成 Markdown：`out/latest.md` 永远是最新，`history: true` 时另存 `out/archive/<时间戳>.md`。
本地跑适合贴进 Notion/Obsidian；Actions 里则作为 Artifacts 上传（不提交进仓库，避免仓库膨胀）。

### 3.8 `inspect.js` — 自动写选择器

新手最容易卡在「`list.item` 该写什么」。`inspect <url>` 会：

1. 找所有「像通告的链接」（href 有效、文字 ≥ 6 字、含中文、不是「更多」这类噪音）；
2. 按**最近的列表容器**分组（`tr` 优先于 `li`，因为表格布局的公告栏很常见）；
3. 每组打分：`条数 × (1 + 带日期比例 × 1.5) × (平均文字长度 > 20 ? 1 : 0.6)`；
4. 取前 5 名，各自猜一个日期选择器（在条目内部找「文本里像日期、且长度 ≤ 24」的元素，class 含 `time/date` 加分）；
5. 直接打印成可以粘进 `config.yaml` 的 4 行。

### 3.9 `config.js`

- `DEFAULTS` 深合并用户配置，所以配置里只写想改的字段；
- 环境变量**覆盖** YAML（这样 Secrets 不会进仓库）：`SMTP_*`、`MAIL_TO`；
- 启动即校验：sites 非空、每个站点有 `name`/`url`/`list.item`、URL 以 http(s) 开头、站点名不重复（重名会让 state 串掉）；
- `assertEmailConfig` 只在**真的要发信时**才检查，所以 `test` / `--dry-run` 不会被邮箱配置挡住。

### 3.10 `cli.js` — 主流程

7 个命令：

| 命令 | 用途 | 会不会发信/改状态 |
|---|---|---|
| `doctor [--smtp] [--json]` | 体检：能不能抓、条数、日期覆盖率、命中数、SMTP | 否 |
| `inspect <url>` | 探测选择器 | 否 |
| `demo` | 用内置样例生成一封邮件预览（不联网） | 否 |
| `test [--site X] [--limit N] [--json]` | 只解析打印 | 否 |
| `run [--dry-run] [--no-email] [--no-export] [--init] [--site X] [--strict] [--preview f]` | 正式跑 | 是 |
| `check-smtp` | 验证邮箱能否登录 | 否 |
| `send-test` | 发一封假数据的测试邮件 | 只发信 |

**`prepareSite()`**（单站点的完整处理）：
```
列表页 urls[] → 并发/串行抓取 → parseList → 按链接去重
  → firstRun? 全部算新的 : 过滤掉 state 里见过的
  → 需要正文匹配？并发抓详情（上限 detail.max_items 默认 15）
  → 逐条 matchItem
  → 标题命中但没抓正文的，再补抓一次拿摘要（上限 5 条）
  → firstRun 且 first_run.mode=digest ? 附最近 N 条样例
```

**`cmdRun()`** 的顺序：
```
1. 读 state、算 now
2. 站点并行（request.site_concurrency，默认 3）→ prepareSite，成功/失败都写进 state
3. 汇总 groups / errors / totalHits / totalSamples
4. --init 则只标记已读、不推送
5. 写 Markdown（除非 --no-export）
6. --preview 则导出邮件 HTML
7. decideMail() 决定发不发、发哪种
8. 发信 → 更新 meta
9. 存 state（清理过期条目）
10. 控制台打印本次结果 + 写 GitHub Job Summary
```

**`decideMail()`** 是「什么时候打扰你」的唯一决策点：

```
有新命中 / 首次样例            → 发汇总
某站点连续失败 ≥ 阈值(默认3)    → 发告警
距离上次发信 ≥ 20 小时          → 发心跳
其它                          → 什么都不发（只写日志）
```

注意：发过汇总或告警也算「报过平安」，心跳计时器一起清零，不会同一天收两封。

---

## 4. 一次真实运行的时序

以本机 Windows 计划任务为例：

```
20:03:00  计划任务触发（登录后 60s 延迟 / 每 2 小时重复）
20:03:01  run-local.ps1：把 .env 读进进程环境变量
20:03:01  TCP 探测 jwc.scu.edu.cn:443，通 → 继续（不通则最多等 180s）
20:03:01  node src/cli.js run
20:03:01     ├─ 3 个站点并行抓列表页（fetch，10s 超时 × 最多 5 次尝试）
20:03:02     ├─ 教务处 13 条 / 实习 20 条 / 通知公告 17 条
20:03:02     ├─ 与 state 比对 → 新增 4 + 3 + 0 条
20:03:02     ├─ 关键词匹配（交换/实习/选派）→ 命中 1 + 3 + 0 条
20:03:02     ├─ 写 out/latest.md + out/archive/...
20:03:03     ├─ decideMail → 有命中 → 发汇总
20:03:03     ├─ SMTP 发信：[通告雷达] 4 条新通告 · 川大教务处·通知公告、川大就业网·实习岗位
20:03:03     └─ state 落盘（标记 33 条已见，更新 lastRun/lastOk/failStreak）
20:03:03  日志写 logs\radar-2026-11-11.log，退出码 0
```

---

## 5. 关键设计决策（以及为什么这么定）

### 5.1 按条目去重，而不是按页面 diff
页面 diff 会被「访问量」「轮播图」「今天日期」触发。按条目去重后，只有真的出现新通告才会动。

### 5.2 去重键 = 站点 + 规范化链接，页面内再按标题去重
两个层次解决两个问题：
- 跨运行重复（同一条通告下次还在列表里）→ 靠 state 里的 `站点#hash(url)`；
- 同一次运行内重复（同一条通告挂两个栏目、链接带不同跟踪参数）→ 靠 `canonicalUrl` + 标题归一化。

### 5.3 状态必须持久化，而且必须提交回仓库
Actions 的每次运行都是全新容器，state 不写回仓库就等于每次都是「第一次运行」，会把所有旧通告当新的推。
所以工作流最后一步 `git add state && commit && push`，并且需要 `permissions: contents: write`。

### 5.4 单次超时 10s、重试 4 次、退避带抖动
来自实测：跨境链路失败时，20s 的等待纯属浪费（TCP 握手根本不会完成），
而 5 次尝试 + 45s 退避能在链路抖动时救回一部分。抖动是为了避免三个站点同频重试。

### 5.5 站点并行
原先是串行 `for` 循环：3 个站点 × 4 次尝试 × 20s ≈ 5 分钟一轮。
改成 `mapLimit(sites, 3, ...)` 后，最坏情况 ≈ 95 秒，而且 `mapLimit` 按下标返回，输出顺序仍然和 config 一致。

### 5.6 告警降噪
链路抖一下就发「抓取失败」，收件箱里全是失败，真正的通告反而被淹没。
所以引入 `failStreak`：连续失败到阈值（默认 3 次）才发告警，偶发一次只写日志和 Job Summary。

### 5.7 心跳邮件
这套东西最大的问题不是失败，而是**沉默**：没消息 = 可能真的没通告，也可能脚本已经死了一周。
心跳（默认 20 小时一次，只在完全没有其它邮件时发）把这两种情况区分开。

### 5.8 为什么最终没用 Cloudflare Worker 代理
仓库里原本推荐用 CF Worker 绕过机房 IP 拦截。但实测：`Cloudflare 前面的公共代理 → 川大` 返回 **522（连不上源站）**，
说明川大这边对大厂云/CDN 的 IP 段并不友好。同一时间，14/15 个普通 VPS 节点访问都是 200。
所以「换到一台普通 VPS」或「直接在本机跑」才是有效解，CF Worker 大概率白做。

---

## 6. 部署演进（这段是真实历史）

| 阶段 | 方案 | 结果 |
|---|---|---|
| v0.1.0 | GitHub Actions，每天 3 次（UTC 00/04/11） | 晚间运行几乎全超时 |
| v0.1.1 | 加 Cookie 挑战处理、代理支持、Job Summary | 403 解决了，但超时没解决 |
| v0.2.0 | 短超时 + 多试 + 抖动 + 并行 + 心跳 + 告警降噪 | 代码更抗揍，但链路本身没变 |
| 实测 | Actions 18 次运行 / 54 次站点抓取 | 只有 2 次全绿，站点成功率 **15/54 ≈ 28%** |
| 实测 | 本机（同一条宽带） | TCP 握手 **7ms**，三个页面全 200 |
| 实测 | check-host 全球 15 个节点 | **14/15 成功**，美国/欧洲/新加坡都是 200 |
| 实测 | Cloudflare 前置的公共代理 | **HTTP 522** |
| 实测 | GitHub schedule 准点性 | 设 01/04/07 UTC，实际落在北京时间 15:45 / 20:20 / 23:20（**晚 6~8 小时**） |
| v0.2.1 | **Windows 计划任务本地跑**，云端 schedule 注释掉 | 本机 100% 可达，已经稳定出信 |

结论：**抓取能不能成，取决于出口 IP，不取决于代码。** 代码能做的是「失败得快、重试得聪明、失败时说得清楚」。

---

## 7. 别人要用，改哪里

### 7.1 最小改动：只换学校和栏目（3 个字段）

```powershell
cp config.example.yaml config.yaml
node src/cli.js inspect "https://你的学校/通知列表页"     # 自动给出选择器
node src/cli.js doctor                                    # 体检
```

`config.yaml` 里每个站点就这 4 行是必须自己写的：

```yaml
sites:
  - name: 某某大学·教务处通知        # 唯一，改了以后 state 里的历史会「对不上」，等于重新订阅
    url: https://jwc.example.edu.cn/list.htm
    list:
      item: "ul.news-list li"     # 每条通告的容器（inspect 会给）
      title: "a"
      link: "a"
      date: "span.date"           # 能省则省，脚本会从整条文字里猜
```

> ⚠️ `name` 是去重键的一部分。**改名字 = 全新的订阅**（历史条目都会当作没见过，重新推一遍）。

### 7.2 改关键词

```yaml
keywords:
  include: [交换, 实习, 选派]   # 子串匹配，命中任一
  exclude: [招标, 中标]         # 命中就丢弃
  include_mode: any             # any | all
  match_in: title               # title | title+content（后者要抓详情页，慢）
```

- 中文不用加引号，但含 `:` `#` `{}` 的词要加（YAML 语法）。
- 想更精确就用 `regex`（`match_in: title+content` 时也能搜正文）。
- 站点也可以写自己的 `keywords`，会叠加在全局规则上。

### 7.3 改邮箱 / 收件人

**本地跑**：改 `.env`（`cp .env.example .env`）

```ini
SMTP_HOST=smtp.qq.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=你的QQ号@qq.com
SMTP_PASS=授权码            # 不是登录密码！QQ邮箱 → 设置 → 账号 → 开启SMTP服务 → 生成授权码
MAIL_TO=收件地址@qq.com      # 可以和 SMTP_USER 不同
```

**Actions 跑**：仓库 Settings → Secrets and variables → Actions，加 6 个：
`SMTP_HOST` `SMTP_PORT` `SMTP_SECURE` `SMTP_USER` `SMTP_PASS` `MAIL_TO`。

### 7.4 决定在哪跑（二选一，别同时开）

| | 本机计划任务（推荐） | GitHub Actions |
|---|---|---|
| 可达性 | ✅ 100%（同一条国内宽带） | ❌ 约 28%（Azure 出境被掐） |
| 需要开机 | 是 | 否 |
| 成本 | 0 | 0（公开仓库）|
| 配置 | `.env` + 一条命令 | 6 个 Secrets |
| 状态 | 本地 `state/` | 仓库里的 `state/` |

```powershell
# 本机（Windows）
.\scripts\install-boot-task.ps1 -RunNow     # 或双击 安装计划任务.cmd
```

```bash
# Linux / NAS
crontab -e
0 */2 * * * cd /path/to/notice-radar && /usr/bin/node --env-file-if-exists=.env src/cli.js run >> radar.log 2>&1
```

### 7.5 站点挡机房 IP 时用代理

```yaml
sites:
  - name: 某站
    proxy: "https://你的中转/?url={url}"    # {url} 会被 encodeURIComponent
```

也可以用环境变量 `FETCH_PROXY` 给所有站点统一加。注意用**普通 VPS**，别用 Cloudflare Worker（见 5.8）。

### 7.6 新增一个栏目

在 `sites:` 下复制一段，改 `name` / `url` / 选择器即可。同一个站点的多个列表页用 `urls: [第1页, 第2页]`。

---

## 8. 注意事项（每一条都踩过）

1. **`.env` 和 `config.yaml` 里的密码**：`smtp.pass` 留空，走环境变量；`.env` 已在 `.gitignore`。
   万一泄露了，去 QQ 邮箱重新生成授权码。
2. **QQ 邮箱要的是「授权码」不是登录密码**，且必须先开启 SMTP 服务。
3. **Actions 需要 `permissions: contents: write`**，否则 state 推不回去，下次会把所有旧通告当新的重推。
4. **本机和 Actions 不要同时跑**：两份 state 各管各的，同一条通告会被推两遍。
5. **改站点 `name` 等于重新订阅**（见 7.1）。
6. **站点改版**后会「解析到 0 条」，此时会报错/告警；跑一次 `inspect` 换选择器即可。
7. **JS 渲染的页面抓不到**（源码里搜不到标题）：本项目不带浏览器，需要另配 Playwright。
8. **`.ps1` 必须保存成 UTF-8 with BOM**：Windows PowerShell 5.1 没有 BOM 会按 GBK 解析，
   中文注释会吃掉引号，直接报「字符串缺少终止符」。
9. **PowerShell 5.1 用 GBK 解码子进程输出**：`run-local.ps1` 已经显式切到 UTF-8，不然日志中文全是乱码。
10. **cron 不可信**：GitHub 的 `schedule` 会整体延后数小时；Windows 计划任务比它准，但机器睡眠也会错过（已开 `StartWhenAvailable`，唤醒补跑）。
11. **抓取频率别调高**：每站每次 1~2 个请求、每 2 小时一次足够。频率拉高容易被封，也不礼貌。
12. **`retention_days`** 控制 state 大小（默认 120 天）。太小会导致老通告「复活」重推，太大文件变大。
13. **首次运行会发一封样例信**（每个站点最近 5 条），那是给你确认选择器用的，不是 bug；
    想跳过用 `run --init`（把当前列表全部标记为已读，不推送）。
14. **邮件进垃圾箱**：把发件人加白名单；自己给自己发尤其容易进垃圾箱。
15. **`--strict`** 只在「所有站点都失败」时让工作流变红；部分失败只写 Job Summary，不会报警。

---

## 9. 排障速查

| 现象 | 先看什么 | 处置 |
|---|---|---|
| 一直「抓取失败 … 连接超时」 | `state/state.json` 的 `lastError` | 出口 IP 的问题（见 5.8）。换本机跑，或配普通 VPS 代理 |
| 「没有解析到任何条目」 | 选择器是否失效 | `node src/cli.js inspect <url>` 重新生成 |
| 邮件收不到 | 垃圾箱 → `MAIL_TO` → 授权码 | `check-smtp`，再 `send-test` |
| 收到重复通告 | 是否两边都在跑 / state 有没有提交成功 | 只留一边；检查 `git push` 权限 |
| 日志里中文乱码 | PowerShell 版本 | 用仓库里的 `run-local.ps1`（已处理编码） |
| 心跳一直不来 | `meta.lastHeartbeatAt`、`email.heartbeat.enabled` | 只有「完全没有其它邮件」时才会发心跳 |
| Actions 不再自动跑 | `radar.yml` 的 `schedule` 是否被注释 | 取消注释；但先停掉本机任务 |
| 任务计划里看不到任务 | 名字是 `NoticeRadar` | `Get-ScheduledTask -TaskName NoticeRadar` |

---

## 10. 想改某个行为，去哪个文件

| 想改的 | 去哪 |
|---|---|
| 新增/修改站点、关键词、邮箱 | `config.yaml` |
| 「什么时候发信」的规则 | `src/cli.js` 的 `decideMail()` |
| 邮件长什么样 | `src/mail.js` 的 `renderDigest` / `renderHeartbeat` |
| 重试次数/超时/抖动 | `config.yaml` 的 `request`；算法在 `src/fetch.js` 的 `retryDelay` |
| 去重规则 | `src/store.js`（键）+ `src/util.js` 的 `canonicalUrl` |
| 日期识别 | `src/util.js` 的 `parseDate` |
| 选择器自动探测 | `src/inspect.js` |
| 本机怎么跑、日志怎么写 | `scripts/run-local.ps1` |
| 什么时候跑 | 计划任务触发器 / `scripts/install-boot-task.ps1` / `radar.yml` |

---

## 11. 测试

`npm test` 跑 65 个用例（`node:test`，**不联网**）：

| 文件 | 覆盖 |
|---|---|
| `test/match.test.js` | include/exclude/all/regex/正文匹配/高亮 |
| `test/parse.test.js` | 标题+链接+日期提取、去重、占位正文 |
| `test/util.test.js` | URL 规范化、日期解析、全半角归一化 |
| `test/store.test.js` | 去重、首轮判定、过期清理、落盘读回、坏文件容错 |
| `test/fetch.test.js` | 编码识别、GBK 解码、Cookie 挑战全流程、错误翻译 |
| `test/proxy.test.js` | 代理地址构造、走代理时的相对链接补全 |
| `test/inspect.test.js` | 选择器探测结果能直接拿来解析 |
| `test/mail.test.js` | 汇总渲染、心跳渲染、标题生成 |
| `test/decide-mail.test.js` | 发信决策：心跳到期/降噪/阈值/关闭开关 |

改代码后先跑 `npm test`；UI 效果用 `node src/cli.js demo` 生成 `out/demo.html` 看。

---

## 12. 已知限制

- 不支持 JS 动态渲染（没有 Playwright），详情页正文常抓不到，但标题级匹配不受影响；
- 不支持登录态页面（统一身份认证后的内网通知）；
- 站点改版后需要重新 `inspect`；
- 一个站点内的标题去重是「宽松匹配」（去标点空白后比较），如果两个不同通知标题恰好一模一样，会被误判成重复。
