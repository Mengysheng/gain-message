#!/usr/bin/env node
/**
 * 复查历史运行：把 state/state.json 的每次提交翻译成「这一轮哪个站点成功、哪个超时」。
 *
 *   node tools/run-history.mjs            # 最近 30 次
 *   node tools/run-history.mjs 60         # 最近 60 次
 *
 * 为什么需要它：GitHub Actions 的邮件只告诉你结果，看不出趋势。
 * 这个脚本直接读提交历史——每一轮跑完工作流都会提交一次 state，
 * 里面记着每个站点的 lastOk / lastError，按时间排开就能看出「到底是站点的问题还是链路的问题」。
 */
import { execSync } from 'node:child_process';

const limit = Number(process.argv[2] || 30);

const git = (cmd) => execSync(cmd, { encoding: 'utf8', maxBuffer: 1 << 26 }).trim();

function ref() {
  for (const candidate of ['origin/main', 'HEAD']) {
    try {
      git(`git rev-parse --verify ${candidate}`);
      return candidate;
    } catch {
      // 试下一个
    }
  }
  throw new Error('不在 git 仓库里？');
}

const toLocal = (iso, tz = 'Asia/Shanghai') =>
  new Intl.DateTimeFormat('zh-CN', {
    timeZone: tz,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(new Date(iso))
    .replace(/\//g, '-');

const branch = ref();
const shas = git(`git log ${branch} --pretty=%h -${limit} -- state/state.json`).split('\n').filter(Boolean);

if (!shas.length) {
  console.log('还没找到 state/state.json 的提交记录。');
  process.exit(0);
}

console.log(`分支 ${branch}，最近 ${shas.length} 次运行（时间为北京时间）\n`);

let okTotal = 0;
let siteTotal = 0;
let greenRuns = 0;

for (const sha of shas.reverse()) {
  const date = git(`git log -1 --format=%cI ${sha}`);
  let state;
  try {
    state = JSON.parse(git(`git show ${sha}:state/state.json`));
  } catch {
    continue;
  }
  const names = Object.keys(state.sites || {});
  const cells = [];
  let okCount = 0;

  for (const name of names) {
    const site = state.sites[name];
    // 这一轮成功了：lastOk 与本次提交时间相差不到 5 分钟
    const ok = site.lastOk && Math.abs(new Date(site.lastOk) - new Date(date)) < 5 * 60e3;
    if (ok) okCount += 1;
    cells.push(ok ? '✓' : `✗(${site.lastOk ? toLocal(site.lastOk) : '从未成功'})`);
  }

  siteTotal += names.length;
  okTotal += okCount;
  if (okCount === names.length) greenRuns += 1;

  const verdict = okCount === names.length ? '全部成功' : okCount === 0 ? '全部失败' : `${okCount}/${names.length}`;
  console.log(`${toLocal(date)}  ${cells.join('  ')}   ${verdict}`);
}

const rate = siteTotal ? Math.round((okTotal / siteTotal) * 100) : 0;
console.log(`\n汇总：${shas.length} 次运行里 ${greenRuns} 次全绿；站点抓取成功率 ${rate}%（${okTotal}/${siteTotal}）`);
