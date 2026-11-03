import fs from 'node:fs';
import path from 'node:path';
import { truncate } from './util.js';

export function renderMarkdown({ groups, generatedAt, siteCount, errors = [] }) {
  const total = groups.reduce((sum, group) => sum + group.items.length, 0);
  const lines = [
    '# 通告雷达 · 新通告汇总',
    '',
    `- 生成时间：${generatedAt}`,
    `- 本次检查：${siteCount} 个站点`,
    `- 命中：${total} 条`,
    '',
  ];

  if (!total) {
    lines.push('> 这次没有命中关键词的新通告。', '');
  }

  for (const group of groups) {
    lines.push(`## ${group.name}（${group.items.length} 条）`, '', `原列表：${group.url}`, '');
    for (const item of group.items) {
      const date = item.date ? `\`${item.date}\` ` : '';
      lines.push(`- ${date}[${item.title}](${item.url})`);
      if (item.keywords?.length) lines.push(`  - 命中：${item.keywords.join('、')}`);
      if (item.excerpt) lines.push(`  - 摘要：${truncate(item.excerpt, 120)}`);
    }
    lines.push('');
  }

  if (errors.length) {
    lines.push('## 抓取异常', '');
    for (const error of errors) lines.push(`- **${error.name}**：${error.message}`);
    lines.push('');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

/**
 * 写 Markdown 汇总文件。返回写出的路径列表。
 * out/latest.md 永远是最新一份；history=true 时额外按时间戳存档。
 */
export function writeMarkdownExport(config, data, now = new Date()) {
  const dir = config.export?.dir || 'out';
  fs.mkdirSync(dir, { recursive: true });

  const content = renderMarkdown(data);
  const written = [];

  const latest = path.join(dir, 'latest.md');
  fs.writeFileSync(latest, content, 'utf8');
  written.push(latest);

  if (config.export?.history !== false) {
    const stamp = now.toISOString().replace(/[:T]/g, '-').slice(0, 16);
    const archiveDir = path.join(dir, 'archive');
    fs.mkdirSync(archiveDir, { recursive: true });
    const archiveFile = path.join(archiveDir, `${stamp}.md`);
    fs.writeFileSync(archiveFile, content, 'utf8');
    written.push(archiveFile);
  }

  return written;
}
