# 部署

三种跑法，按「电脑关机也要收」→「只在本地」排序。

## 一、GitHub Actions（推荐，免费）

### 1. 建仓库并推代码

```bash
git init
git add .
git commit -m "init: notice-radar"
git branch -M main
git remote add origin https://github.com/Mengysheng/gain-message.git
git push -u origin main
```

Private 仓库更稳妥（配置里可能带学校内部栏目地址），公开仓库则 Actions 分钟数完全免费。Private 仓库每月免费 2000 分钟，本工作流每次约 1 分钟、每天 3 次，够用。

### 2. 加 Secrets

仓库 → **Settings → Secrets and variables → Actions → New repository secret**：

| Name | 值 | 说明 |
|---|---|---|
| `SMTP_HOST` | `smtp.qq.com` | QQ 邮箱；163 是 `smtp.163.com` |
| `SMTP_PORT` | `465` | SSL 端口 |
| `SMTP_SECURE` | `true` | 465 用 true，587 用 false |
| `SMTP_USER` | `you@qq.com` | 发件邮箱 |
| `SMTP_PASS` | 授权码 | **不是登录密码**，QQ 邮箱在设置里生成 |
| `MAIL_TO` | `you@qq.com` | 收件人，多个用逗号隔开 |

### 3. 手动跑一次

**Actions** → 左侧 `notice-radar` → **Run workflow**（模式选 `run`）。

想单独验证发信通道，把模式改成 `test-email`：它只发一封测试邮件，不抓取、不改状态，用来确认「到底是我没收到，还是它没发出来」。

第一次运行会给每个站点发一封「订阅成功 + 最近 5 条样例」的邮件，确认解析正确。之后只推新增的命中条目。

### 4. 改时间

GitHub 的 cron 是 **UTC**，北京时间 = UTC+8：

| 北京时间 | cron |
|---|---|
| 09:00 | `0 1 * * *` |
| 12:00 | `0 4 * * *` |
| 15:00 | `0 7 * * *` |
| 工作日 09:00 | `0 1 * * 1-5` |

改 `.github/workflows/radar.yml` 里的 `schedule`。注意：整点高峰可能延迟 5～15 分钟，属正常。

> **时间为什么要选白天？** 实测过：北京时间 11:30 三个站点全部能抓，19:59 和 20:48 全部超时——GitHub 的机器（海外）到国内学校的跨境链路在晚间不可用。所以只在白天跑，晚上的通知留到次日上午一起推。如果你的站点晚间也正常，可以自行加回晚间时段。

### 5. 状态为什么要提交回仓库

`state/state.json` 记录「哪些条目已经推过」。工作流最后一步会 `git commit` 并 push 它：

```yaml
permissions:
  contents: write
```

少了这个权限，状态推不回去，下次会把所有条目当新的，重复轰炸。

### 6. Fork 的坑

Fork 别人的仓库时：

- Actions 默认关闭，要去 Actions 页手动 Enable
- Secrets **不会**跟着 fork 过去，必须自己重新加
- 上游更新后同步，注意别覆盖自己的 `config.yaml`（建议把配置放在单独分支或只改 `config.yaml`）

---

## 二、自己的服务器 / NAS（Docker 或裸 Node）

适合需要 7×24、频率更高、或站点在校园网内的情况。

### 裸 Node + cron

```bash
git clone <repo> && cd notice-radar
npm ci
cp .env.example .env      # 填 SMTP
crontab -e
```

```cron
# 每天 8:00、12:30、19:00（服务器时区为 Asia/Shanghai 时）
0 8,12,19 * * * cd /path/to/notice-radar && /usr/bin/node --env-file-if-exists=.env src/cli.js run >> radar.log 2>&1
```

服务器时区不是北京时间的，先用 `timedatectl set-timezone Asia/Shanghai`，或把小时数换算好。

### Windows 任务计划

1. 任务计划程序 → 创建基本任务 → 每天 08:00
2. 操作：启动程序
   - 程序：`C:\Program Files\nodejs\node.exe`
   - 参数：`src\cli.js run`
   - 起始于：`C:\path\to\notice-radar`
3. 环境变量（SMTP_*）在「系统属性 → 环境变量」里设，或改用 `.env` + `--env-file-if-exists=.env`

### Docker

没有官方镜像，自己包一层即可（两行 Dockerfile）：

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
CMD ["node", "src/cli.js", "run"]
```

配 cron 容器或宿主机定时 `docker run --rm --env-file .env -v $(pwd)/state:/app/state notice-radar`。

---

## 三、只在本机试试

```bash
node src/cli.js doctor
node src/cli.js run --dry-run --no-email --preview out/preview.html
```

`--dry-run` 不发信、不写状态，纯预览。

---

## 排障

| 现象 | 检查 |
|---|---|
| Actions 红，日志写「抓取失败」 | 站点改版或需要登录，跑 `inspect` 重新生成选择器 |
| Actions 红，日志写 SMTP | Secrets 名字拼错、用了登录密码而不是授权码、465/587 与 `secure` 不匹配 |
| 收到邮件但全是旧通告 | `state/` 没提交成功：看最后一步 `git push` 有没有权限错误 |
| 邮件进垃圾箱 | 把发件人加白名单；QQ 邮箱自测时容易进垃圾箱 |
| 定时没触发 | 仓库 60 天无提交会自动停用定时任务，去 Actions 页点一次 Enable |
| **本地能抓、Actions 报 403** | 先看响应体：带 `window.location.href` 的是 Cookie 挑战（0.1.1+ 自动处理）；普通错误页才是 IP 拦截，见 [proxy.md](proxy.md) |
| 日志写 `fetch failed` | 云端到国内站点的跨境链路抖了一下（不是页面没更新）。已自动重试；偶发可忽略，频繁发生就配 `proxy` 见 [proxy.md](proxy.md) |
| 两边都 403 | 先确认是不是 Cookie 挑战；不是的话加 `headers.Referer`，仍不行说明封了非中国 IP |
