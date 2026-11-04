import iconv from 'iconv-lite';
import { sleep } from './util.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const ALIASES = {
  gb2312: 'gbk',
  gb18030: 'gb18030',
  'x-gbk': 'gbk',
  utf8: 'utf-8',
};

function normalizeEncoding(enc) {
  if (!enc) return 'utf-8';
  const e = String(enc).trim().toLowerCase();
  return ALIASES[e] || e;
}

/** 从 Content-Type 或页面 <meta> 猜测编码，国内学校站大量是 gbk */
export function detectCharset(contentType, buffer) {
  const fromHeader = /charset=([\w-]+)/i.exec(contentType || '')?.[1];
  if (fromHeader) return normalizeEncoding(fromHeader);

  // 只看前 4KB，用 latin1 读出来找 meta（避免先按 utf-8 解出乱码）
  const head = buffer.subarray(0, 4096).toString('latin1');
  const meta =
    /<meta[^>]+charset\s*=\s*["']?\s*([\w-]+)/i.exec(head)?.[1] ||
    /<meta[^>]+content\s*=\s*["'][^"']*charset=([\w-]+)/i.exec(head)?.[1];
  if (meta) return normalizeEncoding(meta);
  return 'utf-8';
}

export function decodeBody(buffer, charset) {
  const enc = normalizeEncoding(charset);
  if (!iconv.encodingExists(enc)) return buffer.toString('utf-8');
  return iconv.decode(buffer, enc);
}

/**
 * 拼出真正要请求的地址。
 * 站点被机房 IP 拦截时，可以配一个代理（见 docs/proxy.md），
 * 模板里用 {url} 占位，例如 https://my-worker.workers.dev/?url={url}
 */
export function buildRequestUrl(url, proxy) {
  if (!proxy) return url;
  const template = String(proxy);
  if (template.includes('{url}')) return template.replaceAll('{url}', encodeURIComponent(url));
  return `${template}${encodeURIComponent(url)}`;
}

/**
 * 抓页面，带重试、超时、编码识别。
 * 走代理时 finalUrl 仍然返回原始地址，保证相对链接能正确补全。
 * @returns {Promise<{html:string,status:number,finalUrl:string,charset:string,fetchedVia:string}>}
 */
export async function fetchPage(url, options = {}) {
  const {
    headers = {},
    timeout = 20000,
    retries = 2,
    charset = 'auto',
    proxy = '',
  } = options;

  const requestUrl = buildRequestUrl(url, proxy);

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(requestUrl, {
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'user-agent': UA,
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'zh-CN,zh;q=0.9,en;q=0.6',
          ...headers,
        },
      });
      const buffer = Buffer.from(await res.arrayBuffer());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const enc =
        charset && charset !== 'auto'
          ? normalizeEncoding(charset)
          : detectCharset(res.headers.get('content-type'), buffer);
      return {
        html: decodeBody(buffer, enc),
        status: res.status,
        finalUrl: url,
        charset: enc,
        fetchedVia: proxy ? requestUrl : url,
      };
    } catch (error) {
      lastError = error;
      if (attempt < retries) await sleep(800 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`抓取失败 ${url}：${lastError?.message || '未知错误'}`);
}

/** 小并发映射，避免一次性打爆站点 */
export async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}
