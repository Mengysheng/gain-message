import test from 'node:test';
import assert from 'node:assert/strict';
import { compileRules, matchItem, highlight } from '../src/match.js';

const item = (title, content = '') => ({ title, content, url: 'https://a.edu.cn/1' });

test('include：命中任意一个关键词', () => {
  const rules = compileRules({ include: ['推免', '夏令营'] });
  assert.equal(matchItem(item('关于2026年推免工作的通知'), rules).hit, true);
  assert.equal(matchItem(item('关于2026年夏令营的通知'), rules).hit, true);
  assert.equal(matchItem(item('关于食堂开放时间的通知'), rules).hit, false);
});

test('include：返回命中的关键词用于高亮', () => {
  const rules = compileRules({ include: ['推免', '报名'] });
  const result = matchItem(item('2026年推免报名通知'), rules);
  assert.deepEqual(result.keywords.sort(), ['报名', '推免'].sort());
});

test('include_mode=all：必须全部命中', () => {
  const rules = compileRules({ include: ['推免', '计算机'], include_mode: 'all' });
  assert.equal(matchItem(item('推免工作通知'), rules).hit, false);
  assert.equal(matchItem(item('计算机学院推免工作通知'), rules).hit, true);
});

test('exclude：命中排除词直接丢弃', () => {
  const rules = compileRules({ include: ['报名'], exclude: ['招聘'] });
  assert.equal(matchItem(item('招聘报名通知'), rules).hit, false);
  assert.equal(matchItem(item('期末考试报名通知'), rules).hit, true);
});

test('regex：正则规则生效', () => {
  const rules = compileRules({ regex: ['20\\d{2}年.*(保研|推免)'] });
  assert.equal(matchItem(item('2026年保研名额分配'), rules).hit, true);
  assert.equal(matchItem(item('2026年运动会'), rules).hit, false);
});

test('match_in=title+content：正文命中', () => {
  const rules = compileRules({ include: ['面试'], match_in: 'title+content' });
  assert.equal(matchItem(item('学院通知', '请于周五参加面试'), rules).hit, true);
  assert.equal(matchItem(item('学院通知', '请于周五参加体检'), rules).hit, false);
});

test('默认只匹配标题，不看正文', () => {
  const rules = compileRules({ include: ['面试'] });
  assert.equal(matchItem(item('学院通知', '请于周五参加面试'), rules).hit, false);
});

test('没有配置关键词时全部命中', () => {
  const rules = compileRules({});
  assert.equal(matchItem(item('任意通知'), rules).hit, true);
});

test('highlight：只高亮一次且不破坏 HTML 转义', () => {
  const out = highlight('关于&amp;推免的通知', ['推免', '推免']);
  assert.equal((out.match(/<mark/g) || []).length, 1);
  assert.ok(out.includes('&amp;'));
});
