import crypto from 'node:crypto';

/** 稳定短哈希，用于生成条目去重键 */
export function sha1(input) {
  return crypto.createHash('sha1').update(String(input)).digest('hex');
}

/**
 * 规范化链接：去掉锚点、跟踪参数，排序 query，去掉末尾斜杠。
 * 同一个通告在首页/列表页/详情页出现时，尽量归一到同一个 URL。
 */
export function canonicalUrl(raw, base) {
  if (!raw) return '';
  const trimmed = String(raw).trim();
  if (!trimmed || trimmed === '#' || /^javascript:/i.test(trimmed)) return '';
  let url;
  try {
    url = new URL(trimmed, base);
  } catch {
    return trimmed;
  }
  url.hash = '';
  const drop = [];
  for (const key of url.searchParams.keys()) {
    if (/^(utm_|spm$|from$|share|_t$|timestamp$|t$)/i.test(key)) drop.push(key);
  }
  drop.forEach((k) => url.searchParams.delete(k));
  const entries = [...url.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
  url.search = '';
  for (const [k, v] of entries) url.searchParams.append(k, v);
  return url.toString().replace(/\/$/, '');
}

/** 合并空白、去零宽字符、还原 &nbsp; */
export function normalizeText(text) {
  return String(text ?? '')
    .replace(/\u00a0|\u3000/g, ' ')
    .replace(/[\u200b-\u200f\u2028\u2029\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 供关键词匹配使用的归一化：小写 + 全角转半角 */
export function normalizeForMatch(text) {
  return normalizeText(text)
    .toLowerCase()
    .replace(/[\uff01-\uff5e]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

function isValidYmd(y, m, d) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const pad = (n) => String(n).padStart(2, '0');

/**
 * 从任意文本里抽日期。
 * 支持 2026-10-28 / 2026年10月28日 / 2026/10/28 / 20261028 / 10-28（补当前年份）
 * 返回 YYYY-MM-DD，失败返回 null。
 */
export function parseDate(text, now = new Date()) {
  if (!text) return null;
  const s = normalizeText(text);

  const full = s.match(/(20\d{2})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/);
  if (full) {
    const [, y, m, d] = full;
    if (isValidYmd(+y, +m, +d)) return `${y}-${pad(+m)}-${pad(+d)}`;
  }

  const compact = s.match(/\b(20\d{2})(\d{2})(\d{2})\b/);
  if (compact) {
    const [, y, m, d] = compact;
    if (isValidYmd(+y, +m, +d)) return `${y}-${pad(+m)}-${pad(+d)}`;
  }

  // 没有年份的短日期：10-28 / 10月28日
  const short = s.match(/(?:^|[^\d])(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?(?![\d])/);
  if (short) {
    const m = +short[1];
    const d = +short[2];
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      // 列表页的日期都是「已经发布」的时间，所以取最近的过去：
      // 算出来比今天还晚一周以上，就认为是去年的（跨年场景）
      let y = now.getFullYear();
      const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
      if (Date.UTC(y, m - 1, d) - today > 7 * 86400000) y -= 1;
      if (isValidYmd(y, m, d)) return `${y}-${pad(m)}-${pad(d)}`;
    }
  }

  // 相对时间：今天 / 昨天 / 前天 / 3天前 / 2小时前（只保留日期）
  const ymd = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const shift = (days) => ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - days));
  if (/今天|刚刚/.test(s) || /\d+\s*(分钟|小时)前/.test(s)) return ymd(now);
  if (/昨天/.test(s)) return shift(1);
  if (/前天/.test(s)) return shift(2);
  const daysAgo = s.match(/(\d+)\s*天前/);
  if (daysAgo) return shift(Number(daysAgo[1]));

  return null;
}

export function formatDateTime(date = new Date(), tz = 'Asia/Shanghai') {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

export function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function truncate(text, max = 120) {
  const s = String(text ?? '');
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function log(msg) {
  process.stdout.write(`[radar] ${msg}\n`);
}

export function logError(msg) {
  process.stderr.write(`[radar] ${msg}\n`);
}
