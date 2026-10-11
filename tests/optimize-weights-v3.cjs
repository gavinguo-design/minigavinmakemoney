'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const BT = require('../scripts/backtest-weights.cjs');
const V3 = require('../scripts/weights-v3.cjs');
const DA = require('../scripts/daily-analysis.cjs');
const REF = require('../research/optimization/lr-c692d60-reference.json');
const data = BT.loadData();
const barsBefore = t => data.candles.filter(b => b.date < t).map(b => ({...b, time: b.date}));
const sample = REF.rows.filter((_, i) => i % 7 === 0);
const {rows} = BT.runBacktest({data, end: '2026-10-09'});
const rules = new Map(rows.map(r => [r.date, r]));

test('production default is still v1 (candidate is not wired in)', () => {
  assert.equal(DA.WEIGHT_MODEL.version, 'rule-weights-v1');
  assert.equal(V3.WEIGHT_MODEL_V3.version, 'rule-weights-v3-candidate');
});

test('v3 reproduces the evaluated c692d60 logistic model exactly (sampled sessions)', () => {
  assert.deepEqual(V3.WEIGHT_MODEL_V3.W.map(w => [...w]), REF.W);
  for (const s of sample) {
    const r = rules.get(s.date), w = V3.scoreScenarioWeightsV3({bars: barsBefore(s.date), lower: r.lower, upper: r.upper, cutoff: s.date + 'T08:45:00+08:00'});
    assert.deepEqual(w.probabilities, s.p, s.date);
  }
});

test('v3 for t ignores bars on/after t and rejects bars after cutoff', () => {
  const t = '2026-03-04', r = rules.get(t), bars = barsBefore(t);
  const a = V3.scoreScenarioWeightsV3({bars, lower: r.lower, upper: r.upper, cutoff: t + 'T08:45:00+08:00'});
  const later = data.candles.filter(b => b.date >= t).map(b => ({...b, time: b.date, close: b.close * 2, high: b.high * 2}));
  assert.throws(() => V3.scoreScenarioWeightsV3({bars: bars.concat(later), lower: r.lower, upper: r.upper, cutoff: t + 'T08:45:00+08:00'}), /after cutoff/);
  // previous-zone feature equals the realised outcome of t-1 under t-1's own rules
  const prevDate = bars.at(-1).date; assert.equal(a.factors.prev_zone, rules.get(prevDate).outcome);
});

test('v3 probabilities are valid and bounded [0.10,0.85] step 0.05', () => {
  for (const s of sample) {
    const r = rules.get(s.date), p = V3.scoreScenarioWeightsV3({bars: barsBefore(s.date), lower: r.lower, upper: r.upper, cutoff: s.date + 'T08:45:00+08:00'}).probabilities;
    assert.ok(Math.abs(p.A + p.B + p.C - 1) < 1e-9);
    for (const k of ['A', 'B', 'C']) { assert.ok(p[k] >= 0.10 - 1e-9 && p[k] <= 0.85 + 1e-9); assert.ok(Math.abs(p[k] * 20 - Math.round(p[k] * 20)) < 1e-6); }
  }
});
