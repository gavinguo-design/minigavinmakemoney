// rule-weights-v5 CANDIDATE (research only; NOT wired into daily-analysis/build).
// v5 = v4 features (scripts/v4-weights.cjs featuresV4) + HSI futures night-session move (Futu HK.HSImain 60-minute bars).
// Frozen coefficients: research/v5/model-v5.json (trained 2018-10-09..2025-12-31, see research/v5/report.md).
// Night-session contract (cutoff = session 08:45 HKT):
//   futures60: [{t: 'YYYY-MM-DD HH:MM:SS' (HKT, bar END time), close}], ascending.
//   baseline bar = last bar with t <= `${baseline} 16:30:00`, must be dated baseline and >= 16:00:00;
//   cutoff bar   = last bar with t <= `${session} 08:45:00`, must come after the baseline bar.
//   move = log(close_cutoff / close_baseline). Any missing/invalid -> throws (caller falls back to v4, then v3). No interpolation.
'use strict';
const fs = require('node:fs'), path = require('node:path');
const DA = require('./daily-analysis.cjs');
const V4 = require('./v4-weights.cjs');
const TA = require('../investment/chart/technical-analysis.js');
const MR = require('../investment/chart/market-rules.js');
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const SPEC = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'research/v5/model-v5.json'), 'utf8'));
const WEIGHT_MODEL_V5_CANDIDATE = Object.freeze({version: SPEC.version, features: SPEC.features, W: SPEC.W, standardize: SPEC.standardize, bounds: SPEC.bounds, lambda: SPEC.lambda, trained_on: SPEC.trained_on});

function lastAtOrBefore(rows, key) { let r = null; for (const x of rows) { if (x.t <= key) r = x; else break; } return r; }

function nightMove({futures60, baseline, session}) {
  if (!futures60?.length) throw Error('Missing night futures series');
  const b = lastAtOrBefore(futures60, baseline + ' 16:30:00'), c = lastAtOrBefore(futures60, session + ' 08:45:00');
  if (!b || b.t.slice(0, 10) !== baseline || b.t < baseline + ' 16:00:00') throw Error('Missing night futures baseline bar');
  if (!c || !(c.t > b.t) || !(b.close > 0) || !(c.close > 0)) throw Error('Missing night futures cutoff bar');
  return Math.log(c.close / b.close);
}

function featuresV5({bars, lower, upper, cutoff, overnight, futures60}) {
  const {x} = V4.featuresV4({bars, lower, upper, cutoff, overnight});
  const session = MR.hk(MR.timestamp(cutoff)).date, b = bars.at(-1), d = TA.calculate(bars), atr = d.atr[bars.length - 1], atrp = atr / b.close;
  const mv = nightMove({futures60, baseline: b.date, session});
  x.nf_move_atr = clamp(mv / atrp, -4, 4);
  const imp = b.close * Math.exp(mv);
  x.nf_imp_up_atr = clamp((upper - imp) / atr, -4, 4); x.nf_imp_lo_atr = clamp((imp - lower) / atr, -4, 4);
  return {x};
}

function scoreScenarioWeightsV5({bars, lower, upper, cutoff, overnight, futures60, model = WEIGHT_MODEL_V5_CANDIDATE}) {
  const cutoffMs = MR.timestamp(cutoff);
  if (!bars?.length || !(lower < upper) || !Number.isFinite(cutoffMs)) throw Error('Invalid weight inputs');
  if (bars.some(b => MR.timestamp(b.date + 'T16:10:00+08:00') > cutoffMs)) throw Error('Weight inputs after cutoff');
  const {x} = featuresV5({bars, lower, upper, cutoff, overnight, futures60});
  const z = model.features.map(f => { const v = x[f]; if (!Number.isFinite(v)) throw Error('Feature ' + f); const m = model.standardize.mean[f]; return m == null ? v : (v - m) / model.standardize.sd[f]; });
  const L = model.W.map(w => w.reduce((s, wf, j) => s + wf * z[j], 0)), mx = Math.max(...L), e = L.map(v => Math.exp(v - mx)), s = e.reduce((a, c) => a + c, 0);
  const raw = e.map(v => v / s), p = DA.boundedRound(raw, model.bounds);
  return {version: model.version, probabilities: {A: p[0], B: p[1], C: p[2]}, raw, features: x};
}

module.exports = {WEIGHT_MODEL_V5_CANDIDATE, scoreScenarioWeightsV5, featuresV5, nightMove};
