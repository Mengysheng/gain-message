#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, assertEmailConfig } from './config.js';
import { fetchPage, mapLimit } from './fetch.js';
import { parseList, parseDetail } from './parse.js';
import { compileRules, matchItem } from './match.js';
import {
  emptyState,
  isFirstRun,
  isSeen,
  loadState,
  markSeen,
  pruneState,
  saveState,
  touchSite,
} from './store.js';
import {
  buildSubject,
  renderDigest,
  renderDigestText,
  sendMail,
  verifySmtp,
} from './mail.js';
import { writeMarkdownExport } from './export.js';
import { inspectHtml, formatInspect } from './inspect.js';
import { formatDateTime, log, logError, truncate } from './util.js';

const HELP = `通告雷达 notice-radar

用法：
  node src/cli.js doctor [--smtp]           体检：配置能不能用、每个站点解析是否正常、日期覆盖率
  node src/cli.js inspect <url>            探测某个页面的列表选择器（配置新站点时用）
  node src/cli.js demo [--out 文件]         离线演示：用自带的样例页面生成一封邮件预览，不联网
  node src/cli.js test [--site 名称]        只解析、只打印，不改状态、不发邮件
  node src/cli.js run [选项]                正式检查：抓取 → 匹配 → 发邮件 / 写汇总 → 存状态
  node src/cli.js check-smtp               用当前配置验证邮箱能否登录（会真连服务器）
  node src/cli.js send-test                发一封测试邮件，不抓取、不改状态（验证发信通道）

run 的选项：
  --dry-run        不发邮件、不写状态（用来预览会推什么）
  --no-email       不发邮件，只写 Markdown 汇总
  --no-export      不写 Markdown 汇总
  --init           把当前列表里的条目全部标记为已读，不推送（首次订阅想从零开始时用）
  --site <名称>     只跑指定站点（可多次）
  --strict         有站点抓取失败时以退出码 2 结束（让 GitHub Actions 变红）
  --preview <文件>  把邮件渲染成 HTML 存下来，方便在浏览器看效果
  --verbose        打印每条条目的匹配详情

通用选项：
  --config <路径>   配置文件，默认 config.yaml
  --limit <数字>    test 命令最多打印多少条
  --json            test / doctor 输出 JSON（方便脚本处理）
  -h, --help       显示帮助
`;

function parseArgs(argv) {
  const args = { _: [], sites: [], flags: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--') && token !== '-h') {
      args._.push(token);
      continue;
    }
    if (token === '-h' || token === '--help') {
      args.flags.help = true;
      continue;
    }
    const name = token.replace(/^--/, '');
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      if (name === 'site') args.sites.push(next);
      else args.flags[name] = next;
      i += 1;
    } else {
      args.flags[name] = true;
    }
  }
  return args;
}

function requireConfig(args) {
  return loadConfig(args.flags.config || 'config.yaml');
}

function printItemLine(item, mark) {
  const date = item.date || '----------';
  const title = truncate(item.title, 46);
  console.log(`  ${mark} ${date}  ${title}`);
  if (item.keywords?.length) console.log(`      命中：${item.keywords.join(' / ')}`);
  console.log(`      ${item.url}`);
}

async function cmdInspect(args) {
  const url = args._[1];
  if (!url) {
    logError('用法：node src/cli.js inspect <url>');
    process.exit(1);
  }
  log(`抓取 ${url} …`);
  const proxy = args.flags.proxy || process.env.FETCH_PROXY || '';
  if (proxy) log(`走代理：${proxy}`);
  const page = await fetchPage(url, { charset: 'auto', timeout: 20000, proxy });
  const ranked = inspectHtml(page.html, page.finalUrl || url);
  if (args.flags.json) {
    console.log(JSON.stringify(ranked, null, 2));
    return;
  }
  console.log(formatInspect(ranked, page.finalUrl || url));
}

