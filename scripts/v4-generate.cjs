// v4 research: regenerate historical A/B/C scenarios + outcomes for 2014..2026 with the SAME
// production machinery as scripts/backtest-weights.cjs (DA.build + price_rule + MR.priceCondition),
// using the extended Yahoo ^HSI history in research/v4/data/HSI.json. Calendar extension = observed
// HKEX session dates (same approach as backtest-weights.cjs withCalendar). Research only.
// Output: research/v4/data/sessions.json (one row per session with model-free fields + v1/v3-frozen probs + v3 features).
'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = path.join(__dirname, '..');
const BT = require('./backtest-weights.cjs');
const DA = require('./daily-analysis.cjs');
const V3 = require('./weights-v3.cjs');
const TA = require('../investment/chart/technical-analysis.js');

const hsi = JSON.parse(fs.readFileSync(path.join(root, 'research/v4/data/HSI.json'), 'utf8'));
const candles = hsi.rows.map(({date, open, high, low, close, volume}) => ({date, open, high, low, close, volume}));
const dates = candles.map(c => c.date), byDate = new Map(candles.map(c => [c.date, c]));
const r4 = v => v == null ? null : Math.round(v * 1e4) / 1e4;

// The repo calendar only knows 2026/2027 and fails closed; backtest-weights' withCalendar extends it with
// observed sessions for dates >= first candle. Yahoo 2026 dates were verified equal to MR.tradingDay.
const rows = [], skipped = [];
const t0 = Date.now();
const WINDOW = 400; // bars passed to build(): pivots/ATR/MA/ADX only look back <= ~60 bars; 400 keeps results identical (verified by tests/v4-generate.cjs)
for (let i = 0; i < dates.length; i++) {
  const date = dates[i];
  const past = candles.slice(Math.max(0, i - WINDOW), i);
  if (past.length < 60) continue;
  let g;
  try {
    g = BT.withCalendar(dates, () => {
      const feed = {symbol: '^HSI', source: 'research/v4 Yahoo ^HSI 2014+', updated_at: date + 'T08:40:00+08:00', candles: past};
      const a = DA.build({date, feed, seed: null, participation: null, generatedAt: date + 'T08:45:00+08:00', backfill: true, ruleWeights: true});
      const rules = Object.fromEntries(a.forecast.scenarios.map(s => [s.id, s.price_rule]));
      const f = a.forecast.weight_model_info.factors, bars = past.map(b => ({...b, time: b.date}));
      const cutoff = date + 'T08:45:00+08:00';
      const v1 = DA.scoreScenarioWeights({bars, lower: f.lower, upper: f.upper, participation: null, cutoff, dataUpdatedAt: feed.updated_at, model: DA.WEIGHT_MODEL_V1});
      const v21 = DA.scoreScenarioWeights({bars, lower: f.lower, upper: f.upper, participation: null, cutoff, dataUpdatedAt: feed.updated_at, model: DA.WEIGHT_MODEL_V2});
      const v3 = V3.scoreScenarioWeightsV3({bars, lower: f.lower, upper: f.upper, cutoff});
      const d = TA.calculate(bars), k = bars.length - 1;
      return {rules, lower: f.lower, upper: f.upper, atr14: d.atr[k], ma20: d.ma20[k], v1, v21, v3, prodA: a.forecast.scenarios[0].probability};
    });
  } catch (e) { skipped.push({date, reason: e.message}); continue; }
  if (g.prodA !== g.v3.probabilities.A) throw Error('build/v3 mismatch ' + date);
  const outcome = BT.judgeOutcome(g.rules, byDate.get(date).close);
  const last = past.at(-1);
  rows.push({date, baseline: last.date, base_close: last.close, close: byDate.get(date).close, open: byDate.get(date).open, lower: g.lower, upper: g.upper, outcome,
    atr14: r4(g.atr14), ma20: r4(g.ma20),
    v1: g.v1.probabilities, v1_raw: g.v1.raw, v21: g.v21.probabilities, v21_regime: g.v21.factors.regime || null,
    v3: g.v3.probabilities, v3_raw: g.v3.raw, v3_x: g.v3.factors.features, adx14: g.v3.factors.adx14, prev_zone: g.v3.factors.prev_zone});
  if (rows.length % 500 === 0) console.error(rows.length, date, ((Date.now() - t0) / 1000).toFixed(0) + 's');
}
const out = {generated_by: 'scripts/v4-generate.cjs', repo_commit: require('node:child_process').execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim(),
  hsi_rows_sha256: hsi.rows_sha256, window_bars: WINDOW, n: rows.length, skipped, rows};
fs.writeFileSync(path.join(root, 'research/v4/data/sessions.json'), JSON.stringify(out));
console.log(JSON.stringify({n: rows.length, first: rows[0].date, last: rows.at(-1).date, skipped: skipped.length, skipped_head: skipped.slice(0, 5)}));
