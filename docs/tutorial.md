# 使用教程

> 这份教程写给**第一次接触这个项目的人**：照着做，从零到「每隔一段时间自动把新通告发到邮箱」。
>
> - 只想用（不改代码）→ 看 [1](#1-它到底在做什么) ~ [6](#6-让它自己跑起来)
> - 想换成自己的学校 → 重点看 [5](#5-换成你自己的学校核心步骤)
> - 想改抓取时间 → 直接看 [7](#7-改抓取时间重点)
> - 想搞懂内部实现 → 看 [architecture.md](architecture.md)

---

## 1. 它到底在做什么

它每隔一段时间做一次这样的事：

```
打开你的学校通知栏 → 把它现在挂着的每一条通告列出来
   → 跟"已经推过"的账本比对 → 只剩新的
   → 用关键词筛一遍（交换 / 实习 / 选派…）
   → 有命中的，汇总成一封邮件发给你
   → 一条都没有，就什么都不发（或者到点发一封"我还活着"的心跳）
```

所以你收到的邮件只有三种：

| 邮件标题长这样 | 意思 |
|---|---|
| `[通告雷达] 4 条新通告 · 川大教务处·通知公告` | 有新东西，点进去看 |
| `[通告雷达] ⚠️ 2 个站点抓取失败` | 某个站点连续几次没抓到（改版了 / 网络断了） |
| `[通告雷达] 心跳：3 个站点都正常，无新通告` | 一切正常，只是最近没相关通知 |

---

## 2. 先把环境装好

只需要一样东西：**Node.js 20 或更高版本**。

### Windows

1. 打开 <https://nodejs.org> ，下 **LTS** 版本，一路下一步安装
2. **装完必须重新打开终端**（旧的终端里找不到新装的程序）
3. 验证：

```powershell
node -v      # 应该输出 v20.x 或 v22.x
npm -v
```

### macOS / Linux

```bash
# 有 Homebrew
brew install node
# 或者用 nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
```

> **卡住了？** `node -v` 报「不是内部或外部命令」= PATH 没生效，重开终端；还不行就重启一次电脑。

---

## 3. 拿一个 QQ 邮箱授权码

这一步最容易出错：**QQ 邮箱要的是「授权码」，不是你的登录密码**。

1. 浏览器登录 <https://mail.qq.com>
2. 右上角 **设置** → **账号**（新版叫「账号与安全」→「安全设置」）
3. 找到 **POP3/IMAP/SMTP 服务** → 开启 **SMTP 服务**
4. 按提示验证（发一条短信），拿到一串 **16 位授权码**，形如 `abcdwxyzefghijkl`
5. 抄下来——**它只会显示一次**

> 授权码泄露了就回这个页面「删除」再「生成」一个新的。

---

## 4. 三个文件，各管一件事

项目里和你有关的只有三个文件，其余都是代码，不用动：

| 文件 | 管什么 | 要不要提交到 git |
|---|---|---|
| `.env` | 邮箱账号、授权码、收件人 | ❌ 绝对不要（已在 `.gitignore`） |
| `config.yaml` | 监控哪些网站、搜什么关键词、发信规则 | ✅ 可以 |
| `state/state.json` | 「哪些通告已经推过」的账本，**程序自己维护** | ✅ 可以（云端跑必须提交） |

### 4.1 `.env` —— 邮箱

```powershell
cd <项目目录>
copy .env.example .env
notepad .env
```

填成这样就对了：

```ini
SMTP_HOST=smtp.qq.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=你的QQ号@qq.com
SMTP_PASS=刚才那串16位授权码
MAIL_TO=你想收到邮件的地址@qq.com
```

`MAIL_TO` 可以和 `SMTP_USER` 不同——比如用 A 邮箱发、发到 B 邮箱。

### 4.2 `config.yaml` —— 监控什么

最小可用版本长这样，改 5 个地方就能跑：

```yaml
keywords:
  include: [交换, 实习]      # ① 你要搜的词
  exclude: [招标, 中标]      # ② 不想要的词

sites:
  - name: 川大教务处·通知公告            # ③ 随便起，但要唯一
    url: https://jwc.scu.edu.cn/ssjgy.jsp?wbtreeid=1001   # ④ 列表页地址
    list:
      item: "div.list li"              # ⑤ 每条通告的选择器（见第 5 节）
      title: "a"
      link: "a"
      date: "span"

email:
  enabled: true            # 关掉就只写 Markdown、不发信
  to: [你的QQ号@qq.com]
```

### 4.3 `state/state.json` —— 别手改

它记录每条通告什么时候第一次见到、最后一次见到，以及每个站点上次成功/失败的时间。
**手改会导致重复推送**（改坏了就把整个 `items` 删掉，等于重新订阅，会重推一遍最近的通告）。

---

## 5. 换成你自己的学校（核心步骤）

这一节是「教别人」时最需要讲清楚的部分。分四步，每步都有验收标准。

### 第 1 步：让程序自己告诉你选择器该写什么

```powershell
node src/cli.js inspect "https://你的学校/通知列表页"
```

输出长这样（取第 1 组，它最可能是对的）：

```
为 https://... 找到 3 组候选，按可信度排序：

1. 命中 15 条，带日期 100%
   list:
     item: "ul.news-list li"
     title: "a"
     link: "a"
     date: "span.date"
   示例：关于2027年春季学期校际交换生选拔工作的通知
   示例：关于2027届毕业生实习学分认定工作的通知
```

**验收标准**：示例里的标题确实是通告标题，不是「更多」「首页」这种导航。

> 找不到候选？说明列表是 JS 动态渲染的（右键「查看网页源代码」，Ctrl+F 搜一条通告标题，搜不到就是这个原因）。
> 换一个静态栏目，或者用同校其他栏目代替。

### 第 2 步：把 4 行粘进 `config.yaml`

```yaml
sites:
  - name: 某某大学·教务处通知
    url: https://jwc.example.edu.cn/list.htm
    list:
      item: "ul.news-list li"
      title: "a"
      link: "a"
      date: "span.date"
    detail:
      enabled: false          # 不需要正文摘要就保持 false
```

**验收标准**：`name` 不重复、`url` 以 `https://` 开头。

> ⚠️ **`name` 是去重账本的一部分。改了名字 = 全新订阅**，历史通告会重新推一遍。名字定了就别改。

### 第 3 步：体检

```powershell
node src/cli.js doctor
```

正常输出：

```
✓ 解析正常
   15 条，日期覆盖 100%，命中 2 条
   · 2026-11-10 关于2027年春季学期校际交换生选拔工作的通知
```

**验收标准**：`✓ 解析正常`，条数 ≥ 3，日期覆盖 ≥ 50%。

出问题对照：

| 输出 | 原因 | 怎么办 |
|---|---|---|
| `✗ 解析失败` + `没有解析到任何条目` | 选择器不对 / 页面是 JS 渲染 | 重跑 `inspect`，确认页面源码里有标题 |
| `0 条` 但解析正常 | `list.item` 选到了但过滤掉了 | 检查标题是否被 `<title>` 属性截断、链接是否 `javascript:` |
| `日期覆盖 0%` | 没有日期元素 | 删掉 `date:` 那行，让它从整条文字里猜 |
| `0 命中` | 关键词不匹配 | 先看示例标题里有没有你要的词 |

### 第 4 步：先预览，再真跑

```powershell
# 不发信、不改状态，只看会推什么
node src/cli.js run --dry-run --no-email --preview out/preview.html

# 打开 out\preview.html 看看邮件长什么样

# 确认没问题，真跑（会发信、会记账）
.\scripts\run-local.ps1
```

**验收标准**：邮箱收到一封汇总邮件，或者收到一封「没有命中」的心跳信。

### 关键词怎么写（别人最容易写错的地方）

```yaml
keywords:
  include: [交换, 实习, 选派]
```

- 是**子串匹配**，不是整词匹配：`交换` 能命中「交换生」「校际交换」「交换项目」
- 太多词会把无关通知也推来；太少会漏。**建议先只写 2~3 个词**，看几天邮件再补
- 常见漏词：教务处的交换项目常写成「关于**选派**本科生参加…」，只搜「交换」会漏 → 所以要加 `选派`
- `exclude` 用来挡掉噪音，比如 `[招标, 中标, 采购]`
- 要精确控制就写正则：

```yaml
keywords:
  regex:
    - "20\\d{2}\\s*年.*(交换|访学)"
```

---

## 6. 让它自己跑起来

### Windows（推荐，最稳）

```powershell
cd <项目目录>

# 先手动跑通一次
.\scripts\run-local.ps1

# 注册成计划任务：登录后 60 秒跑一轮，之后每 2 小时一次
.\scripts\install-boot-task.ps1
```

也可以直接双击项目根目录的 **`安装计划任务.cmd`**（不用敲命令）。

确认注册成功：

```powershell
Get-ScheduledTask -TaskName NoticeRadar | Select-Object TaskName, State
Get-ScheduledTaskInfo -TaskName NoticeRadar | Select-Object NextRunTime, LastRunTime, LastTaskResult
```

卸载：双击 `卸载计划任务.cmd`，或 `.\scripts\install-boot-task.ps1 -Uninstall`。

### macOS / Linux

```bash
crontab -e

# 每 2 小时跑一次
0 */2 * * * cd /path/to/notice-radar && /usr/bin/node --env-file-if-exists=.env src/cli.js run >> logs/radar.log 2>&1
```

### GitHub Actions（不想开电脑时用，但抓取成功率低）

在仓库 Settings → Secrets and variables → Actions 里加 6 个：
`SMTP_HOST` `SMTP_PORT` `SMTP_SECURE` `SMTP_USER` `SMTP_PASS` `MAIL_TO`，
然后 Actions 页面点 **Run workflow**，或者把 `radar.yml` 里注释掉的 `schedule` 打开。

> ⚠️ **云端和本机不要同时跑**：两边各有一份 `state/state.json`，同一条通告会推两遍。

---

## 7. 改抓取时间（重点）

### 7.1 先搞清楚「时间」存在哪

| 你在哪跑 | 时间表存在哪 | 长什么样 |
|---|---|---|
| **Windows 计划任务**（本项目的默认） | Windows 任务计划程序里的「触发器」 | 登录时 + 延迟 60s ／ 每 2 小时重复 |
| macOS / Linux cron | `crontab` 里那一行 | `0 */2 * * *` |
| GitHub Actions | `.github/workflows/radar.yml` 的 `schedule` | `- cron: '0 */2 * * *'` |

**它不在 `config.yaml` 里**——配置只管抓什么、怎么发，不管什么时候跑。这是最常见的误解。

### 7.2 改法 A：图形界面（最直观，推荐给不写代码的人）

1. `Win + R` → 输入 `taskschd.msc` → 回车
2. 左侧 **任务计划程序库** → 找到 **NoticeRadar**（双击它）
3. 切到 **触发器** 标签，你会看到两个：

```
登录时            （延迟 1 分钟）      ← 开机补跑一轮，负责"关机期间的通告"
<注册那天的时间> 开始，每 2 小时重复   ← 这就是"定期抓取时间"
```

4. **改间隔**：双击第二个触发器 → 把「**重复任务间隔**」改成 `1 小时` 或 `4 小时` → 确定
5. **改成每天固定几个时间点**：
   - 选中第二个触发器 → **删除**（只删这一个，别删「登录时」那个）
   - 点 **新建** → 「**每天**」→ 起始时间填 `2026-11-12 08:30:00` → 确定
   - 想加 12:30、18:30 就再点两次 **新建**，各建一个「每天」触发器
6. 切到 **设置** 标签，确认勾上了「**如果错过计划的开始时间，请尽快启动任务**」（开机晚了会补跑）
7. 点 **确定** 保存。**不用重启，立即生效。**

查一下下次什么时候跑：

```powershell
Get-ScheduledTaskInfo -TaskName NoticeRadar | Select-Object NextRunTime
Get-ScheduledTask -TaskName NoticeRadar | Select-Object -ExpandProperty Triggers
```

### 7.3 改法 B：重新跑一条命令（只适合「每 N 小时」）

脚本的参数就是触发器：

```powershell
# 每 1 小时
.\scripts\install-boot-task.ps1 -RepeatHours 1

# 每 4 小时
.\scripts\install-boot-task.ps1 -RepeatHours 4

# 只在开机/登录时跑一轮，不做周期运行
.\scripts\install-boot-task.ps1 -RepeatHours 0

# 开机后延迟 5 分钟再跑（默认 60 秒）
.\scripts\install-boot-task.ps1 -DelaySeconds 300
```

> 同名的任务会被**覆盖重建**，所以「重新跑一遍」就是「改配置」。
> 这个脚本只支持「每 N 小时」，想要**每天固定时间点**请用 7.2 的图形界面。

### 7.4 改法 C：cron 和 Actions

**Linux / macOS**：

```bash
crontab -e
```

```cron
# 每 2 小时（原来的）
0 */2 * * *   ...

# 每天 8:30 / 12:30 / 18:30
30 8,12,18 * * *   ...

# 工作日 9 点到 19 点，每小时
0 9-19 * * 1-5   ...
```

cron 的 5 个字段依次是：`分 时 日 月 星期`。改完 `crontab -l` 确认一下。

**GitHub Actions**：改 `.github/workflows/radar.yml` 的 `schedule`（注意是 **UTC**，北京时间减 8 小时）：

```yaml
on:
  schedule:
    - cron: '0 1 * * *'   # 01:00 UTC = 09:00 北京
```

### 7.5 时间表怎么定（经验值）

| 方案 | 适合 |
|---|---|
| 每 2 小时（默认） | 通用。每天 12 次，每站约 24 个请求，很轻 |
| 每天 8:30 / 12:30 / 18:30 | 通告都是上班时间发的，这三次覆盖绝大多数情况 |
| 每小时 | 报名窗口很短（选调生、实习岗），漏一次可能就误事 |
| 每天 1 次 | 只想收个摘要 |

几点经验：

- **别超过每小时一次**。学校公告栏不会秒级更新，抓太勤只是给对方服务器添麻烦，也更容易被拦。
- **夜里不用跑**。教务/就业网基本都是工作时间更新，23:00–07:00 跑大概率白跑。
- **开机/登录那一轮要留着**。电脑关机期间的通告，靠它一次性补上（去重会保证不重复推）。

### 7.6 改完怎么确认

```powershell
# 下次什么时候跑
Get-ScheduledTaskInfo -TaskName NoticeRadar | Select-Object NextRunTime

# 触发器是不是你要的样子
(Get-ScheduledTask -TaskName NoticeRadar).Triggers | Format-List

# 到点之后看日志，确认真的跑了
Get-Content logs\radar-$(Get-Date -f yyyy-MM-dd).log -Tail 20
```

日志里每次运行都有明确的开始/结束行：

```
[2026-11-11 20:03:23] ================ 开始一轮检查 ================
[2026-11-11 20:03:26] [radar] 川大教务处·通知公告：解析 13 条，新增 4 条，命中 1 条
[2026-11-11 20:03:27] [radar] 邮件已发送：[通告雷达] 4 条新通告 · …
[2026-11-11 20:03:27] 退出码 0，用时 3s
[2026-11-11 20:03:27] ================ 本轮结束 ================
```

---

## 8. 日常维护

| 想做的事 | 怎么做 |
|---|---|
| 加一个新栏目 | `config.yaml` 的 `sites` 里复制一段，改 `name`/`url`/选择器，再 `node src/cli.js doctor` |
| 换关键词 | 改 `config.yaml` 的 `keywords`，下次运行自动生效，**不用重启任务** |
| 换收件人 | 改 `.env` 的 `MAIL_TO` |
| 看历史推送 | `out/latest.md`、`out/archive/` |
| 看每次运行成没成 | `logs\radar-今天.log`；或 `npm run history` |
| 更新代码 | `git pull`，然后 `npm ci`；计划任务不用重装 |
| 临时停一天 | 任务计划程序里右键任务 → **禁用** |
| 彻底不用了 | `.\scripts\install-boot-task.ps1 -Uninstall` |

---

## 9. 排障速查

| 现象 | 先查 | 处置 |
|---|---|---|
| 收不到任何邮件 | 垃圾箱 → `.env` 的 `MAIL_TO` | `node --env-file-if-exists=.env src/cli.js check-smtp`，再 `send-test` |
| 邮件里说「抓取失败 连接超时」 | 是不是在云端跑 | 换本机跑；或给站点配 `proxy` |
| 邮件里说「没有解析到任何条目」 | 站点是不是改版了 | `node src/cli.js inspect <url>` 重新生成选择器 |
| 同一条通告收到两遍 | 是不是本机和 Actions 都在跑 | 只留一边 |
| 日志里中文乱码 | 是不是用别的方式跑的 | 用仓库里的 `.\scripts\run-local.ps1` |
| 计划任务到点没跑 | 电脑当时是不是关机/睡眠 | `Get-ScheduledTaskInfo` 看 `LastRunTime`；设置里勾「错过就尽快启动」 |
| `node` 不是内部或外部命令 | Node 没装或 PATH 没生效 | 重开终端 / 重装 Node |
| 提示「禁止运行脚本」 | PowerShell 执行策略 | 用 `powershell -ExecutionPolicy Bypass -File scripts\run-local.ps1` |

---

## 10. 教别人时的顺序建议

给别人讲这个项目，按这个顺序最不容易劝退：

1. **先给结果**：把你自己收到的那封汇总邮件给他看（比讲原理有效十倍）
2. **只讲三个文件**：`.env`（邮箱）、`config.yaml`（抓什么）、`state.json`（不用管）
3. **让他先跑通默认配置**：`npm ci` → `node src/cli.js doctor`，看到 `✓ 解析正常` 建立信心
4. **再换学校**：`inspect` 一条命令出选择器，粘进配置，`doctor` 验证
5. **最后设自动**：双击 `安装计划任务.cmd`
6. **提醒三个坑**：授权码不是密码、站点 `name` 别改、本机和云端别同时跑

验收标准就一条：**他收到一封自己学校的、链接点得开的邮件。** 收到之前不用讲任何原理。
