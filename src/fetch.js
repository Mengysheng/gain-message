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

// 每个站点一个简易 cookie 罐：国内不少公告站用「发 cookie 再跳回原页」的挑战
const cookieJar = new Map();

function jarKey(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function saveCookies(url, res) {
  const key = jarKey(url);
  const jar = cookieJar.get(key) || new Map();
  const list =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : [res.headers.get('set-cookie')].filter(Boolean);

  for (const line of list) {
    const pair = String(line).split(';')[0];
    const index = pair.indexOf('=');
    if (index > 0) {
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      if (name) jar.set(name, value);
    }
  }
  if (jar.size) cookieJar.set(key, jar);
}

function cookieHeader(url) {
  const jar = cookieJar.get(jarKey(url));
  if (!jar || !jar.size) return '';
  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
}

/** 清空 cookie 罐（测试用） */
export function resetCookieJar() {
  cookieJar.clear();
}

/**
 * 识别「设置 cookie 后跳回原页」的挑战页。
 * 典型特征：403 + 极短 HTML + window.location.href + Set-Cookie。
 */
export function isCookieChallenge(status, html) {
  if (status !== 403 && status !== 412 && status !== 202) return false;
  if (!html || html.length > 2000) return false;
  return /window\.location(\.href)?\s*=/.test(html) || /document\.cookie/i.test(html);
}

/**
 * 抓页面，带重试、超时、编码识别、cookie 挑战处理。
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

  const requestOnce = async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const cookie = cookieHeader(url);
      const res = await fetch(requestUrl, {
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'user-agent': UA,
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'zh-CN,zh;q=0.9,en;q=0.6',
          referer: url,
          ...(cookie ? { cookie } : {}),
          ...headers,
        },
      });
      const buffer = Buffer.from(await res.arrayBuffer());
      saveCookies(url, res);
      return { res, buffer };
    } finally {
      clearTimeout(timer);
    }
  };

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      let { res, buffer } = await requestOnce();
      let enc =
        charset && charset !== 'auto'
          ? normalizeEncoding(charset)
          : detectCharset(res.headers.get('content-type'), buffer);
      let html = decodeBody(buffer, enc);

      // 站点发了 cookie 挑战：带上刚存的 cookie 再请求一次
      if (isCookieChallenge(res.status, html)) {
        ({ res, buffer } = await requestOnce());
        enc =
          charset && charset !== 'auto'
            ? normalizeEncoding(charset)
            : detectCharset(res.headers.get('content-type'), buffer);
        html = decodeBody(buffer, enc);
      }

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return {
        html,
        status: res.status,
        finalUrl: url,
        charset: enc,
        fetchedVia: proxy ? requestUrl : url,
      };
    } catch (error) {
      lastError = error;
      if (attempt < retries) await sleep(1500 * (attempt + 1) ** 2);
    }
  }
  throw new Error(`抓取失败 ${url}：${describeFetchError(lastError)}`);
}

const NETWORK_CODES = {
  ENOTFOUND: '域名解析失败（DNS 查不到这个域名）',
  EAI_AGAIN: 'DNS 暂时不可用',
  ECONNREFUSED: '连接被拒绝（端口没开或被防火墙拦截）',
  ECONNRESET: '连接被重置（多半是跨境链路被中断）',
  ETIMEDOUT: '连接超时',
  EHOSTUNREACH: '主机不可达',
  ENETUNREACH: '网络不可达',
  UND_ERR_CONNECT_TIMEOUT: '连接超时（20 秒内没建好连接）',
  UND_ERR_HEADERS_TIMEOUT: '等响应头超时',
  UND_ERR_SOCKET: '连接被对端关闭',
  CERT_HAS_EXPIRED: 'HTTPS 证书过期',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'HTTPS 证书不被信任',
};

/**
 * 把底层网络错误翻译成人能看懂的一句话。
 * 云端跑的时候最常见的是「连接被重置」——跨境链路抖一下就是这样。
 */
export function describeFetchError(error) {
  if (!error) return '未知错误';
  const code = error.cause?.code || error.code || '';
  const hint = NETWORK_CODES[code];
  if (hint) return `${hint} [${code}]`;
  const message = error.cause?.message || error.message || String(error);
  if (/fetch failed/i.test(message)) return '网络连接失败（跨境链路抖动或被对方断开，稍后重试通常能恢复）';
  return message;
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