async function prepareSite(config, site, state, { withDetail = true } = {}) {
  const urls = Array.isArray(site.urls) && site.urls.length ? site.urls : [site.url];
  const proxy = site.proxy || process.env.FETCH_PROXY || '';
  const collected = [];
  let pageUrl = urls[0];
  let lastError = null;

  for (const url of urls) {
    try {
      const page = await fetchPage(url, {
        charset: site.charset || 'auto',
        timeout: config.request?.timeout ?? 20000,
        retries: config.request?.retries ?? 3,
        headers: site.headers || {},
        proxy,
      });
      pageUrl = page.finalUrl || url;
      collected.push(...parseList(page.html, site, pageUrl));
    } catch (error) {
      lastError = error;
      if (urls.length === 1) throw error;
    }
  }

  // 多个列表页时按链接去重
  const deduped = [];
  const seenUrls = new Set();
  for (const item of collected) {
    if (seenUrls.has(item.url)) continue;
    seenUrls.add(item.url);
    deduped.push(item);
  }

  const all = deduped;
  if (!all.length) {
    throw new Error(
      lastError
        ? `抓取失败：${lastError.message}`
        : `没有解析到任何条目（list.item = "${site.list?.item}"）。页面可能改版、需要登录，或需要 JS 渲染`,
    );
  }

  const maxItems = site.max_items ?? 40;
  const firstRun = isFirstRun(state, site.name);
  const candidates = all.slice(0, maxItems);

  const fresh = firstRun ? candidates : candidates.filter((item) => !isSeen(state, site.name, item.url));

  const rules = compileRules(config.keywords, site.keywords);
  const detailCfg = site.detail || {};
  const needContent = rules.matchIn === 'title+content' && detailCfg.enabled !== false;

  const matches = [];

  if (needContent && withDetail) {
    const cap = Math.min(fresh.length, detailCfg.max_items ?? 15);
    const targets = fresh.slice(0, cap);
    await mapLimit(targets, config.request?.concurrency ?? 3, async (item) => {
      try {
        const detailPage = await fetchPage(item.url, {
          charset: site.charset || 'auto',
          timeout: config.request?.timeout ?? 20000,
          retries: 1,
          headers: site.headers || {},
          proxy,
        });
        item.content = parseDetail(detailPage.html, detailCfg.content, detailCfg.max_chars ?? 2000);
      } catch (error) {
        item.content = '';
        if (process.env.RADAR_DEBUG) logError(`详情抓取失败 ${item.url}：${error.message}`);
      }
      return item;
    });
  }

  for (const item of fresh) {
    const result = matchItem(item, rules);
    if (!result.hit) continue;
    matches.push({ ...item, keywords: result.keywords, excerpt: item.content || '' });
  }

  // 标题命中但正文没抓的，按需补一次详情，用于摘要
  if (!needContent && detailCfg.enabled && matches.length) {
    const cap = Math.min(matches.length, detailCfg.max_items ?? 5);
    await mapLimit(matches.slice(0, cap), config.request?.concurrency ?? 3, async (item) => {
      try {
        const detailPage = await fetchPage(item.url, {
          charset: site.charset || 'auto',
          timeout: config.request?.timeout ?? 20000,
          retries: 1,
          headers: site.headers || {},
          proxy,
        });
        item.excerpt = parseDetail(detailPage.html, detailCfg.content, detailCfg.max_chars ?? 2000);
      } catch {
        item.excerpt = '';
      }
      return item;
    });
  }

  // 首次运行：附上最近若干条做样例，让用户确认解析是否正确（已命中的不重复列）
  let samples = [];
  if (firstRun && (config.first_run?.mode ?? 'digest') === 'digest') {
    const matchedUrls = new Set(matches.map((item) => item.url));
    samples = candidates
      .filter((item) => !matchedUrls.has(item.url))
      .slice(0, config.first_run?.limit ?? 5)
      .map((item) => ({ ...item, keywords: [], isSample: true }));
  }

  return {
    site,
    firstRun,
    candidates,
    fresh,
    matches,
    samples,
    rules,
    pageUrl,
  };
}

