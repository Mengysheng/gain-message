import test from 'node:test';
import assert from 'node:assert/strict';
import { parseList, parseDetail } from '../src/parse.js';

const HTML = `
<html><body>
<ul class="nav"><li><a href="/">首页</a></li><li><a href="/about">学校概况</a></li></ul>
<table class="wp_article_list_table">
  <tr><td><span class="time">2026-10-28</span><a href="/28/1/page.htm" title="关于2026年推免工作的通知">关于2026年推免工作的通知</a></td></tr>
  <tr><td><span class="time">2026-10-27</span><a href="/27/2/page.htm">关于期中退课的通知</a></td></tr>
  <tr><td><span class="time">2026-10-27</span><a href="/27/2/page.htm">关于期中退课的通知（重复）</a></td></tr>
  <tr><td><span class="time">2026-09-01</span><a href="javascript:void(0)">更多</a></td></tr>
</table>
<div class="wp_articlecontent">加载中，请稍后...</div>
</body></html>`;

const site = {
  list: { item: 'table.wp_article_list_table tr', title: 'a', link: 'a', date: 'span.time' },
};

test('parseList：提取标题、链接、日期', () => {
  const items = parseList(HTML, site, 'https://jwc.fudan.edu.cn/9397/list.htm');
  assert.equal(items.length, 2);
  assert.equal(items[0].title, '关于2026年推免工作的通知');
  assert.equal(items[0].url, 'https://jwc.fudan.edu.cn/28/1/page.htm');
  assert.equal(items[0].date, '2026-10-28');
  assert.equal(items[1].date, '2026-10-27');
});

test('parseList：按链接去重，忽略 javascript: 链接', () => {
  const items = parseList(HTML, site, 'https://jwc.fudan.edu.cn/9397/list.htm');
  const urls = items.map((i) => i.url);
  assert.equal(new Set(urls).size, urls.length);
  assert.ok(!urls.some((u) => u.startsWith('javascript')));
});

test('parseList：选择器没有匹配时返回空数组而不是抛错', () => {
  const items = parseList(HTML, { list: { item: 'table.not-exist tr' } }, 'https://a.edu.cn/');
  assert.deepEqual(items, []);
});

test('parseDetail：占位文案视为没有正文', () => {
  assert.equal(parseDetail(HTML, 'div.wp_articlecontent'), '');
});

test('parseDetail：正常正文会被截断', () => {
  const html = `<div class="content">${'通知内容'.repeat(50)}</div>`;
  const text = parseDetail(html, 'div.content', 60);
  assert.ok(text.length <= 61);
  assert.ok(text.startsWith('通知内容'));
});
