/**
 * notice-radar 抓取代理（Cloudflare Worker）
 *
 * 用途：有些学校站点会拦截 GitHub Actions 的机房 IP（返回 403），
 * 但 Cloudflare 的出口 IP 能正常访问。这个 Worker 只做一件事：
 * 把 /?url=<encodeURIComponent(目标地址)> 转发到目标站点并原样返回。
 *
 * 部署：见 docs/proxy.md（复制粘贴到 Cloudflare Workers 控制台即可，免费）
 *
 * 安全：默认只允许下面的白名单域名，避免被当成公开代理滥用。
 */

// 只允许这些域名被代理，按需增删
const ALLOWED_HOSTS = [
  'jy.scu.edu.cn',
  // 'jwc.scu.edu.cn',
];

// 可选：填一个随机字符串，配置里带上 ?token=xxx 才允许访问
// 留空表示不校验（仍然有域名白名单兜底）
const TOKEN = '';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function text(message, status = 200) {
  return new Response(message, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

export default {
  async fetch(request) {
    const requestUrl = new URL(request.url);
    const target = requestUrl.searchParams.get('url');

    if (!target) {
      return text('用法：/?url=<encodeURIComponent(目标地址)>', 400);
    }

    let parsed;
    try {
      parsed = new URL(target);
    } catch {
      return text('url 参数不是合法地址', 400);
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return text('只支持 http / https', 400);
    }

    if (!ALLOWED_HOSTS.includes(parsed.hostname)) {
      return text(`域名不在白名单：${parsed.hostname}`, 403);
    }

    if (TOKEN && requestUrl.searchParams.get('token') !== TOKEN) {
      return text('token 不正确', 401);
    }

    let upstream;
    try {
      upstream = await fetch(parsed.toString(), {
        headers: {
          'user-agent': UA,
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'zh-CN,zh;q=0.9,en;q=0.6',
        },
        redirect: 'follow',
      });
    } catch (error) {
      return text(`请求目标站点失败：${error.message}`, 502);
    }

    const headers = new Headers();
    headers.set('content-type', upstream.headers.get('content-type') || 'text/html; charset=utf-8');
    headers.set('cache-control', 'no-store');
    headers.set('x-proxy-status', String(upstream.status));

    return new Response(upstream.body, { status: upstream.status, headers });
  },
};