async function cmdTest(args) {
  const config = requireConfig(args);
  const state = emptyState(); // 用空 state，保证每条都展示
  const limit = Number(args.flags.limit || 20);
  const sites = config.sites.filter((s) => !args.sites.length || args.sites.includes(s.name));
  const json = Boolean(args.flags.json);
  const report = [];

  for (const site of sites) {
    const siteUrls = Array.isArray(site.urls) && site.urls.length ? site.urls : [site.url];
    const entry = { name: site.name, urls: siteUrls, ok: true, items: 0, hits: 0, rows: [], error: null };

    if (!json) {
      console.log(`\n== ${site.name} ==`);
      for (const siteUrl of siteUrls) console.log(`   ${siteUrl}`);
    }

    try {
      const result = await prepareSite(config, site, state, { withDetail: true });
      entry.items = result.candidates.length;
      entry.hits = result.matches.length;
      entry.rows = result.candidates.slice(0, limit).map((item) => ({
        title: item.title,
        url: item.url,
        date: item.date,
        hit: result.matches.some((m) => m.url === item.url),
      }));

      if (!json) {
        console.log(`   解析 ${result.candidates.length} 条，命中 ${result.matches.length} 条`);
        console.log(`   选择器：item="${site.list.item}"`);
        for (const item of result.candidates.slice(0, limit)) {
          const hit = result.matches.find((m) => m.url === item.url);
          printItemLine(item, hit ? '✓' : '·');
        }
        if (result.candidates.length > limit) {
          console.log(`   …还有 ${result.candidates.length - limit} 条（--limit 可以多打一些）`);
        }
      }
    } catch (error) {
      entry.ok = false;
      entry.error = error.message;
      if (!json) console.log(`   ✗ 失败：${error.message}`);
      process.exitCode = 1;
    }
    report.push(entry);
  }

  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const totalItems = report.reduce((sum, r) => sum + r.items, 0);
  const totalHits = report.reduce((sum, r) => sum + r.hits, 0);
  console.log(`\n合计：解析 ${totalItems} 条，命中 ${totalHits} 条`);
  console.log('（test 模式不改状态、不发邮件；确认无误后跑 node src/cli.js run）');
}

async function cmdDoctor(args) {
  const config = requireConfig(args);
  const sites = config.sites.filter((s) => !args.sites.length || args.sites.includes(s.name));
  const json = Boolean(args.flags.json);
  const report = [];
  let failed = 0;

  if (!json) {
    console.log(`配置：${path.resolve(args.flags.config || 'config.yaml')}`);
    console.log(`站点：${sites.length} 个｜关键词：${(config.keywords?.include || []).join(' / ') || '（无）'}`);
  }

  for (const site of sites) {
    const siteUrls = Array.isArray(site.urls) && site.urls.length ? site.urls : [site.url];
    const entry = {
      name: site.name,
      urls: siteUrls,
      ok: false,
      items: 0,
      hits: 0,
      dateCoverage: 0,
      warnings: [],
      samples: [],
      error: null,
    };

    if (!json) console.log(`\n检查 ${site.name} …`);

    try {
      const result = await prepareSite(config, site, emptyState(), { withDetail: false });
      const items = result.candidates;
      const dated = items.filter((item) => item.date).length;

      entry.ok = true;
      entry.items = items.length;
      entry.hits = result.matches.length;
      entry.dateCoverage = items.length ? Number((dated / items.length).toFixed(2)) : 0;
      entry.samples = items.slice(0, 3).map((item) => `${item.date || '无日期'}  ${item.title}`);

      if (items.length < 3) entry.warnings.push('解析到的条目少于 3 条，确认这个页面是不是列表页');
      if (entry.dateCoverage < 0.5) {
        entry.warnings.push(`只有 ${Math.round(entry.dateCoverage * 100)}% 的条目能识别日期，建议补 list.date 选择器`);
      }
      if (result.matches.length === 0) {
        entry.warnings.push('当前关键词规则下 0 命中（可能只是最近没有相关通告，不一定是配置错）');
      }
      if (items.some((item) => /^https?:\/\//.test(item.url) === false)) {
        entry.warnings.push('有条目链接没能补全成绝对地址，检查 list.link 选择器');
      }
    } catch (error) {
      entry.error = error.message;
      failed += 1;
    }
    report.push(entry);

    if (!json) {
      if (entry.ok) {
        console.log('✓ 解析正常');
        console.log(`   ${entry.items} 条，日期覆盖 ${Math.round(entry.dateCoverage * 100)}%，命中 ${entry.hits} 条`);
        for (const sample of entry.samples) console.log(`   · ${sample}`);
      } else {
        console.log('✗ 解析失败');
        console.log(`   ${entry.error}`);
      }
      for (const warning of entry.warnings) console.log(`   ⚠ ${warning}`);
    }
  }

  if (args.flags.smtp) {
    try {
      assertEmailConfig(config);
      await verifySmtp(config);
      report.push({ name: 'SMTP', ok: true, warnings: [], samples: [`收件人：${(config.email.to || []).join(', ')}`] });
      if (!json) console.log(`\n✓ SMTP 登录成功，收件人：${(config.email.to || []).join(', ')}`);
    } catch (error) {
      report.push({ name: 'SMTP', ok: false, error: error.message, warnings: [], samples: [] });
      failed += 1;
      if (!json) console.log(`\n✗ SMTP：${error.message}`);
    }
  }

  if (json) {
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = failed ? 2 : 0;
    return;
  }

  console.log('\n---------- 体检结论 ----------');
  const okCount = report.filter((entry) => entry.ok && entry.name !== 'SMTP').length;
  console.log(`${okCount}/${sites.length} 个站点解析正常${failed ? `，${failed} 项需要处理` : ''}`);
  if (failed) {
    console.log('解析失败的：先用 inspect 重新生成选择器，见 docs/selector.md');
    process.exitCode = 2;
  } else {
    console.log('下一步：node src/cli.js run --dry-run --no-email --preview out/preview.html');
  }
}

async function cmdDemo(args) {
  const demoDir = path.resolve('examples', 'demo');
  const configPath = path.join(demoDir, 'demo.yaml');
  const htmlPath = path.join(demoDir, 'list.html');
  if (!fs.existsSync(configPath) || !fs.existsSync(htmlPath)) {
    throw new Error(`找不到演示文件：${demoDir}（是不是把 examples/ 删了？）`);
  }

  const config = loadConfig(configPath);
  const site = config.sites[0];
  const html = fs.readFileSync(htmlPath, 'utf8');
  const items = parseList(html, site, site.url);
  const rules = compileRules(config.keywords, site.keywords);

  const matched = items
    .map((item) => {
      const result = matchItem(item, rules);
      return { ...item, keywords: result.keywords, hit: result.hit };
    })
    .filter((item) => item.hit)
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

  const generatedAt = formatDateTime(new Date(), config.timezone);
  const groups = matched.length ? [{ name: site.name, url: site.url, items: matched }] : [];
  const html2 = renderDigest({
    groups,
    generatedAt: `${generatedAt}（离线演示数据）`,
    siteCount: 1,
    errors: [],
    timezone: config.timezone,
  });

  const target = path.resolve(String(args.flags.out || path.join(config.export?.dir || 'out', 'demo.html')));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, html2, 'utf8');

  console.log(`演示站点：${site.name}`);
  console.log(`解析 ${items.length} 条，命中 ${matched.length} 条（关键词：${(config.keywords?.include || []).join(' / ')}）`);
  for (const item of matched) console.log(`  ✓ ${item.date || '----------'}  ${truncate(item.title, 40)}  命中：${item.keywords.join(' / ')}`);
  console.log(`\n邮件预览已写入：${target}`);
  console.log('用浏览器打开看看效果；这个命令不联网、不发信，只证明流程是通的。');
}

