# 通告雷达 notice-radar

> 仓库：[Mengysheng/gain-message](https://github.com/Mengysheng/gain-message)

按关键词盯着学校官网的通告栏，**只把命中关键词的新通告**汇总成一封邮件发给你。不用学校门户账号、不用浏览器插件、不用服务器——挂在 GitHub Actions 上零成本运行。

![Node](https://img.shields.io/badge/node-%E2%89%A520-339933)
![tests](https://img.shields.io/badge/tests-47%20passed-brightgreen)
![license](https://img.shields.io/badge/license-MIT-blue)
![deps](https://img.shields.io/badge/dependencies-4-brightgreen)

[![ci](https://github.com/Mengysheng/gain-message/actions/workflows/ci.yml/badge.svg)](https://github.com/Mengysheng/gain-message/actions/workflows/ci.yml)
[![notice-radar](https://github.com/Mengysheng/gain-message/actions/workflows/radar.yml/badge.svg)](https://github.com/Mengysheng/gain-message/actions/workflows/radar.yml)

![邮件效果](docs/preview.png)

## 目录

- [它解决什么问题](#它解决什么问题)
- [快速开始](#快速开始)
- [配置](#配置)
- [现成配置样例](#现成配置样例)
- [部署到 GitHub Actions](#部署到-github-actions)
- [命令](#命令)
- [常见问题](#常见问题)
- [项目结构](#项目结构)
- [Roadmap](#roadmap)
- [参与贡献](#参与贡献)

## 它解决什么问题

学校的推免、夏令营、交换项目、实习岗位，往往只挂在一个没有 RSS 的通知栏里，报名窗口可能只有三天。

通用的网页监控（changedetection.io、Distill、Visualping）解决的是「页面变了就通知」，放到通告栏上有三个坑：

1. 访问量、时间戳、轮播图一动就告警，噪音淹没真正的通知；
2. 同一条通告出现在首页、列表页、详情页，会推三遍；
3. 不区分新旧，也没法只推关键词相关的那几条。

这个项目换成**按条目**处理：

```
抓列表页 → 解析每条（标题/链接/日期）→ 链接规范化 + 标题去重
        → 关键词匹配 → 只推新增的命中条目 → 邮件汇总 / Markdown 存档
```

## 快速开始

需要 Node.js ≥ 20。**先不联网看看效果**：

```bash
npm ci
node src/cli.js demo        # 用自带样例生成一封邮件，输出到 out/demo.html
```

然后接自己的学校：

```bash
# 1. 探测列表页选择器（大部分学校一条命令就能出结果）
node src/cli.js inspect "https://你的学校/通知列表页"

# 2. 复制模板，把上一步给出的 4 行选择器粘进 sites
cp config.example.yaml config.yaml

# 3. 体检：条数、日期覆盖率、命中数量对不对
node src/cli.js doctor

# 4. 预览邮件，不发信
node src/cli.js run --dry-run --no-email --preview out/preview.html
```

看到 `doctor` 全绿，就可以配邮箱正式跑了。

## 配置

配置只有一个文件 `config.yaml`，三块内容：

```yaml
# 1) 盯哪里
sites:
  - name: 川大教务处·通知公告
    url: https://jwc.scu.edu.cn/ssjgy.jsp?wbtreeid=1001
    list:
      item: "div.list li"      # 每一条通告
      title: "a"
      link: "a"
      date: "span"

# 2) 盯什么
keywords:
  include: [交换, 实习]        # 命中任意一个
  exclude: [招标, 中标]        # 命中就丢弃
  include_mode: any            # any | all
  match_in: title              # title | title+content

# 3) 发到哪
email:
  enabled: true
  to: [you@qq.com]
  smtp: { host: smtp.qq.com, port: 465, secure: true, user: you@qq.com, pass: "" }
```

- 普通关键词是**子串匹配**，忽略大小写、全角半角，`交换` 能匹配「交换生」。
- 站点内还可以写自己的 `keywords`，会叠加在全局规则上。
- 一个学校的多个栏目 = 多个 `sites` 条目；同一栏目分页 = `urls: [第1页, 第2页]`。
- 密码**不要**写进文件，用 `SMTP_PASS` 环境变量或 GitHub Secrets。

完整字段说明见 [docs/selector.md](docs/selector.md)。

## 现成配置样例

`examples/` 下是**已实测可跑**的完整配置，复制过去改个邮箱就能用：

| 文件 | 覆盖 |
|---|---|
| [`examples/scu.yaml`](examples/scu.yaml) | 四川大学：教务处通知 + 就业网实习岗 + 就业网通知 |
| [`examples/fudan.yaml`](examples/fudan.yaml) | 复旦大学教务处通知公告 |
| [`examples/whu.yaml`](examples/whu.yaml) | 武汉大学通知公告 |

```bash
cp examples/scu.yaml config.yaml
node src/cli.js doctor
```

> 本仓库根目录的 `config.yaml` 现在就是四川大学那份（维护者自用），所以 clone 下来跑 `doctor` 是有数据的。
> 不是川大的话，把 `sites:` 整段换成你自己的即可，或者用 `config.example.yaml` 重开一份。

想加自己的学校：先 `inspect`，再对照 [docs/selector.md](docs/selector.md) 里的「常见 CMS 配方」（博达、表格布局、WordPress、DedeCMS 等）。

## 部署到 GitHub Actions

推到 GitHub 后加 6 个 Secrets（`SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` / `MAIL_TO`），
在 Actions 页面点一次 **Run workflow** 即可，默认每天 08:00 / 12:00 / 19:00 各跑一次。

两个容易踩的点：

- 工作流需要 `permissions: contents: write`，每次跑完把 `state/state.json` 提交回仓库，否则会把旧通告当新的重复推。
- GitHub 的 cron 是 UTC，北京时间要减 8 小时。

完整步骤、私有仓库额度、Fork 的坑、服务器/cron/Windows 计划任务等部署方式见 **[docs/deploy.md](docs/deploy.md)**。
想把项目发布成自己的开源仓库，照 **[docs/publish.md](docs/publish.md)** 的清单走一遍。

## 命令

| 命令 | 作用 |
|---|---|
| `node src/cli.js doctor [--smtp]` | 体检：配置、选择器、条数、日期覆盖率、SMTP |
| `node src/cli.js inspect <url>` | 探测列表页选择器 |
| `node src/cli.js demo` | 离线演示，不联网不发信 |
| `node src/cli.js test [--json]` | 只解析打印，不改状态不发信 |
| `node src/cli.js run` | 正式跑：抓取 → 匹配 → 发信 → 存状态 |
| `node src/cli.js check-smtp` | 验证 SMTP 能否登录 |
| `npm test` | 47 个单元测试（不需要网络） |

`run` 常用开关：`--dry-run`（预览）、`--no-email`（只写 Markdown）、`--init`（把当前列表标记为已读）、`--site 名称`（只跑某站）、`--strict`（抓取失败时退出码 2，让 Actions 变红）、`--preview 文件`（导出邮件 HTML）。

输出：

- **邮件**：一封汇总，命中词高亮、按站点分组、首次订阅附样例；`email.mode: per_item` 可改成一条一封。
- **Markdown**：`out/latest.md` + `out/archive/`，方便贴进 Notion / Obsidian。
- **告警**：站点解析到 0 条时发提醒邮件，避免「看起来没通知」的静默失效。

## 常见问题

**解析到 0 条？**
先 `inspect`。仍然没有的话，多半是 JS 动态渲染（右键查看源代码，搜不到标题）或需要登录。换同校的静态栏目通常能解决。

**详情页正文是「加载中，请稍后」？**
详情页由 JS 渲染，`detail` 抓不到正文，但标题级匹配不受影响。

**中文乱码？**
加 `charset: gbk`。

**邮件收不到？**
`check-smtp` → 垃圾箱 → `MAIL_TO` → QQ 邮箱用的是授权码而不是登录密码。

**会重复推送吗？**
不会。状态按「站点 + 规范化链接」记录，页面内还按标题去重（同一条通告发在两个栏目只推一次）。

**站点改版了？**
会收到告警邮件；`inspect` 重新生成选择器即可。

**报 403？**
先看响应体：如果是一个带 `window.location.href` 的小页面，那是 Cookie 挑战，0.1.1 起会自动保存 cookie 并重试，不用管。如果响应体是正常的错误页、且只有 Actions 报 403，那才是机房 IP 被拦，用 `proxy` 走一层 Cloudflare Worker 即可，见 [docs/proxy.md](docs/proxy.md)。

更多排错见 [docs/deploy.md](docs/deploy.md#排障)。

## 项目结构

```
config.yaml              你的配置（站点 + 关键词 + 邮件）
src/cli.js               命令入口与主流程
src/fetch.js             抓取：超时、重试、GBK 自动识别
src/parse.js             列表 / 详情解析
src/match.js             关键词匹配与高亮
src/store.js             去重状态
src/mail.js              邮件渲染与发送
src/export.js            Markdown 汇总
src/inspect.js           选择器探测
examples/                现成配置 + 离线演示数据
docs/                    选择器指南、部署指南
test/                    单元测试（node:test，无需网络）
.github/workflows/       定时任务 + CI
```

## Roadmap

- [ ] JS 渲染站点支持（Playwright，可选依赖）
- [ ] 交互式向导：`init` 命令里输入 URL 自动跑 inspect 并生成配置
- [ ] 更多推送渠道：Server酱 / Bark / 企业微信机器人
- [ ] 条件规则：只在标题包含 A 且日期在 N 天内时推送
- [ ] 选择器失效自动重探并给出迁移建议
- [ ] 更多学校配置样例

有想加的功能，开 issue 说使用场景，比直接提 PR 更快达成一致。

## 参与贡献

最需要的是**新学校的配置**和**踩坑经验**。流程见 [CONTRIBUTING.md](CONTRIBUTING.md)，配置样例放 `examples/`。

## 免责声明

- 仅供个人学习和信息获取使用，请遵守目标网站的 robots.txt、服务条款和学校相关规定。
- 默认抓取频率很低（每天 3 次、每站 1～2 个请求），请不要改成高频轮询。
- 本项目不处理登录态、不绕过验证码、不抓取非公开内容。

## License

[MIT](LICENSE)
