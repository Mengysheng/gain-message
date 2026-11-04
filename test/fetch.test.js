import test from 'node:test';
import assert from 'node:assert/strict';
import iconv from 'iconv-lite';
import { buildRequestUrl, detectCharset, decodeBody } from '../src/fetch.js';

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