async function cmdCheckSmtp(args) {
  const config = requireConfig(args);
  assertEmailConfig(config);
  log(`连接 ${config.email.smtp.host}:${config.email.smtp.port} …`);
  try {
    await verifySmtp(config);
    log(`SMTP 登录成功，收件人：${(config.email.to || []).join(', ')}`);
  } catch (error) {
    logError(`SMTP 验证失败：${error.message}`);
    process.exit(1);
  }
}

/**
 * 只验证发信通道：用假数据渲染一封邮件发出去，不抓取、不改状态。
 * 用来回答「到底是我没收到，还是它没发出来」。
 */
async function cmdSendTest(args) {
  const config = requireConfig(args);
  assertEmailConfig(config);

  const generatedAt = formatDateTime(new Date(), config.timezone);
  const groups = [
    {
      name: '测试站点（数据是假的，只验证发信）',
      url: 'https://example.edu.cn/notice',
      items: [
        {
          title: '关于2027年春季学期校际交换生选拔工作的通知',
          url: 'https://example.edu.cn/1.htm',
          date: '2026-11-05',
          keywords: ['交换'],
        },
        {
          title: '综合研究实习生【示例公司】',
          url: 'https://example.edu.cn/2.htm',
          date: '2026-11-04',
          keywords: ['实习'],
          excerpt: '这是一封测试邮件的示例摘要，用于确认邮件排版、高亮和链接都正常。',
        },
      ],
    },
  ];

  const html = renderDigest({
    groups,
    generatedAt: `${generatedAt}（测试邮件）`,
    siteCount: 0,
    errors: [],
    timezone: config.timezone,
  });
  const text = renderDigestText({ groups, generatedAt, siteCount: 0, errors: [] });
  const subject = `${config.email.subject_prefix || '[通告雷达]'} 测试邮件：发信通道正常`;

  await sendMail(config, { subject, html, text });
  log(`测试邮件已发送到：${(config.email.to || []).join(', ')}`);
  log('收到就说明 SMTP、收件地址、邮件排版都正常；没收到先查垃圾箱。');
}

