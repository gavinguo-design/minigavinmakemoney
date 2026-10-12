// rule-weights-v3 (production 2026-10-12 only; from 2026-10-13 SHADOW + fail-closed FALLBACK for rule-weights-v4): multinomial logistic recalibration of v1.
// Frozen coefficients = the exact model evaluated once on the 2026-05-18..2026-10-09 holdout in c692d60
// (scripts/optimize-weights.cjs, train-only fit 2024-10-02..2025-12-15, L2 lambda=0.01 chosen by 5-fold CV on train).
// Inputs: completed daily bars strictly before the session (same contract as scoreScenarioWeights) + that session's lower/upper.
// Wired into daily-analysis.cjs productionWeights(): always computed as shadow; used for publication only when v4's
// pre-open overnight inputs are unavailable (annotated as weight_model_info.fallback).
'use strict';
const DA = require('./daily-analysis.cjs');
const TA = require('../investment/chart/technical-analysis.js');
const MR = require('../investment/chart/market-rules.js');
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const KEYS = ['A', 'B', 'C'];

const WEIGHT_MODEL_V3 = Object.freeze({
  version: 'rule-weights-v3',
  source_commit: 'c692d60',
  features: Object.freeze(['bias', 'v1_logodds_A_vs_B', 'v1_logodds_C_vs_B', 'position_z', 'adx14_norm', 'prev_zone_A', 'prev_zone_C', 'v2_regime_range']),
  // W[class][feature], classes A,B,C (full softmax parameterisation as fitted).
  W: Object.freeze([
    Object.freeze([-0.19253661296058458, 0.5941750638821527, -0.10438350643927245, 0.7787855614820396, -0.09914014643054696, 0.14059888933561923, -0.10273493391021578, 0.14840254211201062]),
    Object.freeze([0.5752914038338515, -0.5783444248880962, -0.6776335407709111, -0.07359596498494522, 0.21906705970203902, 0.030367659680640837, -0.07879812979157624, -0.05083723866537336]),
    Object.freeze([-0.38275479087326675, -0.015830638994056033, 0.7820170472101832, -0.7051895964970972, -0.1199269132714921, -0.17096654901625985, 0.181533063701792, -0.09756530344663715])
  ]),
  bounds: Object.freeze({min: 0.10, max: 0.85, step: 0.05})
});

// Wilder ADX14 at the last bar (identical to scripts/backtest-weights.cjs adx()).
function adx14(bars, n = 14) {
  if (bars.length < 2 * n + 1) return null;
  const tr = [], pdm = [], ndm = [];
  for (let i = 1; i < bars.length; i++) { const b = bars[i], p = bars[i - 1], up = b.high - p.high, dn = p.low - b.low; tr.push(Math.max(b.high - b.low, Math.abs(b.high - p.close), Math.abs(b.low - p.close))); pdm.push(up > dn && up > 0 ? up : 0); ndm.push(dn > up && dn > 0 ? dn : 0); }
  let st = tr.slice(0, n).reduce((a, b) => a + b, 0), sp = pdm.slice(0, n).reduce((a, b) => a + b, 0), sn = ndm.slice(0, n).reduce((a, b) => a + b, 0);
  const dx = [];
  for (let i = n; i <= tr.length; i++) { if (i > n) { st = st - st / n + tr[i - 1]; sp = sp - sp / n + pdm[i - 1]; sn = sn - sn / n + ndm[i - 1]; } const pdi = 100 * sp / st, ndi = 100 * sn / st; dx.push(pdi + ndi ? 100 * Math.abs(pdi - ndi) / (pdi + ndi) : 0); }
  if (dx.length < n) return null;
  let a = dx.slice(0, n).reduce((x, y) => x + y, 0) / n;
  for (let i = n; i < dx.length; i++) a = (a * (n - 1) + dx[i]) / n;
  return a;
}

// Zone in which the last completed bar closed, judged against the rules that were in force for that bar
// (latest confirmed pivots from bars before it) — the "previous realised scenario".
function previousZone(bars) {
  const prior = bars.slice(0, -1), p = TA.pivots(prior, 2), lo = p.lows.at(-1)?.price, hi = p.highs.at(-1)?.price;
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo >= hi) return 'B';
  const c = bars.at(-1).close;
  return c >= hi ? 'A' : c < lo ? 'C' : 'B';
}

function featuresV3({bars, lower, upper, cutoff}) {
  const v1 = DA.scoreScenarioWeights({bars, lower, upper, participation: null, cutoff, model: DA.WEIGHT_MODEL_V1}).probabilities;
  const close = bars.at(-1).close, pos = (close - lower) / Math.max(upper - lower, 1), a0 = adx14(bars), a = a0 == null ? null : Math.round(a0 * 10) / 10 /* fitted on 0.1-rounded ADX */, pz = previousZone(bars);
  const range = DA.pivotState(bars).trend === 'range';
  const lg = x => Math.log(Math.max(x, 1e-7));
  return {x: [1, lg(v1.A) - lg(v1.B), lg(v1.C) - lg(v1.B), (pos - 0.5) * 2, a != null ? clamp((a - 20) / 20, -1, 1) : 0, pz === 'A' ? 1 : 0, pz === 'C' ? 1 : 0, range ? 1 : 0],
    v1, prev_zone: pz, adx14: a, regime: range ? 'range' : 'trend'};
}

function scoreScenarioWeightsV3({bars, lower, upper, cutoff, model = WEIGHT_MODEL_V3}) {
  const cutoffMs = MR.timestamp(cutoff);
  if (!bars?.length || !(lower < upper) || !Number.isFinite(cutoffMs)) throw Error('Invalid weight inputs');
  if (bars.some(b => MR.timestamp(b.date + 'T16:10:00+08:00') > cutoffMs)) throw Error('Weight inputs after cutoff');
  const f = featuresV3({bars, lower, upper, cutoff});
  const L = model.W.map(w => w.reduce((s, wf, j) => s + wf * f.x[j], 0)), mx = Math.max(...L), e = L.map(v => Math.exp(v - mx)), s = e.reduce((a, b) => a + b, 0);
  const raw = e.map(v => v / s), p = DA.boundedRound(raw, model.bounds);
  return {version: model.version, probabilities: {A: p[0], B: p[1], C: p[2]}, raw: Object.fromEntries(KEYS.map((k, i) => [k, Math.round(raw[i] * 100) / 100])),
    factors: {v1: f.v1, prev_zone: f.prev_zone, adx14: f.adx14 == null ? null : Math.round(f.adx14 * 10) / 10, regime: f.regime, features: Object.fromEntries(model.features.map((n, j) => [n, Math.round(f.x[j] * 1e4) / 1e4]))}};
}

module.exports = {WEIGHT_MODEL_V3, scoreScenarioWeightsV3, featuresV3, previousZone, adx14};
