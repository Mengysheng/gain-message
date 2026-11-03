import { normalizeForMatch } from './util.js';

function toList(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value];
}

/**
 * 把 YAML 里的关键词配置编译成可复用的规则。
 * include: 普通关键词（子串匹配，忽略大小写/全半角）
 * regex:   正则（自己控制转义）
 * include_mode: any=命中任一即推送；all=必须全部命中
 * exclude: 命中任意一个就丢弃
 */
export function compileRules(...ruleSets) {
  const include = [];
  const exclude = [];
  const regex = [];
  let includeMode = 'any';
  let matchIn = 'title';

  for (const rules of ruleSets) {
    if (!rules) continue;
    for (const word of toList(rules.include)) include.push(String(word));
    for (const word of toList(rules.exclude)) exclude.push(String(word));
    for (const pattern of toList(rules.regex)) regex.push(String(pattern));
    if (rules.include_mode) includeMode = rules.include_mode;
    if (rules.match_in) matchIn = rules.match_in;
  }

  return {
    include: include.map((word) => ({ raw: word, norm: normalizeForMatch(word) })),
    exclude: exclude.map((word) => ({ raw: word, norm: normalizeForMatch(word) })),
    regex: regex.map((pattern) => {
      try {
        return { raw: pattern, re: new RegExp(pattern, 'i') };
      } catch {
        return { raw: pattern, re: null };
      }
    }),
    includeMode,
    matchIn,
  };
}

export function hasIncludeRules(rules) {
  return rules.include.length > 0 || rules.regex.length > 0;
}

/**
 * @returns {{hit:boolean, keywords:string[]}}
 */
export function matchItem(item, rules) {
  const title = normalizeForMatch(item.title || '');
  const content = normalizeForMatch(item.content || '');
  const haystack = rules.matchIn === 'title+content' ? `${title} ${content}` : title;
  const compact = haystack.replace(/\s+/g, '');

  const contains = (norm) => haystack.includes(norm) || compact.includes(norm.replace(/\s+/g, ''));

  const hits = [];
  for (const word of rules.include) {
    if (contains(word.norm)) hits.push(word.raw);
  }
  for (const { raw, re } of rules.regex) {
    if (re && re.test(item.title || '')) hits.push(raw);
    else if (re && rules.matchIn === 'title+content' && re.test(item.content || '')) hits.push(raw);
  }

  for (const word of rules.exclude) {
    if (contains(word.norm)) return { hit: false, keywords: [] };
  }

  if (!hasIncludeRules(rules)) return { hit: true, keywords: [] };

  const allMatched =
    rules.include.every((word) => hits.includes(word.raw)) &&
    rules.regex.every(({ raw }) => hits.includes(raw));

  const hit = rules.includeMode === 'all' ? allMatched : hits.length > 0;
  return { hit, keywords: [...new Set(hits)] };
}

/** 邮件里把命中的关键词高亮出来（输入已转义的 HTML 片段） */
export function highlight(escapedHtml, keywords) {
  let result = escapedHtml;
  const sorted = [...new Set(keywords)].filter(Boolean).sort((a, b) => b.length - a.length);
  for (const word of sorted) {
    const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(
      new RegExp(escapedWord, 'gi'),
      (match) => `<mark style="background:#fff3cd;color:#7a4b00;padding:0 2px;border-radius:2px;">${match}</mark>`,
    );
  }
  return result;
}
