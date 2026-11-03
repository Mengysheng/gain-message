import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { emptyState, markSeen, isSeen, pruneState, saveState, loadState, touchSite, isFirstRun } from '../src/store.js';

const item = (url, title = 't') => ({ url, title });

test('markSeen / isSeen：按站点 + 链接去重', () => {
  const state = emptyState();
  markSeen(state, 'A校', item('https://a.edu.cn/1'));
  assert.equal(isSeen(state, 'A校', 'https://a.edu.cn/1'), true);
  assert.equal(isSeen(state, 'A校', 'https://a.edu.cn/2'), false);
  // 同一链接在另一个站点里算新条目
  assert.equal(isSeen(state, 'B校', 'https://a.edu.cn/1'), false);
});

test('isFirstRun：站点没有成功记录时算首次', () => {
  const state = emptyState();
  assert.equal(isFirstRun(state, 'A校'), true);
  touchSite(state, 'A校', { lastOk: new Date().toISOString() });
  assert.equal(isFirstRun(state, 'A校'), false);
});

test('pruneState：清理过期条目', () => {
  const state = emptyState();
  markSeen(state, 'A校', item('https://a.edu.cn/old'), new Date(Date.now() - 200 * 864e5).toISOString());
  markSeen(state, 'A校', item('https://a.edu.cn/new'));
  const removed = pruneState(state, 120);
  assert.equal(removed, 1);
  assert.equal(isSeen(state, 'A校', 'https://a.edu.cn/old'), false);
  assert.equal(isSeen(state, 'A校', 'https://a.edu.cn/new'), true);
});

test('saveState / loadState：落盘后能读回', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-'));
  const file = path.join(dir, 'state.json');
  const state = emptyState();
  markSeen(state, 'A校', item('https://a.edu.cn/1'));
  saveState(file, state);
  const loaded = loadState(file);
  assert.equal(isSeen(loaded, 'A校', 'https://a.edu.cn/1'), true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('loadState：文件损坏时返回空状态而不是崩溃', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-'));
  const file = path.join(dir, 'broken.json');
  fs.writeFileSync(file, '{ not json');
  assert.deepEqual(loadState(file).items, {});
  fs.rmSync(dir, { recursive: true, force: true });
});
