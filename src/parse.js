import * as cheerio from 'cheerio';
import { canonicalUrl, normalizeText, parseDate, truncate } from './util.js';

function pickNode($, $scope, selector) {
  if (!selector) return null;
  try {
    const found = $scope.is(selector) ? $scope : $scope.find(selector).first();
    return found.length ? found : null;
  } catch {
    return null;
  }
}

/**
 * 解析列表页，返回 [{title,url,date,rawDate}]。
 * 只要拿到「标题 + 链接」就能工作，日期取不到为 null。
 */
export function parseList(html, site, pageUrl) {
  const $ = cheerio.load(html);
  const cfg = site.list || {};
  const itemSelector = cfg.item || 'a';

  let nodes;
  try {
    nodes = $(itemSelector);
  } catch (error) {
    throw new Error(`list.item 选择器不合法：${itemSelector}（${error.message}）`);
  }
  if (!nodes.length) return [];

  const items = [];
  const seen = new Set();

  nodes.each((_, el) => {
    const $item = $(el);

    const $title = pickNode($, $item, cfg.title) || ($item.is('a') ? $item : $item.find('a').first());
    const $link = pickNode($, $item, cfg.link) || ($item.is('a') ? $item : $item.find('a').first());

    const rawTitle = normalizeText($title?.attr('title') || $title?.text() || '');
    const href = $link?.attr('href') || '';
    const url = canonicalUrl(href, pageUrl);

    if (!rawTitle || rawTitle.length < 2 || !url) return;
    // 纯图片链接、按钮文案的常见噪音
    if (/^(more|more>|详情|查看|下一页|上一页|首页|尾页)$/i.test(rawTitle)) return;

    const dateText = cfg.date ? normalizeText($item.find(cfg.date).first().text()) : '';
    const date = parseDate(dateText) || parseDate($item.text()) || null;

    const key = url;
    if (seen.has(key)) return;
    seen.add(key);

    items.push({
      title: rawTitle,
      url,
      date,
      rawDate: dateText || null,
    });
  });

  return items;
}

/** 抓详情页正文，用于「正文里也搜关键词」以及邮件摘要 */
export function parseDetail(html, selector, maxChars = 2000) {
  const $ = cheerio.load(html);
  $('script, style, noscript, iframe').remove();

  let node = selector ? $(selector).first() : null;
  if (!node || !node.length) {
    node = $('article').first();
    if (!node.length) node = $('body');
  }
  const text = normalizeText(node.text());
  // 很多学校详情页是 JS 动态渲染的，抓到的是「加载中，请稍后…」这类占位文案
  if (text.length < 40 || /^(加载中|正在加载|请稍后|loading)/i.test(text)) return '';
  return truncate(text, maxChars);
}

/** 从 HTML 中提取标题（用于邮件里展示详情页真实标题，可选） */
export function extractPageTitle(html) {
  const $ = cheerio.load(html);
  return normalizeText($('title').first().text()) || '';
}
