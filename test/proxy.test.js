import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fetchPage } from '../src/fetch.js';
import { parseList } from '../src/parse.js';

const FIXTURE = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<ul class="notice-list">
  <li><span class="date">2026-11-05</span><a href="/info/1001.htm">关于2027年春季学期校际交换生选拔工作的通知</a></li>
  <li><span class="date">2026-11-04</span><a href="/info/1002.htm">关于选派本科生参加2027年寒假海外交流项目的通知</a></li>
</ul></body></html>`;

function startProxy() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const target = url.searchParams.get('url');
    if (!target) {
      res.writeHead(400).end('missing url');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(FIXTURE);
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port });
    });
  });
}

test('走代理抓取：最终地址仍是原始 URL，相对链接仍能正确补全', async (t) => {
  const { server, port } = await startProxy();
  t.after(() => server.close());

  const original = 'https://example.edu.cn/notice/list.htm';
  const page = await fetchPage(original, {
    proxy: `http://127.0.0.1:${port}/?url={url}`,
    retries: 0,
  });

  assert.equal(page.finalUrl, original, 'finalUrl 必须是原始地址，不能是代理地址');
  assert.equal(page.status, 200);
  assert.match(page.html, /交换生选拔/);

  const items = parseList(page.html, { list: { item: 'ul.notice-list li', title: 'a', link: 'a', date: 'span.date' } }, page.finalUrl);
  assert.equal(items.length, 2);
  assert.equal(items[0].url, 'https://example.edu.cn/info/1001.htm', '相对链接要按原站点补全，而不是代理站点');
  assert.equal(items[0].date, '2026-11-05');
});

test('代理不可用时给出清晰错误', async () => {
  await assert.rejects(
    () => fetchPage('https://example.edu.cn/notice', { proxy: 'http://127.0.0.1:1/?url={url}', retries: 0, timeout: 3000 }),
    /抓取失败/,
  );
});
