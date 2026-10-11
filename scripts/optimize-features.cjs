// Point-in-time feature table for the A/B/C weight optimisation (research only).
// Every feature for session t is computed from candles / breadth / southbound rows dated strictly before t.
// Rules (lower/upper) and outcomes come from scripts/backtest-weights.cjs (production build()).
'use strict';
const BT = require('./backtest-weights.cjs');
const S = require('./backtest-breadth-southbound.cjs');
const DA = require('./daily-analysis.cjs');
const TA = require('../investment/chart/technical-analysis.js');
const {KEYS} = BT;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function hv(bars, n) {
  const r = []; for (let i = Math.max(1, bars.length - n); i < bars.length; i++) r.push(Math.log(bars[i].close / bars[i - 1].close));
  if (r.length < n) return null; const m = r.reduce((a, b) => a + b, 0) / n; return Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1));
}
const softmax = L => { const mx = Math.max(...KEYS.map(k => L[k])), e = KEYS.map(k => Math.exp(L[k] - mx)), s = e.reduce((a, b) => a + b, 0); return {A: e[0] / s, B: e[1] / s, C: e[2] / s}; };

// Features for one session given the history strictly before it (bars) and the session's rule bounds.
function featuresFor(date, bars, lower, upper, aux) {
  if (bars.some(b => b.date >= date)) throw Error('future bar in features for ' + date);
  const d = TA.calculate(bars), i = bars.length - 1, last = bars[i], prev = bars[i - 1], atr = d.atr[i], ma = d.ma20[i], maPrev = d.ma20[i - 5];
  const close = last.close, pos = (close - lower) / (upper - lower);
  const zone = close >= upper ? 'A' : close < lower ? 'C' : 'B';
  const L1 = S.v1Logits(bars, lower, upper);
  const v2 = DA.scoreScenarioWeights({bars, lower, upper, participation: null, cutoff: date + 'T08:45:00+08:00', dataUpdatedAt: date + 'T08:40:00+08:00', model: DA.WEIGHT_MODEL_V2});
  const wf = Object.fromEntries(v2.weight_factors.map(f => [f.name, f]));
  const h10 = hv(bars, 10), h20 = hv(bars, 20);
  const br = S.breadthSignal(date, aux.breadth), sb = S.southboundSignal(date, aux.southbound);
  const bq = wf.breakout_quality.contribution, sk = wf.sakata_new_value.raw, cp = wf.candle_pattern.raw.pattern, gate = wf.market_state_gate.raw;
  const f = {
    pos_term: clamp(2 * pos - 1, -1.5, 1.5),
    dist_a: clamp((upper - close) / atr, 0, 4), dist_c: clamp((close - lower) / atr, 0, 4),
    above_a: clamp((close - upper) / atr, 0, 4), below_c: clamp((lower - close) / atr, 0, 4),
    width_atr: clamp((upper - lower) / atr, 0, 6),
    ma_slope: clamp((ma - maPrev) / atr, -1, 1), ma_rel: clamp((close - ma) / atr, -1, 1),
    zone_A: zone === 'A' ? 1 : 0, zone_C: zone === 'C' ? 1 : 0,
    gap_atr: clamp((last.open - prev.close) / atr, -3, 3), ret1_atr: clamp((close - prev.close) / atr, -3, 3),
    hv10: h10 == null ? 0 : h10 * 100, hv20: h20 == null ? 0 : h20 * 100, hv_ratio: h10 && h20 ? clamp(h10 / h20, 0, 3) : 1,
    v1_tilt: L1.A + V1c().distance * clamp((upper - close) / atr, 0, 4),
    v1_logit_A: L1.A - L1.B, v1_logit_C: L1.C - L1.B,
    v2_range: wf.regime_gate.raw.range ? 1 : 0, v2_breakout: (bq.A || 0) - (bq.C || 0),
    v2_sakata: (sk.up >= 3 ? 1 : 0) - (sk.down >= 3 ? 1 : 0),
    v2_candle: /bullish_engulfing|piercing/.test(cp) ? 1 : /bearish_engulfing|dark_cloud/.test(cp) ? -1 : 0,
    v2_candle_neutral: /harami|doji/.test(cp) ? 1 : 0,
    v2_holiday_first: gate.holiday_first ? 1 : 0,
    breadth_adv: br.status === 'available' ? br.adv_ratio - 0.5 : 0, breadth_ma20: br.status === 'available' ? br.pct_above_ma20 - 0.5 : 0,
    southbound_z: sb.status === 'available' ? clamp(sb.z, -3, 3) : 0
  };
  return {f, zone, pos, atr, base_close: close, logits_v1: L1, raw_v1: softmax(L1), aux_asof: {breadth: br.as_of, southbound: sb.as_of}};
}
function V1c() { return DA.WEIGHT_MODEL_V1.coefficients; }

const FEATURE_SETS = {
  core: ['pos_term', 'dist_a', 'dist_c', 'above_a', 'below_c', 'ma_slope', 'ma_rel', 'zone_A', 'zone_C'],
  v1logit: ['v1_logit_A', 'v1_logit_C'],
  price_ext: ['width_atr', 'gap_atr', 'ret1_atr', 'hv10', 'hv20', 'hv_ratio'],
  v2: ['v2_range', 'v2_breakout', 'v2_sakata', 'v2_candle', 'v2_candle_neutral', 'v2_holiday_first'],
  breadth: ['breadth_adv', 'breadth_ma20'],
  southbound: ['southbound_z']
};

// Build the full table. Returns rows sorted by date with outcome and production v1 probability.
function buildTable({data = BT.loadData(), aux = S.loadAux(), end} = {}) {
  const cmp = S.runComparison({data, aux, ...(end ? {end} : {})});
  const candles = data.candles;
  return cmp.map(r => {
    const bars = candles.filter(b => b.date < r.date).map(b => ({...b, time: b.date}));
    const x = featuresFor(r.date, bars, r.lower, r.upper, aux);
    return {date: r.date, outcome: r.outcome, lower: r.lower, upper: r.upper, close: r.close, prev_close: r.prev_close, prev_high: r.prev_high, prev_low: r.prev_low,
      ...x, p_v1: r.p.v1, p_persistence: r.p.persistence};
  });
}

module.exports = {featuresFor, buildTable, FEATURE_SETS, softmax, hv};
