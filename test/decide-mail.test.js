import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSiteRows, decideMail, heartbeatIntervalHours } from '../src/cli.js';
import { emptyState, recordSiteFail, recordSiteOk } from '../src/store.js';

const HOUR = 3600e3;

function config(overrides = {}) {
  return {
    timezone: 'Asia/Shanghai',
    email: {
      subject_prefix: '[通告雷达]',
      send_on_error: true,
      error_alerts: { enabled: true, after_consecutive_failures: 3 },
      heartbeat: { enabled: true, min_interval_hours: 20 },
      ...overrides,
    },
  };
}

const err = (name, streak) => ({ name, message: '抓取失败：连接超时', failStreak: streak });

test('decideMail：刚发过信、又没有新通告时，什么都不发', () => {
  const state = emptyState();
  state.meta.lastHeartbeatAt = new Date(Date.now() - 1 * HOUR).toISOString();
  const plan = decideMail({ config: config(), state, errors: [], totalHits: 0 });
  assert.equal(plan.send, false);
  assert.equal(plan.kind, null);
});

test('decideMail：静默超过心跳间隔就发心跳', () => {
  const state = emptyState();
  state.meta.lastHeartbeatAt = new Date(Date.now() - 21 * HOUR).toISOString();
  const plan = decideMail({ config: config(), state, errors: [], totalHits: 0 });
  assert.equal(plan.send, true);
  assert.equal(plan.kind, 'heartbeat');
  assert.equal(plan.heartbeatDue, true);
});

test('decideMail：从来没发过信也算心跳到期', () => {
  const plan = decideMail({ config: config(), state: emptyState(), errors: [] });
  assert.equal(plan.kind, 'heartbeat');
});

test('decideMail：有命中就发汇总，即使心跳也到期', () => {
  const plan = decideMail({ config: config(), state: emptyState(), errors: [], totalHits: 2 });
  assert.equal(plan.kind, 'digest');
});

test('decideMail：站点偶发失败一次不发告警（降噪）', () => {
  const state = emptyState();
  state.meta.lastHeartbeatAt = new Date(Date.now() - 1 * HOUR).toISOString();
  const plan = decideMail({ config: config(), state, errors: [err('教务处', 1)], totalHits: 0 });
  assert.equal(plan.send, false);
  assert.equal(plan.suppressed.length, 1);
  assert.equal(plan.alerting.length, 0);
});

test('decideMail：连续失败到阈值才发告警', () => {
  const plan = decideMail({ config: config(), state: emptyState(), errors: [err('教务处', 3)] });
  assert.equal(plan.send, true);
  assert.equal(plan.kind, 'digest');
  assert.equal(plan.alerting.length, 1);
});

test('decideMail：error_alerts.enabled=false 时恢复「一失败就发」', () => {
  const cfg = config({ error_alerts: { enabled: false, after_consecutive_failures: 3 } });
  const plan = decideMail({ config: cfg, state: emptyState(), errors: [err('教务处', 1)] });
  assert.equal(plan.send, true);
  assert.equal(plan.alerting.length, 1);
});

test('decideMail：send_on_error=false 时不出告警，但心跳照旧', () => {
  const state = emptyState();
  state.meta.lastHeartbeatAt = new Date(Date.now() - 21 * HOUR).toISOString();
  const plan = decideMail({ config: config({ send_on_error: false }), state, errors: [err('教务处', 5)] });
  assert.equal(plan.kind, 'heartbeat');
});

test('decideMail：心跳可以单独关掉', () => {
  const state = emptyState();
  state.meta.lastHeartbeatAt = new Date(Date.now() - 100 * HOUR).toISOString();
  const plan = decideMail({
    config: config({ heartbeat: { enabled: false, min_interval_hours: 20 } }),
    state,
    errors: [],
  });
  assert.equal(plan.send, false);
});

test('heartbeatIntervalHours：缺省 20 小时，最少 1 小时', () => {
  assert.equal(heartbeatIntervalHours(config()), 20);
  assert.equal(heartbeatIntervalHours({ email: { heartbeat: { min_interval_hours: 0 } } }), 1);
});

test('buildSiteRows：失败站点带 failStreak，成功站点带上次成功时间', () => {
  const state = emptyState();
  recordSiteOk(state, '教务处', { lastOk: '2026-11-10T00:59:00.000Z', lastCount: 13 });
  recordSiteFail(state, '就业网', '连接超时');
  recordSiteFail(state, '就业网', '连接超时');

  const sites = [
    { name: '教务处', url: 'https://a.edu.cn/list' },
    { name: '就业网', url: 'https://b.edu.cn/list' },
  ];
  const rows = buildSiteRows(state, sites, [err('就业网', 2)], 'Asia/Shanghai');

  assert.equal(rows[0].ok, true);
  assert.equal(rows[0].lastOk, '2026-11-10 08:59');
  assert.equal(rows[1].ok, false);
  assert.equal(rows[1].failStreak, 2);
  assert.match(rows[1].error, /连接超时/);
});