async function cmdRun(args) {
  const config = requireConfig(args);
  const state = loadState(config.state_file);
  const dryRun = Boolean(args.flags['dry-run']);
  const noEmail = Boolean(args.flags['no-email']);
  const noExport = Boolean(args.flags['no-export']);
  const initOnly = Boolean(args.flags.init);
  const willEmail = config.email?.enabled && !noEmail && !dryRun;
  if (willEmail) assertEmailConfig(config);
  const now = new Date();
  const generatedAt = formatDateTime(now, config.timezone);
  const sites = config.sites.filter((s) => !args.sites.length || args.sites.includes(s.name));

  const groups = [];
  const errors = [];
  const checked = [];

  for (const site of sites) {
    try {
      const result = await prepareSite(config, site, state);
      checked.push({ site, result });

      const items = [...result.matches];
      if (result.samples.length) items.push(...result.samples);
      items.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

      if (items.length) {
        groups.push({
          name: site.name,
          url: result.pageUrl,
          items,
          firstRun: result.firstRun,
        });
      }

      if (!dryRun) {
        for (const item of result.candidates) markSeen(state, site.name, item);
        touchSite(state, site.name, {
          lastRun: now.toISOString(),
          lastOk: now.toISOString(),
          lastError: null,
          lastCount: result.candidates.length,
        });
      }

      log(
        `${site.name}：解析 ${result.candidates.length} 条，新增 ${result.fresh.length} 条，命中 ${result.matches.length} 条${
          result.samples.length ? `，首次样例 ${result.samples.length} 条` : ''
        }`,
      );
    } catch (error) {
      errors.push({ name: site.name, message: error.message });
      if (!dryRun) {
        touchSite(state, site.name, {
          lastRun: now.toISOString(),
          lastError: error.message,
        });
      }
      logError(`${site.name} 失败：${error.message}`);
    }
  }

  const total = groups.reduce((sum, group) => sum + group.items.length, 0);
  const totalHits = groups.reduce((sum, group) => sum + group.items.filter((i) => !i.isSample).length, 0);
  const totalSamples = total - totalHits;

  if (initOnly) {
    if (!dryRun) {
      const removed = pruneState(state, config.retention_days ?? 120);
      saveState(config.state_file, state);
      log(`已初始化：标记 ${checked.reduce((n, c) => n + c.result.candidates.length, 0)} 条为已读（清理 ${removed} 条过期记录）`);
    }
    return;
  }

  if (!noExport && config.export?.enabled) {
    const files = writeMarkdownExport(
      config,
      { groups, generatedAt, siteCount: sites.length, errors },
      now,
    );
    log(`汇总已写入：${files.join('、')}`);
  }

  // 把邮件渲染成 HTML 存下来，方便在浏览器里看效果（不发信）
  if (args.flags.preview) {
    const previewHtml = renderDigest({
      groups,
      generatedAt,
      siteCount: sites.length,
      errors,
      timezone: config.timezone,
    });
    const target = path.resolve(String(args.flags.preview));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, previewHtml, 'utf8');
    log(`邮件预览已写入：${target}`);
  }

  const shouldEmail =
    config.email?.enabled &&
    !noEmail &&
    !dryRun &&
    (totalHits > 0 || totalSamples > 0 || (errors.length && config.email.send_on_error !== false));

  if (shouldEmail) {
    if (config.email.mode === 'per_item' && totalHits > 0) {
      for (const group of groups) {
        for (const item of group.items.filter((i) => !i.isSample)) {
          const html = renderDigest({
            groups: [{ ...group, items: [item] }],
            generatedAt,
            siteCount: sites.length,
            errors: [],
            timezone: config.timezone,
          });
          const text = renderDigestText({
            groups: [{ ...group, items: [item] }],
            generatedAt,
            siteCount: sites.length,
            errors: [],
          });
          await sendMail(config, {
            subject: buildSubject(config, { hits: 1 }, [group.name]),
            html,
            text,
          });
        }
      }
      log(`已发送 ${totalHits} 封逐条邮件`);
    } else {
      const html = renderDigest({ groups, generatedAt, siteCount: sites.length, errors, timezone: config.timezone });
      const text = renderDigestText({ groups, generatedAt, siteCount: sites.length, errors });
      const subject = buildSubject(
        config,
        { hits: totalHits, samples: totalSamples, errors: errors.length },
        groups.map((g) => g.name),
      );
      await sendMail(config, { subject, html, text });
      log(`邮件已发送：${subject}`);
    }
  } else if (total > 0 || errors.length) {
    log(`跳过发送（${dryRun ? 'dry-run' : noEmail ? '--no-email' : 'email 未启用'}）`);
  }

  if (!dryRun) {
    const removed = pruneState(state, config.retention_days ?? 120);
    saveState(config.state_file, state);
    log(`状态已保存：${config.state_file}（清理 ${removed} 条过期记录）`);
  }

  console.log('');
  console.log('---------- 本次结果 ----------');
  for (const group of groups) {
    console.log(`${group.name}：${group.items.length} 条${group.firstRun ? '（首次订阅样例）' : ''}`);
    for (const item of group.items) printItemLine(item, '•');
  }
  for (const error of errors) console.log(`✗ ${error.name}：${error.message}`);
  if (!groups.length && !errors.length) console.log('没有需要推送的新通告。');

  // 部分站点失败属于正常波动：照常算成功，只在 Summary 里提示。
  // 只有「全部站点都失败」才让工作流变红，避免一次网络抖动就报红。
  if (errors.length) {
    const allFailed = errors.length === sites.length;
    writeStepSummary(
      [
        allFailed ? '## ❌ 所有站点都抓取失败了' : `## ⚠️ ${errors.length} 个站点这次没抓到（其他站点正常）`,
        '',
        '| 站点 | 原因 |',
        '|---|---|',
        ...errors.map((error) => `| ${escapeCell(error.name)} | ${escapeCell(error.message)} |`),
        '',
        allFailed
          ? '多半是网络问题或页面改版。偶发可等下次；持续失败就跑 `node src/cli.js inspect <url>` 重新生成选择器。'
          : '这些站点本次跳过了，其他站点的推送不受影响。偶发失败下次会自动补上（去重状态没标记它们）。',
      ].join('\n'),
    );
    if (args.flags.strict && allFailed) process.exitCode = 2;
  }
}

