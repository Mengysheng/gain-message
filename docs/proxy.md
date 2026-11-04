# 403：先分清是 Cookie 挑战还是 IP 拦截

## 第一步：看 403 的响应体

很多国内站点的 403 **不是** IP 拦截，而是一层「发 cookie 再跳回原页」的挑战：

```
403  <html><meta charset="utf-8"><title></title><div></div></html>
     <script>window.location.href = "/index/index/newslist.html?data=MQ";</script>
     set-cookie: d5d018f7...=fc16106f...
```

浏览器会自动带 cookie 重载，所以人眼看着正常；脚本不存 cookie 就会一直 403。

**遇到这种，不需要代理。** 当前版本（0.1.1+）已经内置处理：识别挑战页 → 保存 cookie → 自动重试一次。升级后重跑即可。

判断依据：403 响应体很短（几百字节）、里面有 `window.location.href` 或 `document.cookie`、且带 `Set-Cookie`。

## 第二步：确认是不是 IP 拦截

如果 403 的响应体是正常的错误页（不是上面那种挑战页），并且满足：

- 本地 `node src/cli.js test` 正常，GitHub Actions 报 403
- 同一个仓库其他站点正常

那才是 **WAF 按来源 IP 拒绝**：GitHub 的 runner 跑在 Azure 机房，很多国内站点的策略会直接拒绝云厂商 IP 段。换 UA、加 Referer 基本没用，因为决策依据是 IP。

| 现象 | 结论 |
|---|---|
| 403 响应体是 `window.location.href` 小页面 | Cookie 挑战，升级到 0.1.1+ 即可 |
| 本地 200，Actions 403，响应体是普通错误页 | IP 拦截，继续看本文 |
| 两边都 403，响应体是挑战页 | 也是 Cookie 挑战（浏览器缓存曾让你误判） |
| 本地也 404 | 地址写错或页面改版，跟 IP 无关 |

## 三种方案对比（仅针对 IP 拦截）

| 方案 | 成本 | 稳定性 | 适合 |
|---|---|---|---|
| **Cloudflare Worker 代理** | 免费，5 分钟 | 高 | 想继续用 Actions 定时跑 |
| 自己的服务器 / 校园网机器 | 有服务器才行 | 最高 | 本来就有 VPS / NAS |
| 被拦的站点改到本地定时跑 | 免费 | 中（电脑要开机） | 只有一两台电脑，且经常开着 |

下面的 Worker 方案是推荐做法。

## 方案一：Cloudflare Worker 代理（推荐）

### 为什么能过

Worker 请求目标站点时，出口是 Cloudflare 的 IP，不在学校的拦截名单里。实测川大就业网对 Cloudflare 出口返回 200，对 GitHub 的 Azure IP 返回 403。

### 部署步骤

1. 注册 / 登录 [dash.cloudflare.com](https://dash.cloudflare.com)（免费）
2. 左侧 **Workers & Pages** → **Create** → **Start with Hello World!**
3. 名字随便起，例如 `notice-proxy`，创建后点 **Edit code**
4. 把 `examples/cloudflare-worker.js` 的内容整个粘进去，替换原有代码
5. 修改文件顶部：

   ```js
   const ALLOWED_HOSTS = ['jy.scu.edu.cn'];   // 换成被拦的域名
   const TOKEN = '';                          // 可选：填个随机串更安全
   ```

6. 点右上 **Deploy**，拿到形如 `https://notice-proxy.你的子域.workers.dev` 的地址
7. 用浏览器验证一下（把目标地址编码后拼上去）：

   ```
   https://notice-proxy.xxx.workers.dev/?url=https%3A%2F%2Fjy.scu.edu.cn%2Findex%2Findex%2Femployjob.html%3Ftype%3D2
   ```

   能看到公告列表就成功了。

### 配置到项目里

两种写法，二选一。

**A. 写在 config.yaml（只代理个别站点）**

```yaml
sites:
  - name: 川大就业网·实习岗位
    url: https://jy.scu.edu.cn/index/index/employjob.html?type=2
    proxy: "https://notice-proxy.xxx.workers.dev/?url={url}"   # ← 加这一行
    list:
      item: "div#mycontent li"
```

`{url}` 会被自动替换成编码后的目标地址；模板里不写 `{url}` 时会按“追加”处理。

**B. 用环境变量（全局都走代理）**

```bash
FETCH_PROXY="https://notice-proxy.xxx.workers.dev/?url={url}"
```

GitHub Actions 里把它加成 Secret 即可：

```yaml
- name: 检查通告并发送邮件
  env:
    FETCH_PROXY: ${{ secrets.FETCH_PROXY }}
```

> 站点自己的 `proxy` 优先级高于 `FETCH_PROXY`，所以可以“全局走代理 + 个别站点直连”。

### 验证

```bash
# 本地走代理
node src/cli.js test --site "川大就业网·实习岗位" --proxy "https://notice-proxy.xxx.workers.dev/?url={url}"
```

或者直接在 Actions 里点一次 Run workflow，看日志里是否还报 403。

## 方案二：用自建服务器 / 校园网机器

有 VPS 或实验室机器时，最简单的是本地跑：

```bash
node src/cli.js run
```

用 cron / Windows 任务计划定时。参考 [deploy.md](deploy.md) 的“自己的服务器 / NAS”一节。

如果服务器有公网代理端口，也可以把它包成一个 `?url=` 接口，写法与 Worker 相同。

## 方案三：只把被拦站点放本地

Actions 继续负责能抓的站点，被拦的两个用本机定时任务：

```yaml
# .github/workflows/radar.yml 里改成只跑能通的站点
- name: 检查通告并发送邮件
  run: node src/cli.js run --strict --site "川大教务处·通知公告"
```

本机（Windows 任务计划）：

```powershell
node src/cli.js run --site "川大就业网·实习岗位" --site "川大就业网·通知公告"
```

两边状态互不干扰（`--site` 只处理指定站点，不会把别的站点标记为已读）。

## 注意事项

- **一定保留域名白名单**：Worker 地址一旦泄露，没有白名单就成了公开代理，可能被滥用导致账号受限
- 不要公开 `TOKEN`；公开仓库里建议用 Secret 注入 `FETCH_PROXY`
- Cloudflare 免费额度是每天 10 万次请求，这个项目每天只有个位数请求，远远用不到
- 代理只是绕开 IP 拦截，**不要用来绕过登录、验证码或访问非公开内容**
- 如果 Worker 也返回 403，说明站点封的是「非中国 IP」而不是「机房 IP」，这种情况只能走方案二或三
