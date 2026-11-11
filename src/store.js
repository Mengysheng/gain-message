import fs from 'node:fs';
import path from 'node:path';
import { sha1 } from './util.js';

const EMPTY = () => ({ version: 1, sites: {}, items: {}, meta: {} });

export function emptyState() {
  return EMPTY();
}

export function loadState(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!data || typeof data !== 'object') return emptyState();
    return {
      version: data.version || 1,
      sites: data.sites && typeof data.sites === 'object' ? data.sites : {},
      items: data.items && typeof data.items === 'object' ? data.items : {},
      meta: data.meta && typeof data.meta === 'object' ? data.meta : {},
    };
  } catch {
    return emptyState();
  }
}

export function saveState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
}

export function itemKey(siteName, url) {
  return `${siteName}#${sha1(url).slice(0, 16)}`;
}

export function isSeen(state, siteName, url) {
  return Boolean(state.items[itemKey(siteName, url)]);
}

export function markSeen(state, siteName, item, now = new Date().toISOString()) {
  const key = itemKey(siteName, item.url);
  const existing = state.items[key];
  state.items[key] = {
    url: item.url,
    title: item.title,
    site: siteName,
    firstSeen: existing?.firstSeen || now,
    lastSeen: now,
  };
  return key;
}

export function touchSite(state, siteName, patch) {
  state.sites[siteName] = { ...(state.sites[siteName] || {}), ...patch };
}

/** 控制 state 体积：默认保留 120 天内出现过的条目 */
export function pruneState(state, retentionDays = 120, now = Date.now()) {
  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const [key, value] of Object.entries(state.items)) {
    if (new Date(value.lastSeen).getTime() < cutoff) {
      delete state.items[key];
      removed += 1;
    }
  }
  return removed;
}

/** 站点是否第一次运行（决定要不要发一份“最近若干条”的样例） */
export function isFirstRun(state, siteName) {
  return !state.sites[siteName]?.lastOk;
}

/**
 * 记录一次成功 / 失败。
 * failStreak 用来做告警降噪：链路抖一下不值得发邮件，连续失败才值得。
 */
export function recordSiteOk(state, siteName, patch = {}) {
  touchSite(state, siteName, { ...patch, lastError: null, failStreak: 0 });
}

export function recordSiteFail(state, siteName, error, patch = {}) {
  const prev = Number(state.sites[siteName]?.failStreak || 0);
  touchSite(state, siteName, { ...patch, lastError: String(error), failStreak: prev + 1 });
  return prev + 1;
}

export function failStreak(state, siteName) {
  return Number(state.sites[siteName]?.failStreak || 0);
}
