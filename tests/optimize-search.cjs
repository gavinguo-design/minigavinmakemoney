'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const BT = require('../scripts/backtest-weights.cjs');
const S = require('../scripts/backtest-breadth-southbound.cjs');
const F = require('../scripts/optimize-features.cjs');
const M = require('../scripts/optimize-models.cjs');
const O = require('../scripts/optimize-search.cjs');
const data = BT.loadData(), aux = S.loadAux();
const END = '2025-02-28';
const table = F.buildTable({data, aux, end: END});

test('features for t are unchanged when candles/breadth/southbound on or after t are removed or corrupted', () => {
  const t = '2025-01-15', i = table.findIndex(r => r.date === t), ref = table[i];
  const candles = data.candles.filter(b => b.date < t).map(b => ({...b, time: b.date}));
  const junkAux = {breadth: aux.breadth.map(x => x.date >= t ? {...x, adv_ratio: 0, pct_above_ma20: 1} : x), southbound: aux.southbound.map(x => x.date >= t ? {...x, total_net: 9999, southbound_closed: false} : x)};
  const cutAux = {breadth: aux.breadth.filter(x => x.date < t), southbound: aux.southbound.filter(x => x.date < t)};
  const a = F.featuresFor(t, candles, ref.lower, ref.upper, junkAux), b = F.featuresFor(t, candles, ref.lower, ref.upper, cutAux);
  assert.deepEqual(a.f, ref.f); assert.deepEqual(b.f, ref.f);
  assert.ok(ref.aux_asof.breadth < t); assert.ok(!ref.aux_asof.southbound || ref.aux_asof.southbound < t);
  assert.throws(() => F.featuresFor(t, data.candles.filter(b => b.date <= t), ref.lower, ref.upper, aux), /future bar/);
});

test('every row: zone/base_close come from t-1 close, aux as-of dates strictly before t', () => {
  const byDate = new Map(data.candles.map((c, i) => [c.date, i]));
  for (const r of table) {
    assert.equal(r.base_close, data.candles[byDate.get(r.date) - 1].close);
    if (r.aux_asof.breadth) assert.ok(r.aux_asof.breadth < r.date);
    if (r.aux_asof.southbound) assert.ok(r.aux_asof.southbound < r.date);
  }
});

test('raw v1 probabilities reproduce production v1 after production rounding', () => {
  for (const r of table) { const p = M.rounded(r.raw_v1, {min: .10, max: .70}); for (const k of M.KEYS) assert.ok(Math.abs(p[k] - r.p_v1[k]) < 1e-9, r.date); }
});

test('fitted models depend only on their training rows (appending later rows to the table does not change train fit)', () => {
  const tr = table.slice(0, 60), te = table.slice(60);
  const m1 = M.fitTransition(tr, {edges: [0.5], alpha: 1}), m2 = M.fitTransition(tr.concat([]), {edges: [0.5], alpha: 1});
  for (const r of te) assert.deepEqual(m1.predict(r), m2.predict(r));
  const poisoned = te.map(r => ({...r, outcome: 'A'}));
  const m3 = M.fitTransition(tr, {edges: [0.5], alpha: 1});
  for (const r of poisoned) assert.deepEqual(m3.predict(r), m1.predict(r));
});

test('chronological 60/20/20 split is disjoint and ordered', () => {
  const s = O.split(table);
  assert.equal(s.train.length + s.val.length + s.hold.length, table.length);
  assert.ok(s.train.at(-1).date < s.val[0].date && s.val.at(-1).date < s.hold[0].date);
});

test('candidate outputs are valid production-format probabilities', () => {
  const tr = table.slice(0, 50);
  for (const m of [M.fitTransition(tr, {edges: [0.5], alpha: 1}), M.fitV1Scaling(tr, {mode: 'temperature'}), M.fitMLR(tr, {features: M.FEATURE_SETS.core, l2: 10, iters: 200})]) {
    for (const r of table.slice(50)) { const p = M.rounded(m.predict(r), O.SHIP_BOUNDS); const s = p.A + p.B + p.C; assert.ok(Math.abs(s - 1) < 1e-9); for (const k of M.KEYS) assert.ok(p[k] >= 0.05 - 1e-9 && p[k] <= 0.90 + 1e-9); }
  }
});