function escapeCell(text) {
  return String(text ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

/** 把结论写进 GitHub Actions 的 Job Summary，不用翻日志也能看到失败原因 */
function writeStepSummary(markdown) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  try {
    fs.appendFileSync(file, `${markdown}\n`);
  } catch {
    // 摘要写不进去不影响主流程
  }
}

function failureAdvice(message) {
  if (/邮件配置不完整|smtp\.pass|smtp\.user/.test(message)) {
    return [
      '### 怎么修',
      '',
      '在仓库 **Settings → Secrets and variables → Actions** 里补齐这 5 个 Secret：',
      '',
      '`SMTP_HOST`、`SMTP_PORT`、`SMTP_USER`、`SMTP_PASS`、`MAIL_TO`',
      '',
      'QQ 邮箱的 `SMTP_PASS` 是**授权码**（设置 → 账号 → 开启 SMTP 服务），不是登录密码。',
    ].join('\n');
  }
  if (/Invalid login|535|EAUTH/i.test(message)) {
    return [
      '### 怎么修',
      '',
      'SMTP 登录被拒绝，通常是：',
      '',
      '1. `SMTP_PASS` 填成了登录密码而不是授权码',
      '2. 邮箱没开启 SMTP 服务',
      '3. 端口与 `SMTP_SECURE` 不匹配（465 配 true，587 配 false）',
    ].join('\n');
  }
  return [
    '### 怎么修',
    '',
    '- 抓取类错误：本地跑 `node src/cli.js inspect <url>` 重新生成选择器',
    '- 配置类错误：本地跑 `node src/cli.js doctor` 看具体哪项不通过',
  ].join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];

  if (!command || args.flags.help) {
    console.log(HELP);
    return;
  }

  try {
    if (command === 'inspect') return await cmdInspect(args);
    if (command === 'doctor') return await cmdDoctor(args);
    if (command === 'demo') return await cmdDemo(args);
    if (command === 'test') return await cmdTest(args);
    if (command === 'run') return await cmdRun(args);
    if (command === 'check-smtp') return await cmdCheckSmtp(args);
    if (command === 'send-test') return await cmdSendTest(args);
    console.log(`未知命令：${command}\n`);
    console.log(HELP);
    process.exitCode = 1;
  } catch (error) {
    logError(error.message);
    writeStepSummary(['## ❌ 运行失败', '', '```', String(error.message), '```', '', failureAdvice(error.message)].join('\n'));
    if (error.isConfigError) process.exitCode = 1;
    else if (process.env.RADAR_DEBUG) console.error(error);
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
