import nodemailer from 'nodemailer';
import { escapeHtml, truncate } from './util.js';
import { highlight } from './match.js';

const COLORS = {
  bg: '#f4f5f7',
  card: '#ffffff',
  border: '#e5e7eb',
  text: '#1f2328',
  muted: '#6b7280',
  accent: '#1a5fb4',
  hit: '#0f766e',
  error: '#b91c1c',
};

const chip = (bg, color, text) =>
  `<span style="display:inline-block;background:${bg};color:${color};border-radius:10px;padding:1px 8px;font-size:12px;line-height:18px;">${text}</span>`;

function renderItem(item) {
  const linked = `<a href="${escapeHtml(item.url)}" style="color:${COLORS.text};text-decoration:none;font-weight:600;">${highlight(
    escapeHtml(item.title),
    item.keywords || [],
  )}</a>`;

  const meta = [];
  if (item.date) meta.push(chip('#f1f3f5', COLORS.muted, escapeHtml(item.date)));
  if (item.keywords?.length) {
    meta.push(chip('#e6f4f1', COLORS.hit, `命中：${escapeHtml(item.keywords.join(' / '))}`));
  }

  const excerpt = item.excerpt
    ? `<div style="margin-top:6px;color:${COLORS.muted};font-size:13px;line-height:1.6;">${escapeHtml(
        truncate(item.excerpt, 160),
      )}</div>`
    : '';

  return `<tr><td style="padding:12px 0;border-bottom:1px solid ${COLORS.border};">
    <div style="font-size:15px;line-height:1.5;">${linked}</div>
    ${meta.length ? `<div style="margin-top:6px;">${meta.join(' ')}</div>` : ''}
    ${excerpt}
  </td></tr>`;
}

