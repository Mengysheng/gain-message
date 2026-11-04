import test from 'node:test';
import assert from 'node:assert/strict';
import { renderDigest, renderDigestText, buildSubject } from '../src/mail.js';

const config = { email: { subject_prefix: '[通告雷达]' } };

const groups = [
  {
    name: 'A大学·教务处',
    url: 'https://a.edu.cn/list',
    items: [
      {
        title: '关于2027年春季学期校际交换生选拔工作的通知',
        url: 'https://a.edu.cn/1.htm',
        date: '2026-11-05',
        keywords: ['交换'],
      },
      {
        title: '关于2027届毕业生实习学分认定工作的通知',
        url: 'https://a.edu.cn/2.htm',
        date: '2026-11-02',
        keywords: ['实习'],
      },
      { title: '关于期中教学检查的通知', url: 'https://a.edu.cn/3.htm', date: '2026-11-01', isSample: true },
    ],
  },
];

test('renderDigest：命中数不含首次样例', () => {
  const html = renderDigest({ groups, generatedAt: '2026-11-06 08:00', siteCount: 3, errors: [], timezone: 'Asia/Shanghai' });
  assert.match(html, />2<\/div>/); // 大数字是 2，不是 3
  assert.match(html, /条命中/);
});

test('renderDigest：关键词高亮成 mark', () => {
  const html = renderDigest({ groups, generatedAt: 'x', siteCount: 1, errors: [] });
  assert.match(html, /<mark[^>]*>交换<\/mark>/);
});

test('renderDigest：样例单独成块，不混在命中里', () => {
  const html = renderDigest({ groups, generatedAt: 'x', siteCount: 1, errors: [] });
  assert.match(html, /首次订阅样例/);
  assert.ok(html.indexOf('首次订阅样例') > html.indexOf('实习学分认定'));
});

test('renderDigest：站点抓取失败时给出提示', () => {
  const html = renderDigest({
    groups: [],
    generatedAt: 'x',
    siteCount: 1,
    errors: [{ name: 'B大学', message: '没有解析到任何条目' }],
  });
  assert.match(html, /没抓到内容/);
  assert.match(html, /没有解析到任何条目/);
});

test('renderDigest：全部为空时显示「没有命中」而不是空白', () => {
  const html = renderDigest({ groups: [], generatedAt: 'x', siteCount: 2, errors: [] });
  assert.match(html, /没有命中关键词的新通告/);
});

test('renderDigestText：纯文本版本包含标题和链接', () => {
  const text = renderDigestText({ groups, generatedAt: 'x', siteCount: 1, errors: [] });
  assert.match(text, /交换生选拔/);
  assert.match(text, /https:\/\/a\.edu\.cn\/1\.htm/);
  assert.match(text, /首次订阅样例/);
});

test('buildSubject：三种情况分别有合适标题', () => {
  assert.match(buildSubject(config, { hits: 3 }, ['A大学']), /3 条新通告/);
  assert.match(buildSubject(config, { hits: 0, samples: 5 }, ['A大学']), /订阅成功/);
  assert.match(buildSubject(config, { hits: 0, samples: 0 }, ['A大学']), /没有命中/);
});
