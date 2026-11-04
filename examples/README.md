# 现成的配置样例

每个文件都是**完整可用**的配置，复制过去就能跑：

```bash
cp examples/scu.yaml config.yaml
node src/cli.js doctor
```

| 文件 | 学校 / 栏目 | 结构特点 |
|---|---|---|
| `scu.yaml` | 四川大学：教务处通知、就业网实习岗、就业网通知 | 博达 CMS（`div.list li`）+ 自建站（`div#mycontent li`） |
| `fudan.yaml` | 复旦大学教务处通知公告 | 博达 CMS 表格布局（`table.wp_article_list_table tr`） |
| `whu.yaml` | 武汉大学通知公告 | 表格布局，日期在第 3 列 |
| `demo/` | 离线演示数据 | 不联网，`node src/cli.js demo` 用 |

这些样例里的 `email.enabled` 都是 `false`，先跑 `doctor` / `test` 确认解析正常，再填邮箱。

## 想加自己的学校？

见 [docs/selector.md](../docs/selector.md)：先用 `inspect` 自动探测，再按「常见 CMS 配方」微调。
欢迎把你调好的配置提 PR 到 `examples/`，别人能少踩一次坑。
