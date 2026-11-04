# 给新站点写选择器

整套配置里只有一件事容易卡住：`list.item` 这一行该填什么。这篇把流程和常见坑讲清楚。

## 一、先找对页面

要找的是**只列通告的列表页**，不是首页、不是详情页。

怎么判断：页面上一行一条、带日期、点进去是详情页。常见入口：

- 教务处 → 通知公告 / 教学通知
- 研究生院 → 招生信息 / 培养通知
- 学院 → 新闻动态 / 通知公告
- 就业网 → 招聘信息 / 实习信息

首页往往把 5 个栏目的前 3 条混在一起，抓首页会漏、也会混入无关内容。优先找栏目自己的列表页。

## 二、自动探测

```bash
node src/cli.js inspect "https://你的学校/通知列表页"
```

它会抓页面、把所有「像通告的链接」按所在容器分组，按「数量 × 有无日期」排序，给出前 5 组：

```
1. 命中 14 条，带日期 100%
   list:
     item: "table.wp_article_list_table tr"
     title: "a"
     link: "a"
     date: "td.ti"
   示例：关于2026年新生自查核实学信网学籍信息的通知
```

把 `item / title / link / date` 四行贴进 `config.yaml`，跑 `node src/cli.js test` 验证。

探测不准时，用 `--json` 看全部候选：

```bash
node src/cli.js inspect "https://..." --json
```

## 三、判断页面是不是 JS 渲染

在浏览器里右键 →「查看网页源代码」，然后 `Ctrl+F` 搜一条通告的标题：

- **搜得到** → 静态页面，脚本能抓
- **搜不到** → 内容由 JS 异步加载，`test` 会返回 0 条

JS 渲染的站点目前不支持（要上 Playwright，属于另一个量级）。遇到这种，换同校的另一个栏目：很多学校的「信息公开」「新闻网」「招生网」仍是静态页。

## 四、常见 CMS 配方

不同学校用的建站系统就那么几家，结构高度相似。先按下面试，命中率很高。

### 博达（最常见，如复旦、川大、多数 985/211）

列表页源码里能看到 `wp_article_list` / `wp_article_list_table`：

```yaml
list:
  item: "table.wp_article_list_table tr"
  title: "a"
  link: "a"
  date: "td.ti"          # 有的是 span.time，看源码
```

或 `<ul class="wp_article_list">`：

```yaml
list:
  item: "ul.wp_article_list li"
  title: "a"
  link: "a"
  date: "span.time"
```

### 表格布局（如武大、部分学院站）

一行一条、日期单独一列：

```yaml
list:
  item: "div.table tr"
  title: "a"
  link: "a"
  date: "td:nth-child(3)"   # 第几列放日期就写几
```

### 自建站 / 就业系统（如川大就业网）

```yaml
list:
  item: "div#mycontent li"
  title: "a"
  link: "a"
  date: "span.list1_time"
```

### WordPress

```yaml
list:
  item: "article"
  title: "h2 a"
  link: "h2 a"
  date: "time"
```

### 织梦 DedeCMS

```yaml
list:
  item: "ul.list li"
  title: "a"
  link: "a"
  date: "span"
```

## 五、排错表

| 现象 | 原因 | 改法 |
|---|---|---|
| 解析 0 条 | 选择器不匹配 / JS 渲染 / 需要登录 | 先 `inspect`；再确认源码里有没有内容 |
| 只抓到导航链接 | `item` 太宽（如直接写 `li`） | 加外层限定：`div.news-list li` |
| 条目数比页面少很多 | 每行有多个 `<a>`（图片链接、附件） | `title` 写成更具体的选择器，如 `a.tit` |
| 中文乱码 | 站点是 GBK 且没声明 | 加 `charset: gbk` |
| 请求 403 | 需要 Referer / UA / Cookie | `headers: { Referer: "https://学校首页" }` |
| 日期全空 | 日期在选择器外或用了特殊格式 | 补 `list.date`，或删掉让脚本从整条文字猜 |
| 同一条通告推两次 | 同一内容发在两个栏目 | 已按标题在页面内去重；跨栏目请合并成一个 site 用 `urls` |
| 只抓到第一页 | 列表分页 | 用 `urls: [第1页, 第2页]`，或用 `?page=2` 拼几页 |

## 六、CSS 选择器速查

| 写法 | 含义 |
|---|---|
| `div.news li` | class 为 news 的 div 里的所有 li |
| `ul#list li` | id 为 list 的 ul 里的 li |
| `table tr` | 所有行 |
| `td:nth-child(3)` | 每行第 3 个单元格 |
| `a[href$=".htm"]` | 以 .htm 结尾的链接 |
| `li:not(.first)` | 排除某一类 |

浏览器 F12 → 右键元素 → Copy → Copy selector，也能直接拿到一个能用的选择器（通常偏长，可以自己简化）。

## 七、验证顺序

```bash
node src/cli.js test --site "你的站点名"   # 看条数、日期、标题对不对
node src/cli.js doctor                     # 看日期覆盖率、0 命中等提醒
node src/cli.js run --dry-run --no-email --preview out/preview.html
```

三步都通过，再配邮箱正式跑。

调好之后欢迎把配置提到 `examples/`，附上学校和栏目名，别人能少走一遍。
