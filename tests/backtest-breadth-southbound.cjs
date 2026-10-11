const test = require('node:test'), assert = require('node:assert/strict');
const S = require('../scripts/backtest-breadth-southbound.cjs');
const BT = require('../scripts/backtest-weights.cjs');
const data = BT.loadData(), aux = S.loadAux();
const sample = ['2024-10-03', '2025-01-02', '2025-04-08', '2025-10-08', '2026-03-04', '2026-10-09'];

test('signals for t use only rows dated before t (future rows removed or perturbed: no change)', () => {
  for (const t of sample) {
    const b = S.breadthSignal(t, aux.breadth), s = S.southboundSignal(t, aux.southbound);
    assert.ok(!b.as_of || b.as_of < t); assert.ok(!s.as_of || s.as_of < t);
    const cutB = aux.breadth.filter(x => x.date < t), cutS = aux.southbound.filter(x => x.date < t);
    const junkB = aux.breadth.map(x => x.date >= t ? {...x, adv_ratio: 1 - x.adv_ratio, pct_above_ma20: 0.01} : x);
    const junkS = aux.southbound.map(x => x.date >= t ? {...x, total_net: 1e6, southbound_closed: false} : x);
    assert.deepEqual(S.breadthSignal(t, cutB), b); assert.deepEqual(S.breadthSignal(t, junkB), b);
    assert.deepEqual(S.southboundSignal(t, cutS), s); assert.deepEqual(S.southboundSignal(t, junkS), s);
  }
});

test('southbound holiday on t-1 falls back to latest open session and is flagged stale', () => {
  const rows = aux.southbound, i = rows.findIndex((x, k) => k > 80 && x.southbound_closed);
  assert.ok(i > 0);
  let j = i; while (rows[j].southbound_closed) j++;
  const s = S.southboundSignal(rows[j].date, rows);
  assert.equal(s.stale, true);
  const lastOpen = rows.slice(0, i).filter(x => !x.southbound_closed).at(-1).date;
  assert.equal(s.as_of, lastOpen);
  assert.ok(s.score >= -1 && s.score <= 1);
});

test('first sessions without 60 prior open days give zero southbound tilt', () => {
  const s = S.southboundSignal('2024-10-08', aux.southbound);
  assert.equal(s.status, 'insufficient_history'); assert.equal(s.score, 0);
});

test('comparison rows: v1 replica matches production, future aux data cannot leak, probabilities valid', () => {
  const end = '2025-01-15';
  const ref = S.runComparison({data, aux, end});
  const t = '2025-01-02', polluted = {breadth: aux.breadth.map(x => x.date >= t ? {...x, adv_ratio: 0, pct_above_ma20: 0} : x), southbound: aux.southbound.map(x => x.date >= t ? {...x, total_net: -9999} : x)};
  const alt = S.runComparison({data, aux: polluted, end});
  for (let i = 0; i < ref.length; i++) {
    const r = ref[i];
    if (r.date <= t) assert.deepEqual(alt[i].p, r.p, 'leak at ' + r.date);
    for (const m of Object.keys(r.p)) assert.ok(Math.abs(r.p[m].A + r.p[m].B + r.p[m].C - 1) < 1e-9, m + r.date);
  }
});

test('frozen spec and tilt direction', () => {
  assert.equal(S.SPEC.breadth_coef, 0.4); assert.equal(S.SPEC.southbound_coef, 0.3); assert.equal(S.SPEC.sb_window, 60);
  const L = {A: 0, B: 0.5, C: 0}, up = S.toProb(S.tilted(L, 0.4)), dn = S.toProb(S.tilted(L, -0.4));
  assert.ok(up.A > up.C); assert.ok(dn.C > dn.A);
});
