import * as cheerio from 'cheerio';
import { normalizeText, truncate } from './util.js';

const DATE_RE = /20\d{2}\s*[-/.年]\s*\d{1,2}\s*[-/.月]\s*\d{1,2}|\b\d{1,2}\s*[-/.月]\s*\d{1,2}\s*日?\b/;
const NOISE = /^(more|more>|详情|查看|下一页|上一页|首页|尾页|返回|登录|注册)$/i;

function safeClass(name) {
  return String(name || '')
    .trim()
    .split(/\s+/)
    .filter((c) => /^[A-Za-z_][\w-]*$/.test(c))
    .slice(0, 1);
}

function nodeSelector(tag, id, classes) {
  if (id && /^[A-Za-z_][\w-]*$/.test(id)) return `${tag}#${id}`;
  const cls = safeClass(classes).map((c) => `.${c}`).join('');
  return `${tag}${cls}`;
}

function buildPath($, el, depth = 2) {
  const tag = el.name;
  const classes = el.attribs?.class;
  // 条目自身通常带唯一的 id（如 tr#line_u12_0），会破坏分组，所以只用标签 + 第一个 class
  const selfSelector = nodeSelector(tag, null, classes);

  let parent = el.parent;
  let hops = 0;
  while (parent && parent.type === 'tag' && hops < depth) {
    if (['html', 'body'].includes(parent.name)) break;
    const parentId = parent.attribs?.id;
    const parentClass = parent.attribs?.class;
    if (parentId || parentClass) {
      return `${nodeSelector(parent.name, parentId, parentClass)} ${selfSelector}`;
    }
    parent = parent.parent;
    hops += 1;
  }
  return selfSelector;
}

function anchorText($, el) {
  return normalizeText($(el).attr('title') || $(el).text());
}

function isContentLink($, el) {
  const href = $(el).attr('href') || '';
  if (!href || href === '#' || /^(javascript:|mailto:|tel:)/i.test(href)) return false;
  const text = anchorText($, el);
  if (text.length < 6) return false;
  if (NOISE.test(text)) return false;
  if (!/[\u4e00-\u9fa5]/.test(text)) return false;
  return true;
}

function detectDateSelector($, itemEl) {
  let best = null;
  $(itemEl)
    .find('*')
    .each((_, el) => {
      const text = normalizeText($(el).text());
      if (!text || text.length > 24) return;
      if (!DATE_RE.test(text)) return;
      const cls = String(el.attribs?.class || '');
      let score = 40 - text.length;
      if (/time|date|riqi|day/i.test(cls)) score += 25;
      if (!$(el).children().length) score += 10;
      if (!best || score > best.score) best = { score, el, text };
    });
  if (!best) return null;
  const el = best.el;
  const tag = el.name;
  const id = el.attribs?.id;
  const cls = safeClass(el.attribs?.class);
  if (id && /^[A-Za-z_][\w-]*$/.test(id)) return `${tag}#${id}`;
  if (cls.length) return `${tag}.${cls[0]}`;
  return null;
}

/**
 * 猜测列表页的 item / title / link / date 选择器。
 * 思路：把所有「像通告的链接」按最近的列表容器分组，看哪组数量多、带日期的比例高。
 */
export function inspectHtml(html, pageUrl) {
  const $ = cheerio.load(html);
  $('script, style, noscript').remove();

  const groups = new Map();

  $('a[href]').each((_, el) => {
    if (!isContentLink($, el)) return;
    // 取「最近的列表容器」：tr 优先于 li（表格布局的公告栏很常见）
    const parents = $(el)
      .parents()
      .filter((_, node) => ['tr', 'li', 'dd', 'article'].includes(node.name))
      .toArray();
    const container = parents[0] || $(el).parent().get(0);
    if (!container) return;

    const selector = buildPath($, container, 10);
    if (!selector) return;

    const itemText = normalizeText($(container).text());
    const entry = groups.get(selector) || {
      selector,
      count: 0,
      dated: 0,
      samples: [],
      container,
      textLength: 0,
    };
    entry.count += 1;
    if (DATE_RE.test(itemText)) entry.dated += 1;
    entry.textLength += itemText.length;
    if (entry.samples.length < 3) entry.samples.push(anchorText($, el));
    groups.set(selector, entry);
    if (process.env.RADAR_DEBUG) console.error('candidate', selector, entry.count);
  });

  const ranked = [...groups.values()]
    .filter((group) => group.count >= 3)
    .map((group) => {
      const dateRatio = group.dated / group.count;
      const avgLen = group.textLength / group.count;
      const score = group.count * (1 + dateRatio * 1.5) * (avgLen > 20 ? 1 : 0.6);
      return { ...group, dateRatio, avgLen, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  return ranked.map((group) => {
    const dateSelector = detectDateSelector($, group.container);
    return {
      item: group.selector,
      title: 'a',
      link: 'a',
      date: dateSelector,
      count: group.count,
      dateRatio: Number(group.dateRatio.toFixed(2)),
      samples: group.samples.map((s) => truncate(s, 60)),
      url: pageUrl,
    };
  });
}

export function formatInspect(ranked, pageUrl) {
  if (!ranked.length) {
    return [
      `没有在 ${pageUrl} 里找到明显的通告列表。`,
      '可能原因：',
      '  1) 列表是 JS 动态渲染的（需要 Playwright 之类的浏览器抓取）',
      '  2) 站点需要登录',
      '  3) 页面结构比较特殊，可以手动写 list.item 选择器，参考 README「选择器怎么写」',
    ].join('\n');
  }

  const lines = [`为 ${pageUrl} 找到 ${ranked.length} 组候选，按可信度排序：`, ''];
  ranked.forEach((candidate, index) => {
    lines.push(`${index + 1}. 命中 ${candidate.count} 条，带日期 ${Math.round(candidate.dateRatio * 100)}%`);
    lines.push('   list:');
    lines.push(`     item: "${candidate.item}"`);
    lines.push(`     title: "${candidate.title}"`);
    lines.push(`     link: "${candidate.link}"`);
    if (candidate.date) lines.push(`     date: "${candidate.date}"`);
    for (const sample of candidate.samples) lines.push(`   示例：${sample}`);
    lines.push('');
  });
  lines.push('把上面 4~5 行粘贴到 config.yaml 对应站点的 list: 下面，然后跑：');
  lines.push('  node src/cli.js test');
  return lines.join('\n');
}
