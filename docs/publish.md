# 发布到 GitHub 的清单

从「本地能跑」到「别人愿意 star」之间，差的是一些设置。按顺序走一遍，20 分钟能搞定。

## 1. 先确认没有隐私信息

```bash
git status
grep -rn "SMTP_PASS\|@qq.com\|@163.com" --include="*.yaml" --include="*.yml" .
```

- `config.yaml` 里只留占位邮箱（`you@example.com` 之类），**不要**留真实邮箱
- 确认没有 `.env`、Cookie、学号
- `state/state.json` 可以是空的；如果你已经跑过，里面只有链接和标题，没有隐私，但也可以先清空

## 2. 建仓库并推送

```bash
git init
git add .
git commit -m "feat: 通告雷达 0.1.0"
git branch -M main
git remote add origin https://github.com/<你的用户名>/notice-radar.git
git push -u origin main
```

建议先建 **Private** 仓库跑通 Actions，再改成 Public。

## 3. 把占位符换成你的仓库地址

- `package.json` → `repository` / `bugs` / `homepage` 里的 `USER`
- `README.md` → 顶部注释掉的 CI 徽章，把 `USER` 换掉并取消注释
- `CHANGELOG.md` → 不用改

## 4. 仓库设置

| 位置 | 填什么 |
|---|---|
| Description | 按关键词监控学校官网通告，去重后邮件汇总 · Keyword-based notice monitor for university sites |
| Website | 留空即可 |
| Topics | `monitor` `notice` `university` `email` `digest` `github-actions` `nodejs` `crawler` `notification` `rss` |
| Social preview | 上传 `docs/preview.png`（Settings → Social preview） |

Topics 里放 `university`、`notice` 这类词，别人搜「学校 通知 监控」时才找得到。

## 5. 开启 Actions 并跑一次

1. Actions 页 → 允许工作流
2. `ci` 应该自动跑一次（Node 20/22 矩阵 + 离线 smoke）
3. `notice-radar` 工作流需要先加 6 个 Secrets 才能发信：
   `SMTP_HOST` `SMTP_PORT` `SMTP_SECURE` `SMTP_USER` `SMTP_PASS` `MAIL_TO`
4. 手动 Run workflow，确认收到「订阅成功 + 样例」邮件

## 6. 打一个 release

```bash
git tag -a v0.1.0 -m "首个可用版本"
git push origin v0.1.0
```

在 GitHub 的 Releases 页面基于 tag 建 Release，正文可以直接抄 `CHANGELOG.md` 的 0.1.0 段落。

## 7. （可选）发布到 npm

发布后别人可以 `npx notice-radar demo` 直接试：

```bash
npm login
npm publish --access public
```

`files` 字段已经配好了（只发 `src/`、`docs/`、`examples/`、`config.example.yaml`、README、LICENSE），
不会把测试和 CI 文件塞进包里。

## 8. 让别人更容易用起来

- README 第一屏要有：一句话说明、截图、三条命令
- `examples/` 里的学校越多，别人越可能直接复制而不是从零调选择器
- 在 README 里写明「欢迎提 PR 加学校配置」，比等人开口有效
- 如果发了博客/知乎/小红书，记得在 README 顶部放一句「介绍文章」链接

## 9. 日常维护

- 站点改版会导致选择器失效，issue 模板里已经要求贴 `doctor` 输出，能省很多来回
- 每周扫一眼 Actions，红了通常是某校改版，按 issue 修 `examples/` 并补一条单测
- 版本号按语义化：加学校配置不改版本；加功能升 minor；改配置格式升 major
