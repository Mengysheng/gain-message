import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import iconv from 'iconv-lite';
import {
  buildRequestUrl,
  detectCharset,
  decodeBody,
  isCookieChallenge,
  resetCookieJar,
  fetchPage,
  describeFetchError,
} from '../src/fetch.js';

test('buildRequestUrl：没有代理时原样返回', () => {
  const url = 'https://jy.scu.edu.cn/index/index/employjob.html?type=2';
  assert.equal(buildRequestUrl(url, ''), url);
});

test('buildRequestUrl：模板里的 {url} 会被编码替换', () => {
  const url = 'https://jy.scu.edu.cn/a.html?type=2&page=1';
  const proxied = buildRequestUrl(url, 'https://proxy.example.workers.dev/?url={url}');
  assert.ok(proxied.startsWith('https://proxy.example.workers.dev/?url='));
  assert.ok(!proxied.includes('jy.scu.edu.cn/a.html?type=2&page=1'), '原始参数必须被编码');
  const decoded = decodeURIComponent(proxied.split('url=')[1]);
  assert.equal(decoded, url);
});

test('buildRequestUrl：模板不含 {url} 时按追加处理', () => {
  const url = 'https://a.edu.cn/notice';
  assert.equal(
    buildRequestUrl(url, 'https://proxy.example/raw?target='),
    `https://proxy.example/raw?target=${encodeURIComponent(url)}`,
  );
});

test('buildRequestUrl：中文路径也能正确编码', () => {
  const url = 'https://a.edu.cn/通知/1.htm';
  const proxied = buildRequestUrl(url, 'https://p.example/?u={url}');
  assert.ok(proxied.includes(encodeURIComponent(url)));
});

test('detectCharset：从 header 里识别 gbk', () => {
  const buf = Buffer.from('<html><body>测试</body></html>', 'utf8');
  assert.equal(detectCharset('text/html; charset=gb2312', buf), 'gbk');
  assert.equal(detectCharset('text/html; charset=UTF-8', buf), 'utf-8');
});

test('detectCharset：header 没写时读 meta', () => {
  const buf = Buffer.from('<html><head><meta charset="gbk"></head></html>', 'latin1');
  assert.equal(detectCharset('text/html', buf), 'gbk');
});

test('decodeBody：GBK 页面能正确解码', () => {
  const gbk = iconv.encode('<html>关于推免工作的通知</html>', 'gbk');
  assert.match(decodeBody(gbk, 'gbk'), /关于推免工作的通知/);
});

test('isCookieChallenge：识别「发 cookie 再跳回」的挑战页', () => {
  const body = '<html><meta charset="utf-8" /><title></title><div></div></html> <script> window.location.href ="/x"; </script>';
  assert.equal(isCookieChallenge(403, body), true);
  assert.equal(isCookieChallenge(200, body), false, '200 不算挑战');
  assert.equal(isCookieChallenge(403, '<html>正常的 403 页面，很长'.repeat(100) + '</html>'), false, '长页面不算挑战');
});

test('cookie 挑战：自动带 cookie 重试并拿到正文', async (t) => {
  resetCookieJar();
  let hits = 0;
  const server = http.createServer((req, res) => {
    hits += 1;
    if (!String(req.headers.cookie || '').includes('token=ok')) {
      res.writeHead(403, {
        'content-type': 'text/html; charset=utf-8',
        'set-cookie': 'token=ok; Path=/',
      });
      res.end('<html><script>window.location.href="/list"</script></html>');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<html><body>2026-11-05 关于交换生选拔的通知</body></html>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());

  const { port } = server.address();
  const page = await fetchPage(`http://127.0.0.1:${port}/list`, { retries: 0 });

  assert.equal(page.status, 200);
  assert.match(page.html, /交换生选拔/);
  assert.equal(hits, 2, '应该请求两次：挑战 + 带 cookie 重试');
});

test('describeFetchError：把底层网络错误翻译成人话', () => {
  assert.match(describeFetchError({ cause: { code: 'ECONNRESET' } }), /连接被重置/);
  assert.match(describeFetchError({ cause: { code: 'ENOTFOUND' } }), /域名解析失败/);
  assert.match(describeFetchError({ cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } }), /连接超时/);
  assert.match(describeFetchError({ message: 'fetch failed' }), /网络连接失败/);
  assert.match(describeFetchError({ message: 'HTTP 403' }), /HTTP 403/);
  assert.equal(describeFetchError(null), '未知错误');
});
