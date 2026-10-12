// v5 candidate tests: JS parity with Python freeze on every 2026 session with night-futures data, no-future guards,
// missing-data -> throw, production untouched.
'use strict';
const assert = require('node:assert'), fs = require('node:fs'), path = require('node:path');
const root = path.join(__dirname, '..');
const V5 = require('../scripts/v5-weights.cjs');
const BT = require('../scripts/backtest-weights.cjs');
const rd = (dir, n) => JSON.parse(fs.readFileSync(path.join(root, dir, n + '.json'), 'utf8'));
const hsi = rd('research/v4/data', 'HSI').rows, dates = hsi.map(r => r.date);
const overnight = Object.fromEntries(['EWH', 'GSPC', 'IXIC', 'FXI', 'KWEB', 'VIX', 'CNY'].map(k => [k, rd('research/v4/data', k).rows.map(r => ({date: r.date, close: r.close}))]));
const futures60 = rd('research/v5/data', 'HSIF60').rows.map(r => ({t: r.t, close: r.close}));
const sessions = new Map(rd('research/v4/data', 'sessions').rows.map(r => [r.date, r]));
const spec = JSON.parse(fs.readFileSync(path.join(root, 'research/v5/model-v5.json'), 'utf8'));
const score = (date, extra = {}) => { const s = sessions.get(date), i = dates.indexOf(date), bars = hsi.slice(Math.max(0, i - 400), i).map(b => ({...b, time: b.date}));
  return BT.withCalendar(dates, () => V5.scoreScenarioWeightsV5({bars, lower: s.lower, upper: s.upper, cutoff: date + 'T08:45:00+08:00', overnight, futures60, ...extra})); };

let n = 0, maxRaw = 0;
for (const ref of spec.reference_2026) {
  const w = score(ref.date);
  for (const f of spec.features) assert(Math.abs(w.features[f] - ref.x[f]) < 2e-4, ref.date + ' feature ' + f + ' ' + w.features[f] + ' vs ' + ref.x[f]);
  w.raw.forEach((v, j) => { maxRaw = Math.max(maxRaw, Math.abs(v - ref.raw[j])); });
  assert.deepStrictEqual([w.probabilities.A, w.probabilities.B, w.probabilities.C], ref.p, ref.date);
  n++;
}
assert(n >= 185 && maxRaw < 1e-3, 'parity ' + n + ' ' + maxRaw);

// no-future: futures bars after the 08:45 cutoff must not change the result
const last = spec.reference_2026.at(-1).date;
const poisoned = [...futures60.filter(r => r.t <= last + ' 08:45:00'), {t: last + ' 09:15:00', close: 1e9}, {t: '2099-01-01 00:00:00', close: 1e-9}];
assert.deepStrictEqual(score(last).probabilities, score(last, {futures60: poisoned}).probabilities);
// missing night data -> throw (caller falls back to v4)
assert.throws(() => score(last, {futures60: []}), /Missing night futures/);
assert.throws(() => score(last, {futures60: futures60.filter(r => r.t < last.slice(0, 8) + '01')}), /Missing night futures/);
// production untouched
assert(!fs.readFileSync(path.join(root, 'scripts/daily-analysis.cjs'), 'utf8').includes('v5-weights'));
console.log('v5-weights ok', n, 'sessions, max raw diff', maxRaw.toExponential(2));
