import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalUrl, parseDate, normalizeForMatch, formatDateTime } from '../src/util.js';

test('canonicalUrl：去掉锚点、跟踪参数并排序', () => {
  assert.equal(
    canonicalUrl('https://a.edu.cn/info/1.htm?utm_source=x&b=2&a=1#top'),
    'https://a.edu.cn/info/1.htm?a=1&b=2',
  );
});

test('canonicalUrl：相对链接按页面地址解析', () => {
  assert.equal(
    canonicalUrl('../28/3d/c1/page.htm', 'https://jwc.fudan.edu.cn/9397/list.htm'),
    'https://jwc.fudan.edu.cn/28/3d/c1/page.htm',
  );
});

test('canonicalUrl：javascript/空链接返回空串', () => {
  assert.equal(canonicalUrl('javascript:void(0)'), '');
  assert.equal(canonicalUrl('#'), '');
});

test('parseDate：支持多种写法', () => {
  assert.equal(parseDate('2026-10-28'), '2026-10-28');
  assert.equal(parseDate('2026年10月28日'), '2026-10-28');
  assert.equal(parseDate('2026/1/5'), '2026-01-05');
  assert.equal(parseDate('20261028'), '2026-10-28');
});

test('parseDate：只有月日时取最近的过去日期', () => {
  const now = new Date('2026-01-10T00:00:00Z');
  // 12-20 比今天晚，说明是去年发布的
  assert.equal(parseDate('12-20', now), '2025-12-20');
  // 03-05 同样晚于今天，取去年
  assert.equal(parseDate('03-05', now), '2025-03-05');

  const later = new Date('2026-12-20T00:00:00Z');
  // 12 月看 01-05，是今年年初发的
  assert.equal(parseDate('01-05', later), '2026-01-05');
});

test('parseDate：非法日期返回 null', () => {
  assert.equal(parseDate('2026-13-40'), null);
  assert.equal(parseDate('没有日期'), null);
});

test('normalizeForMatch：全角转半角并小写', () => {
  assert.equal(normalizeForMatch('ＡＢＣ　测试'), 'abc 测试');
});

test('formatDateTime：按上海时区格式化', () => {
  const d = new Date('2026-06-01T00:30:00Z');
  assert.equal(formatDateTime(d, 'Asia/Shanghai'), '2026-06-01 08:30');
});
