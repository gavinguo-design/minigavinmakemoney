// v4 data tests: regenerated sessions reproduce research/backtest/daily-ledger.csv exactly on the 498-day overlap,
// extended HSI equals the repo snapshot, and overnight features only use rows dated before the session.
'use strict';
const assert = require('node:assert'), fs = require('node:fs'), path = require('node:path');
const root = path.join(__dirname, '..');
const S = JSON.parse(fs.readFileSync(path.join(root, 'research/v4/data/sessions.json'), 'utf8')).rows, m = new Map(S.map(r => [r.date, r]));
const L = fs.readFileSync(path.join(root, 'research/backtest/daily-ledger.csv'), 'utf8').trim().split('\n'), h = L[0].split(',');
let n = 0;
for (const line of L.slice(1)) {
  const o = Object.fromEntries(h.map((k, i) => [k, line.split(',')[i]])), r = m.get(o.date);
  assert(r, 'missing ' + o.date); assert.strictEqual(r.outcome, o.outcome, o.date);
  assert(Math.abs(r.lower - +o.lower) < 1e-6 && Math.abs(r.upper - +o.upper) < 1e-6, o.date);
  for (const k of ['A', 'B', 'C']) assert(Math.abs(r.v1[k] - +o['rule-weights-v1_' + k]) < 1e-9, o.date);
  n++;
}
assert.strictEqual(n, 498);
const man = JSON.parse(fs.readFileSync(path.join(root, 'research/v4/data/manifest.json'), 'utf8'));
assert.strictEqual(man.hsi_crosscheck.max_abs_ohlc_diff, 0); assert.strictEqual(man.hsi_crosscheck.missing_in_new.length, 0);
const F = JSON.parse(fs.readFileSync(path.join(root, 'research/v4/data/features.json'), 'utf8')).rows;
for (const f of F) for (const k of ['GSPC', 'IXIC', 'EWH', 'FXI', 'KWEB', 'VIX', 'CNY']) if (f[k + '_last']) assert(f[k + '_last'] < f.date, f.date + ' ' + k);
console.log('v4-generate ok', n, 'overlap sessions;', S.length, 'sessions total');
