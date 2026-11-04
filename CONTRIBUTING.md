# 参与贡献

谢谢愿意帮忙。这个项目最需要两类贡献：**新的学校配置**和**解析踩坑经验**。

## 环境

```bash
git clone <repo> && cd notice-radar
npm ci
npm test          # 38 个单测，不需要网络
node src/cli.js demo
```

Node ≥ 20。项目只依赖 4 个库（cheerio / yaml / nodemailer / iconv-lite），加新依赖前请先开 issue 讨论。

## 提交一个学校的配置（最有价值）

1. 用 `inspect` 调好选择器，`doctor` 确认日期覆盖率和条数正常
2. 复制 `examples/scu.yaml` 改成你的学校，文件名用学校缩写：`examples/xxx.yaml`
3. 在 `examples/README.md` 的表格里加一行，注明学校、栏目、CMS 类型
4. 提 PR，标题写 `config: 新增 XX 大学 XX 栏目`

配置里**不要**带真实邮箱、Cookie、学号等个人信息；`email.enabled` 保持 `false`。

## 修 bug / 加功能

- 先开 issue 描述现象，附 `doctor` 输出和出错站点的 URL（公开页面）
- 修完请补单测：解析类放 `test/parse.test.js`，匹配放 `test/match.test.js`
- 涉及网络的行为，测试里请用 fixture，不要在 CI 里打真实站点（会 flaky）

## 代码约定

- ESM、2 空格、单引号、语句结尾分号
- 用户可见的提示一律中文，且要能指导下一步操作（写「选择器失效，跑 inspect」而不是「解析错误」）
- 抛错时带上足够上下文：站点名、选择器、URL
- 不要引入需要编译/系统依赖的库

## 提交信息

```
feat: 支持按 urls 配置多个列表页
fix: 博达表格布局下日期识别为空
docs: 补充 163 邮箱授权码步骤
config: 新增 XX 大学教务处
test: 覆盖相对时间解析
```

## PR 检查清单

- [ ] `npm test` 全绿
- [ ] 新增/修改的行为有单测覆盖
- [ ] 更新了相关文档（README / docs）
- [ ] 没有提交 `.env`、`node_modules`、真实邮箱