export function renderDigest({ groups, generatedAt, siteCount, errors = [], timezone = 'Asia/Shanghai' }) {
  const withHits = groups
    .map((group) => ({
      ...group,
      hits: group.items.filter((item) => !item.isSample),
      samples: group.items.filter((item) => item.isSample),
    }))
    .filter((group) => group.hits.length || group.samples.length);

  const totalHits = withHits.reduce((sum, group) => sum + group.hits.length, 0);
  const totalSamples = withHits.reduce((sum, group) => sum + group.samples.length, 0);

  const sections = withHits
    .map((group) => {
      const hitRows = group.hits.map(renderItem).join('');
      const sampleRows = group.samples.map(renderItem).join('');
      const sampleBlock = group.samples.length
        ? `<div style="margin-top:14px;padding-top:6px;">
            <div style="color:${COLORS.muted};font-size:12px;margin:6px 0 2px;">首次订阅样例 · 最近 ${group.samples.length} 条，仅用于确认解析是否正确</div>
            <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="opacity:.75;">${sampleRows}</table>
          </div>`
        : '';

      return `<div style="margin-top:26px;">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
          <tr>
            <td style="font-size:16px;font-weight:700;color:${COLORS.text};">${escapeHtml(group.name)}</td>
            <td align="right" style="color:${COLORS.muted};font-size:12px;">${group.hits.length} 条命中</td>
          </tr>
        </table>
        <div style="margin-top:4px;font-size:12px;">
          <a href="${escapeHtml(group.url)}" style="color:${COLORS.accent};text-decoration:none;">查看原列表 ↗</a>
        </div>
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation">${hitRows}</table>
        ${sampleBlock}
      </div>`;
    })
    .join('');

  const errorBlock = errors.length
    ? `<div style="margin-top:24px;padding:12px 14px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;">
        <div style="color:${COLORS.error};font-weight:600;font-size:14px;">有 ${errors.length} 个站点这次没抓到内容</div>
        <ul style="margin:8px 0 0;padding-left:18px;color:${COLORS.error};font-size:13px;line-height:1.7;">
          ${errors.map((e) => `<li>${escapeHtml(e.name)}：${escapeHtml(e.message)}</li>`).join('')}
        </ul>
        <div style="margin-top:8px;color:${COLORS.muted};font-size:12px;">多半是页面改版导致选择器失效，用 <code>node src/cli.js inspect &lt;url&gt;</code> 重新生成选择器即可。</div>
      </div>`
    : '';

  const emptyBlock =
    !totalHits && !totalSamples && !errors.length
      ? `<div style="margin-top:24px;padding:16px;background:#f9fafb;border:1px solid ${COLORS.border};border-radius:8px;color:${COLORS.muted};font-size:14px;">这次检查没有命中关键词的新通告。</div>`
      : '';

  return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>通告雷达</title></head>
<body style="margin:0;padding:0;background:${COLORS.bg};">
  <div style="max-width:640px;margin:0 auto;padding:24px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;">
    <div style="background:${COLORS.card};border:1px solid ${COLORS.border};border-radius:12px;padding:22px 24px;">
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
        <tr>
          <td valign="top">
            <div style="font-size:18px;font-weight:700;color:${COLORS.text};">通告雷达 · 新通告汇总</div>
            <div style="margin-top:6px;color:${COLORS.muted};font-size:13px;">${escapeHtml(generatedAt)}（${escapeHtml(
              timezone,
            )}）</div>
            <div style="margin-top:2px;color:${COLORS.muted};font-size:12px;">本次检查 ${siteCount} 个站点${
              errors.length ? `，${errors.length} 个异常` : ''
            }${totalSamples ? `，另附 ${totalSamples} 条首次样例` : ''}</div>
          </td>
          <td align="right" valign="top" width="80">
            <div style="font-size:28px;font-weight:700;color:${totalHits ? COLORS.accent : COLORS.muted};line-height:1;">${totalHits}</div>
            <div style="color:${COLORS.muted};font-size:12px;margin-top:4px;">条命中</div>
          </td>
        </tr>
      </table>
      ${sections}
      ${errorBlock}
      ${emptyBlock}
    </div>
    <div style="margin-top:14px;text-align:center;color:#9ca3af;font-size:12px;line-height:1.7;">
      由 notice-radar 自动发送 · 改关键词只需要改 config.yaml
    </div>
  </div>
</body>
</html>`;
}

export function renderDigestText({ groups, generatedAt, siteCount, errors = [] }) {
  const hits = groups.flatMap((group) => group.items.filter((item) => !item.isSample).map((item) => ({ ...item, site: group.name })));
  const samples = groups.flatMap((group) =>
    group.items.filter((item) => item.isSample).map((item) => ({ ...item, site: group.name })),
  );

  const lines = ['通告雷达 · 新通告汇总', generatedAt, `本次检查 ${siteCount} 个站点`, ''];
  for (const item of hits) {
    lines.push(`- ${item.date ? `[${item.date}] ` : ''}${item.title}（${item.site}）`);
    lines.push(`  ${item.url}`);
    if (item.keywords?.length) lines.push(`  命中：${item.keywords.join(' / ')}`);
  }
  if (samples.length) {
    lines.push('', '首次订阅样例：');
    for (const item of samples) lines.push(`- ${item.date ? `[${item.date}] ` : ''}${item.title}（${item.site}）`);
  }
  for (const error of errors) lines.push('', `！${error.name} 抓取失败：${error.message}`);
  return lines.join('\n');
}

export function buildSubject(config, { hits = 0, samples = 0, errors = 0 } = {}, siteNames = []) {
  const prefix = config.email.subject_prefix || '[通告雷达]';
  const names = siteNames.slice(0, 2).join('、');
  const more = siteNames.length > 2 ? ` 等 ${siteNames.length} 站` : '';

  if (hits > 0) {
    return errors > 0
      ? `${prefix} ${hits} 条新通告（${errors} 个站点异常） · ${names}${more}`
      : `${prefix} ${hits} 条新通告 · ${names}${more}`;
  }
  if (errors > 0) return `${prefix} ⚠️ ${errors} 个站点抓取失败`;
  if (samples > 0) return `${prefix} 订阅成功，附 ${samples} 条样例`;
  return `${prefix} 本次没有命中`;
}

export function createTransport(config) {
  const smtp = config.email.smtp || {};
  const port = Number(smtp.port || 465);
  return nodemailer.createTransport({
    host: smtp.host,
    port,
    secure: smtp.secure ?? port === 465,
    auth: { user: smtp.user, pass: smtp.pass },
    connectionTimeout: 20000,
    greetingTimeout: 20000,
    socketTimeout: 30000,
  });
}

export async function sendMail(config, { subject, html, text }) {
  const transport = createTransport(config);
  const fromName = config.email.from_name || '通告雷达';
  const from = config.email.from;
  const info = await transport.sendMail({
    from: `"${fromName}" <${from}>`,
    to: (config.email.to || []).join(', '),
    subject,
    text,
    html,
    headers: { 'X-Notice-Radar': '1' },
  });
  return info;
}

export async function verifySmtp(config) {
  const transport = createTransport(config);
  await transport.verify();
  transport.close();
}

const STATUS = {
  ok: { bg: '#e6f4f1', color: '#0f766e', text: '正常' },
  warn: { bg: '#fff4e5', color: '#b45309', text: '连续失败' },
  unknown: { bg: '#f1f3f5', color: '#6b7280', text: '还没成功过' },
};

function statusOf(row) {
  if (row.ok) return STATUS.ok;
  if (row.failStreak >= 2) return STATUS.warn;
  return STATUS.unknown;
}

/**
 * 心跳邮件：没有新通告时也发一封，证明「脚本还活着、链接还通」。
 * 没有它的话，「今天真的没消息」和「脚本已经死了一周」在收件箱里长得一模一样。
 */
export function renderHeartbeat({ rows = [], generatedAt, timezone = 'Asia/Shanghai', intervalHours = 20 }) {
  const okCount = rows.filter((row) => row.ok).length;
  const badCount = rows.length - okCount;

  const tableRows = rows
    .map((row) => {
      const st = statusOf(row);
      const link = row.url
        ? `<a href="${escapeHtml(row.url)}" style="color:${COLORS.accent};text-decoration:none;">${escapeHtml(row.name)}</a>`
        : escapeHtml(row.name);
      return `<tr>
        <td style="padding:8px 0;border-bottom:1px solid ${COLORS.border};font-size:14px;">${link}</td>
        <td align="center" style="padding:8px 0;border-bottom:1px solid ${COLORS.border};">${chip(st.bg, st.color, st.text)}</td>
        <td align="right" style="padding:8px 0;border-bottom:1px solid ${COLORS.border};color:${COLORS.muted};font-size:12px;">${
          row.lastOk ? escapeHtml(row.lastOk) : '—'
        }</td>
      </tr>`;
    })
    .join('');

  return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>通告雷达</title></head>
<body style="margin:0;padding:0;background:${COLORS.bg};">
  <div style="max-width:640px;margin:0 auto;padding:24px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;">
    <div style="background:${COLORS.card};border:1px solid ${COLORS.border};border-radius:12px;padding:22px 24px;">
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
        <tr>
          <td valign="top">
            <div style="font-size:18px;font-weight:700;color:${COLORS.text};">通告雷达 · 例行心跳</div>
            <div style="margin-top:6px;color:${COLORS.muted};font-size:13px;">${escapeHtml(generatedAt)}（${escapeHtml(timezone)}）</div>
            <div style="margin-top:2px;color:${COLORS.muted};font-size:12px;">每 ${intervalHours} 小时没发过信就报一次平安；改动关键词只需要改 config.yaml</div>
          </td>
          <td align="right" valign="top" width="96">
            <div style="font-size:28px;font-weight:700;color:${badCount ? COLORS.error : COLORS.accent};line-height:1;">${okCount}/${rows.length}</div>
            <div style="color:${COLORS.muted};font-size:12px;margin-top:4px;">站点正常</div>
          </td>
        </tr>
      </table>

      <div style="margin-top:22px;padding:14px;background:#f9fafb;border:1px solid ${COLORS.border};border-radius:8px;color:${COLORS.muted};font-size:13px;line-height:1.7;">
        ${
          badCount
            ? `这次有 ${badCount} 个站点没抓到。跨境链路抖动很常见，偶发不用管；连续失败会在下一封告警里体现。`
            : `这次 ${rows.length} 个站点都抓取正常，只是最近没有命中关键词的新通告 —— 所以除了这封心跳，不会推别的内容。`
        }
      </div>

      <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-top:18px;">
        <tr>
          <td style="font-size:12px;color:${COLORS.muted};padding-bottom:4px;">站点</td>
          <td align="center" style="font-size:12px;color:${COLORS.muted};padding-bottom:4px;">本次</td>
          <td align="right" style="font-size:12px;color:${COLORS.muted};padding-bottom:4px;">上次成功</td>
        </tr>
        ${tableRows}
      </table>
    </div>
    <div style="margin-top:14px;text-align:center;color:#9ca3af;font-size:12px;line-height:1.7;">
      由 notice-radar 自动发送 · 不想收心跳就把 config.yaml 里 email.heartbeat.enabled 改成 false
    </div>
  </div>
</body>
</html>`;
}

export function renderHeartbeatText({ rows = [], generatedAt, intervalHours = 20 }) {
  const okCount = rows.filter((row) => row.ok).length;
  const lines = [
    '通告雷达 · 例行心跳',
    generatedAt,
    `${okCount}/${rows.length} 个站点本次抓取正常`,
    `（每 ${intervalHours} 小时没发过信就报一次平安）`,
    '',
  ];
  for (const row of rows) {
    const st = statusOf(row);
    lines.push(`- ${row.name}：${st.text}${row.lastOk ? `，上次成功 ${row.lastOk}` : ''}`);
    if (!row.ok && row.error) lines.push(`  ${row.error}`);
  }
  return lines.join('\n');
}

export function buildHeartbeatSubject(config, { okCount = 0, total = 0 } = {}) {
  const prefix = config.email.subject_prefix || '[通告雷达]';
  const bad = total - okCount;
  return bad > 0
    ? `${prefix} 心跳：${okCount}/${total} 个站点正常（${bad} 个没抓到）`
    : `${prefix} 心跳：${total} 个站点都正常，无新通告`;
}
