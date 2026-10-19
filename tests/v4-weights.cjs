// v4 tests: JS parity with the Python freeze on every 2026 session, no-future guards,
// production identity (rule-weights-v4 = frozen candidate coefficients), and point-in-time overnight handling.
'use strict';
const assert = require('node:assert'), fs = require('node:fs'), path = require('node:path');
const root = path.join(__dirname, '..');
const V4 = require('../scripts/v4-weights.cjs');
const DA = require('../scripts/daily-analysis.cjs');
const BT = require('../scripts/backtest-weights.cjs');
const rd = n => JSON.parse(fs.readFileSync(path.join(root, 'research/v4/data', n + '.json'), 'utf8'));
const hsi = rd('HSI').rows, dates = hsi.map(r => r.date);
const overnight = Object.fromEntries(['EWH', 'GSPC', 'IXIC', 'FXI', 'KWEB', 'VIX', 'CNY'].map(k => [k, rd(k).rows.map(r => ({date: r.date, close: r.close}))]));
const sessions = new Map(rd('sessions').rows.map(r => [r.date, r]));
const spec = JSON.parse(fs.readFileSync(path.join(root, 'research/v4/model-v4.json'), 'utf8'));

let n = 0, maxRaw = 0;
for (const ref of spec.reference_2026) {
  const s = sessions.get(ref.date), i = dates.indexOf(ref.date), bars = hsi.slice(Math.max(0, i - 400), i).map(b => ({...b, time: b.date}));
  const w = BT.withCalendar(dates, () => V4.scoreScenarioWeightsV4({bars, lower: s.lower, upper: s.upper, cutoff: ref.date + 'T08:45:00+08:00', overnight, model: V4.WEIGHT_MODEL_V4_CANDIDATE}));
  for (const f of spec.features) assert(Math.abs(w.features[f] - ref.x[f]) < 2e-4, ref.date + ' feature ' + f + ' ' + w.features[f] + ' vs ' + ref.x[f]);
  w.raw.forEach((v, j) => { maxRaw = Math.max(maxRaw, Math.abs(v - ref.raw[j])); });
  assert.deepStrictEqual([w.probabilities.A, w.probabilities.B, w.probabilities.C], ref.p, ref.date);
  n++;
}
assert(n >= 190 && maxRaw < 1e-3, 'parity ' + n + ' ' + maxRaw);
// round1 C5: production keeps the frozen W but publishes on [0.03,0.95] step 0.01 (raw identical, only the output format differs)
{ const r = spec.reference_2026[0], s0 = sessions.get(r.date), i0 = dates.indexOf(r.date), b0 = hsi.slice(Math.max(0, i0 - 400), i0).map(b => ({...b, time: b.date}));
  const w = BT.withCalendar(dates, () => V4.scoreScenarioWeightsV4({bars: b0, lower: s0.lower, upper: s0.upper, cutoff: r.date + 'T08:45:00+08:00', overnight}));
  assert.deepStrictEqual(V4.WEIGHT_MODEL_V4.bounds, {min: 0.03, max: 0.95, step: 0.01});
  assert.deepStrictEqual([w.probabilities.A, w.probabilities.B, w.probabilities.C], DA.boundedRound(w.raw, V4.BOUNDS_V4)); }

// no-future: overnight rows dated on/after the session must not change the result
const ref = spec.reference_2026.at(-1), s = sessions.get(ref.date), i = dates.indexOf(ref.date), bars = hsi.slice(i - 400, i).map(b => ({...b, time: b.date}));
const poisoned = Object.fromEntries(Object.entries(overnight).map(([k, v]) => [k, [...v.filter(r => r.date < ref.date), {date: ref.date, close: 1e9}, {date: '2099-01-01', close: 1e-9}]]));
const a = BT.withCalendar(dates, () => V4.scoreScenarioWeightsV4({bars, lower: s.lower, upper: s.upper, cutoff: ref.date + 'T08:45:00+08:00', overnight}));
const b = BT.withCalendar(dates, () => V4.scoreScenarioWeightsV4({bars, lower: s.lower, upper: s.upper, cutoff: ref.date + 'T08:45:00+08:00', overnight: poisoned}));
assert.deepStrictEqual(a.probabilities, b.probabilities);
// future HSI bar rejected
assert.throws(() => BT.withCalendar(dates, () => V4.scoreScenarioWeightsV4({bars: [...bars, {...hsi[i], time: hsi[i].date}], lower: s.lower, upper: s.upper, cutoff: ref.date + 'T08:45:00+08:00', overnight})), /after cutoff/);
// missing series -> throws (caller must fall back to v3), never imputes
assert.throws(() => BT.withCalendar(dates, () => V4.scoreScenarioWeightsV4({bars, lower: s.lower, upper: s.upper, cutoff: ref.date + 'T08:45:00+08:00', overnight: {...overnight, EWH: []}})), /Missing overnight/);
// production identity: v4 is wired into build() with the frozen candidate coefficients; v3 stays importable as shadow/fallback
assert.strictEqual(require('../scripts/weights-v3.cjs').WEIGHT_MODEL_V3.version, 'rule-weights-v3');
assert.strictEqual(V4.WEIGHT_MODEL_V4.version, 'rule-weights-v4');
assert.deepStrictEqual(V4.WEIGHT_MODEL_V4.W, spec.W); assert.deepStrictEqual(V4.WEIGHT_MODEL_V4.standardize, spec.standardize);
assert(fs.readFileSync(path.join(root, 'scripts/daily-analysis.cjs'), 'utf8').includes('v4-weights'));
console.log('v4-weights ok', n, 'sessions, max raw diff', maxRaw.toExponential(2));
