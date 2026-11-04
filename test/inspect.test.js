import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectHtml } from '../src/inspect.js';
import { parseList } from '../src/parse.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const demoHtml = fs.readFileSync(path.join(here, '..', 'examples', 'demo', 'list.html'), 'utf8');

test('inspectHtml：能从列表页找出正确的 item 选择器', () => {
  const ranked = inspectHtml(demoHtml, 'https://example.edu.cn/notice');
  assert.ok(ranked.length > 0, '至少给出一组候选');
  const top = ranked[0];
  assert.match(top.item, /notice-list/);
  assert.equal(top.count, 8);
  assert.equal(top.dateRatio, 1);
  assert.equal(top.date, 'span.date');
});

test('inspectHtml：探测出来的选择器可以直接用来解析', () => {
  const [top] = inspectHtml(demoHtml, 'https://example.edu.cn/notice');
  const items = parseList(demoHtml, { list: top }, 'https://example.edu.cn/notice');
  assert.equal(items.length, 8);
  assert.equal(items[0].title, '关于2027年春季学期校际交换生选拔工作的通知');
  assert.equal(items[0].date, '2026-11-05');
});

test('inspectHtml：没有列表的页面返回空数组', () => {
  const ranked = inspectHtml('<html><body><p>空空如也</p></body></html>', 'https://example.edu.cn/');
  assert.deepEqual(ranked, []);
});
