// rule-weights-v4 (PRODUCTION from the 2026-10-13 pre-open, approved by 潮伟哥 2026-10-12 13:40).
// Wired into daily-analysis.cjs productionWeights(); v3 (and v1) are computed alongside as shadows.
// If any overnight input is missing/stale/inconsistent, build() falls back to v3 and annotates the fallback.
// Model: multinomial LR on v3's 8 features + pre-open overnight information + price-structure distances.
// Frozen coefficients/standardisation: research/v4/model-v4.json (fit on 2014-03..2025-12 sessions, see research/v4/report.md).
// Point-in-time contract (cutoff = session 08:45 HKT):
//   * bars: completed HSI daily bars strictly before the session (same as v3), each with volume.
//   * overnight: {EWH,GSPC,IXIC,FXI,KWEB,VIX: [{date(US/Eastern),close}], CNY: [{date(London),close}]}.
//     Only rows with date < session date are used (US close 04:00/05:00 HKT next day; London day ends 07:00/08:00 HKT).
//     Overnight move = log(last close with date < session) - log(last close with date < baseline).
//   * Any missing overnight series -> throws (caller falls back to v3). No interpolation.
'use strict';
const fs = require('node:fs'), path = require('node:path');
const DA = require('./daily-analysis.cjs');
const V3 = require('./weights-v3.cjs');
const TA = require('../investment/chart/technical-analysis.js');
const MR = require('../investment/chart/market-rules.js');
const KEYS = ['A', 'B', 'C'];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const SPEC = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'research/v4/model-v4.json'), 'utf8'));
const WEIGHT_MODEL_V4_CANDIDATE = Object.freeze({version: SPEC.version, features: SPEC.features, W: SPEC.W, standardize: SPEC.standardize, bounds: SPEC.bounds, lambda: SPEC.lambda, trained_on: SPEC.trained_on});
// Production identity of the frozen candidate: identical coefficients/standardisation, production version label.
// Round1 C5 (2026-10-19): published bounds widened from the research [0.10,0.85]/0.05 to [0.03,0.95]/0.01 — walk-forward
// 2017–2025 Brier 0.2558 -> 0.2281 (ΔBrier year-block CI [-0.0297,-0.0258], 9/9 years), 2026 0.2762 -> 0.2544
// (research/v4/c5-bounds-recal.json). Expanding-window recalibration on top did not help (0.2294) and is not used.
// Same frozen W/standardisation; only the output format changes.
const BOUNDS_V4 = Object.freeze({min: 0.03, max: 0.95, step: 0.01});
const WEIGHT_MODEL_V4 = Object.freeze({...WEIGHT_MODEL_V4_CANDIDATE, bounds: BOUNDS_V4, version: 'rule-weights-v4', source: 'research/v4/model-v4.json (' + SPEC.version + ', commit 30e9c81); bounds round1 C5'});
const OVN = ['EWH', 'GSPC', 'IXIC', 'FXI', 'KWEB', 'CNY'];

function lastBefore(rows, day) { let r = null; for (const x of rows) { if (x.date < day) r = x; else break; } return r; }

function featuresV4({bars, lower, upper, cutoff, overnight}) {
  const session = MR.hk(MR.timestamp(cutoff)).date, b = bars.at(-1), base = b.date;
  const v3 = V3.featuresV3({bars, lower, upper, cutoff});
  const x = Object.fromEntries(V3.WEIGHT_MODEL_V3.features.map((f, j) => [f, v3.x[j]]));
  const d = TA.calculate(bars), atr = d.atr[bars.length - 1], atrp = atr / b.close;
  const move = name => {
    const rows = overnight?.[name]; if (!rows?.length) throw Error('Missing overnight series ' + name);
    const r1 = lastBefore(rows, session), r0 = lastBefore(rows, base);
    if (!r1 || !r0 || !(r1.close > 0) || !(r0.close > 0)) throw Error('Missing overnight data ' + name);
    return Math.log(r1.close / r0.close);
  };
  for (const k of OVN) x[k + '_atr'] = clamp(move(k) / atrp, -4, 4);
  const vix1 = lastBefore(overnight.VIX, session); if (!vix1) throw Error('Missing overnight data VIX');
  x.VIX_chg = move('VIX'); x.VIX_lvl = Math.log(vix1.close);
  x.dist_up_atr = clamp((upper - b.close) / atr, -4, 4); x.dist_lo_atr = clamp((b.close - lower) / atr, -4, 4);
  x.width_atr = Math.min((upper - lower) / atr, 10);
  const n = bars.length; x.ret1_atr = clamp(Math.log(b.close / bars[n - 2].close) / atrp, -4, 4); x.ret5_atr = clamp(Math.log(b.close / bars[n - 6].close) / atrp, -6, 6);
  const vols = bars.slice(-21, -1).map(v => v.volume);
  if (vols.length !== 20 || !vols.every(v => v > 0) || !(b.volume > 0)) throw Error('Missing volume');
  x.vol_ratio = Math.log(b.volume / (vols.reduce((s, v) => s + v, 0) / 20));
  const imp = b.close * Math.exp(move('EWH'));
  x.imp_up_atr = clamp((upper - imp) / atr, -4, 4); x.imp_lo_atr = clamp((imp - lower) / atr, -4, 4);
  return {x, v3};
}

function scoreScenarioWeightsV4({bars, lower, upper, cutoff, overnight, model = WEIGHT_MODEL_V4}) {
  const cutoffMs = MR.timestamp(cutoff);
  if (!bars?.length || !(lower < upper) || !Number.isFinite(cutoffMs)) throw Error('Invalid weight inputs');
  if (bars.some(b => MR.timestamp(b.date + 'T16:10:00+08:00') > cutoffMs)) throw Error('Weight inputs after cutoff');
  const {x} = featuresV4({bars, lower, upper, cutoff, overnight});
  const z = model.features.map(f => { const v = x[f]; if (!Number.isFinite(v)) throw Error('Feature ' + f); const m = model.standardize.mean[f]; return m == null ? v : (v - m) / model.standardize.sd[f]; });
  const L = model.W.map(w => w.reduce((s, wf, j) => s + wf * z[j], 0)), mx = Math.max(...L), e = L.map(v => Math.exp(v - mx)), s = e.reduce((a, c) => a + c, 0);
  const raw = e.map(v => v / s), p = DA.boundedRound(raw, model.bounds);
  return {version: model.version, probabilities: {A: p[0], B: p[1], C: p[2]}, raw, features: x};
}

module.exports = {BOUNDS_V4, WEIGHT_MODEL_V4, WEIGHT_MODEL_V4_CANDIDATE, OVERNIGHT_SERIES: Object.freeze([...OVN, 'VIX']), scoreScenarioWeightsV4, featuresV4};
