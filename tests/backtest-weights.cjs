const test = require('node:test'), assert = require('node:assert/strict');
const BT = require('../scripts/backtest-weights.cjs');
const MR = require('../investment/chart/market-rules.js');
const data = BT.loadData();
const dates = data.candles.map(c => c.date);
const sample = ['2024-10-02', '2025-04-08', '2025-12-31', '2026-03-04', '2026-10-06'];

test('future candles (shuffled, perturbed or removed) never change rules or weights of session t', () => {
  for (const t of sample) {
    const ref = BT.generateDay(t, data.candles, dates);
    const after = data.candles.filter(c => c.date >= t);
    // shuffle prices among future sessions and inflate them
    const shuffled = after.map((c, i) => { const s = after[(i * 7 + 3) % after.length]; return {date: c.date, open: s.open * 3, high: s.high * 3, low: s.low * 3, close: s.close * 3}; });
    const polluted = [...data.candles.filter(c => c.date < t), ...shuffled];
    assert.deepEqual(BT.generateDay(t, polluted, dates), ref, 'shuffle leak at ' + t);
    assert.deepEqual(BT.generateDay(t, data.candles.filter(c => c.date < t), dates), ref, 'truncation leak at ' + t);
  }
});

test('history baseline uses only outcomes realised before t; persistence uses t-1', () => {
  const b = BT.baselines(['B', 'B', 'A']);
  assert.deepEqual(b.persistence, {A: 0.6, B: 0.2, C: 0.2});
  assert.equal(Math.round(b.hist_freq.B * 1e6), Math.round(3 / 6 * 1e6));
  const {rows} = BT.runBacktest({data, start: '2025-06-02', end: '2025-06-20'});
  const full = BT.runBacktest({data, start: '2025-06-02', end: '2025-06-30'}).rows;
  assert.deepEqual(full.slice(0, rows.length), rows, 'later end date altered earlier rows');
});

test('outcome judge is the MarketRules partition and covers boundaries exactly once', () => {
  const rules = {A: {operator: 'gte', value: 200}, B: {operator: 'range', lower: 100, upper: 200}, C: {operator: 'lt', value: 100}};
  assert.equal(BT.judgeOutcome(rules, 200), 'A'); assert.equal(BT.judgeOutcome(rules, 100), 'B'); assert.equal(BT.judgeOutcome(rules, 99.99), 'C');
  assert.equal(MR.priceCondition(rules.B, 150), true);
});

test('calendar extension is scoped and restored', () => {
  assert.equal(MR.tradingDay('2025-03-03'), null);
  BT.withCalendar(dates, () => assert.equal(MR.tradingDay('2025-03-03'), true));
  assert.equal(MR.tradingDay('2025-03-03'), null);
  assert.equal(MR.tradingDay('2026-10-09'), true);
});

test('scoring math: Brier, log loss, hit and calibration', () => {
  assert.equal(BT.brier({A: 1, B: 0, C: 0}, 'A'), 0);
  assert.equal(Math.round(BT.brier({A: 1 / 3, B: 1 / 3, C: 1 / 3}, 'B') * 1e4), 6667);
  assert.equal(BT.hit({A: 0.4, B: 0.4, C: 0.2}, 'A'), 0.5);
  assert.ok(Math.abs(BT.logloss({A: 0.5, B: 0.25, C: 0.25}, 'A') - Math.log(2)) < 1e-12);
  const ci = BT.blockBootstrap([1, 1, 1, 1]); assert.deepEqual([ci.lo, ci.hi], [1, 1]);
});

test('full run is deterministic, covers the window and every day has one outcome', () => {
  const a = BT.runBacktest({data}), b = BT.runBacktest({data});
  assert.deepEqual(a, b);
  for (const r of a.rows) assert.ok(r.p['rule-weights-v1'] && r.p['rule-weights-v2.1'] && r.v2_regime, 'both models + v2.1 regime at ' + r.date);
  assert.equal(a.skipped.length, 0);
  assert.equal(a.rows[0].date, '2024-10-02'); assert.equal(a.rows.at(-1).date, '2026-10-09');
  for (const r of a.rows) for (const m of Object.keys(r.p)) assert.ok(Math.abs(r.p[m].A + r.p[m].B + r.p[m].C - 1) < 1e-9, m + ' ' + r.date);
});

test('Yahoo snapshot matches repository Futu candles on the overlap', () => {
  const futu = require('../investment/chart/kline_futu.json').candles, m = new Map(data.candles.map(c => [c.date, c]));
  for (const c of futu) for (const f of ['open', 'high', 'low', 'close']) assert.ok(Math.abs(m.get(c.date)[f] - c[f]) <= 1, c.date + f);
});
