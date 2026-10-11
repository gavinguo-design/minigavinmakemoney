// Direction 5 (conclusions only) + descriptive walk-forward robustness. Research only.
// (a) Splitting B into upper/lower half: how predictable is the 4-class outcome vs the 3-class one?
// (b) "Expected range" alternative: how well does pre-open ATR/HV predict the realised |close-to-close| move and high-low range?
// (c) Walk-forward (expanding refit every 20 sessions) of the transition table and the LR spec over the last 40%
//     — DESCRIPTIVE ONLY: it reuses validation/holdout periods, so it is never used for selection.
'use strict';
const fs = require('node:fs'), path = require('node:path');
const BT = require('./backtest-weights.cjs');
const F = require('./optimize-features.cjs');
const M = require('./optimize-models.cjs');
const root = path.join(__dirname, '..');
const r4 = v => Math.round(v * 1e4) / 1e4;

function entropy(p) { return -Object.values(p).reduce((s, x) => s + (x > 0 ? x * Math.log2(x) : 0), 0); }
function multiBrier(p, o, keys) { return keys.reduce((s, k) => s + ((p[k] || 0) - (o === k ? 1 : 0)) ** 2, 0); }
function corr(x, y) { const n = x.length, mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n; let a = 0, b = 0, c = 0; for (let i = 0; i < n; i++) { a += (x[i] - mx) * (y[i] - my); b += (x[i] - mx) ** 2; c += (y[i] - my) ** 2; } return a / Math.sqrt(b * c); }

function run() {
  const data = BT.loadData(), table = F.buildTable({data}), idx = new Map(data.candles.map((c, i) => [c.date, i]));
  const n = table.length, a = Math.floor(n * .6);
  // (a) 4-class: A, B_hi, B_lo, C using the same rules' midpoint.
  const cls4 = (r, close) => close >= r.upper ? 'A' : close < r.lower ? 'C' : close >= (r.lower + r.upper) / 2 ? 'Bh' : 'Bl';
  const prevCls4 = r => cls4(r, r.base_close);
  const K4 = ['A', 'Bh', 'Bl', 'C'], K3 = ['A', 'B', 'C'];
  const res = {};
  for (const [name, keys, out, prev] of [['3类', K3, r => r.outcome, r => r.zone], ['4类(B拆上下半)', K4, r => cls4(r, r.close), prevCls4]]) {
    // Transition table fitted on first 60% only, scored on the remaining 40% (descriptive: same as a 60/40 split).
    const cnt = {}, glob = Object.fromEntries(keys.map(k => [k, 1]));
    table.slice(0, a).forEach(r => { const p = prev(r), o = out(r); (cnt[p] ||= Object.fromEntries(keys.map(k => [k, 1])))[o]++; glob[o]++; });
    const pred = r => { const c = cnt[prev(r)] || glob, t = Object.values(c).reduce((s, x) => s + x, 0); return Object.fromEntries(keys.map(k => [k, c[k] / t])); };
    const te = table.slice(a), gt = Object.values(glob).reduce((s, x) => s + x, 0), base = Object.fromEntries(keys.map(k => [k, glob[k] / gt]));
    const stay = te.filter(r => prev(r) === out(r)).length / te.length;
    const H0 = entropy(base), Hc = te.reduce((s, r) => s + entropy(pred(r)), 0) / te.length;
    const brT = te.reduce((s, r) => s + multiBrier(pred(r), out(r), keys), 0) / te.length, brU = te.reduce((s, r) => s + multiBrier(Object.fromEntries(keys.map(k => [k, 1 / keys.length])), out(r), keys), 0) / te.length;
    const hit = te.filter(r => { const p = pred(r); return keys.reduce((b, k) => p[k] > p[b] ? k : b, keys[0]) === out(r); }).length / te.length;
    res[name] = {test_n: te.length, stay_in_prev_class: r4(stay), entropy_marginal_bits: r4(H0), entropy_conditional_bits: r4(Hc), info_gain_bits: r4(H0 - Hc),
      brier_transition: r4(brT), brier_uniform: r4(brU), brier_skill_vs_uniform: r4(1 - brT / brU), top_hit: r4(hit), freq: Object.fromEntries(keys.map(k => [k, r4(te.filter(r => out(r) === k).length / te.length)]))};
  }
  // Within B: does the next close's half follow the previous half?
  const bb = table.filter(r => r.zone === 'B' && r.outcome === 'B');
  res.B_half_persistence = {n: bb.length, same_half: r4(bb.filter(r => prevCls4(r) === cls4(r, r.close)).length / bb.length)};
  // (b) Expected range: ATR14 / HV20 known pre-open vs realised |ret| and high-low.
  const realAbs = table.map(r => Math.abs(r.close - r.base_close)), realHL = table.map(r => { const c = data.candles[idx.get(r.date)]; return c.high - c.low; });
  const atr = table.map(r => r.atr), hvPts = table.map(r => r.f.hv20 / 100 * r.base_close);
  const within = (k) => table.filter((r, i) => realAbs[i] <= k * atr[i]).length / n;
  res.expected_range = {corr_atr_vs_abs_move: r4(corr(atr, realAbs)), corr_atr_vs_high_low: r4(corr(atr, realHL)), corr_hv20pts_vs_abs_move: r4(corr(hvPts, realAbs)),
    close_within_0_5atr: r4(within(.5)), close_within_1atr: r4(within(1)), close_within_1_5atr: r4(within(1.5)),
    median_abs_move_over_atr: r4(realAbs.map((x, i) => x / atr[i]).sort((x, y) => x - y)[Math.floor(n / 2)]),
    median_high_low_over_atr: r4(realHL.map((x, i) => x / atr[i]).sort((x, y) => x - y)[Math.floor(n / 2)])};
  // How often does the A/C trigger lie beyond 1 ATR from the base close? (scenario is then nearly certain to be the current zone)
  res.trigger_distance = {min_dist_gt_1atr: r4(table.filter(r => r.zone === 'B' && Math.min(r.f.dist_a, r.f.dist_c) > 1).length / table.filter(r => r.zone === 'B').length),
    b_zone_share: r4(table.filter(r => r.zone === 'B').length / n)};
  // (c) Descriptive walk-forward over the last 40%: refit every 20 sessions on all prior rows.
  const wf = {}, specs = {'trans-e0.5-a0.5': tr => M.fitTransition(tr, {edges: [0.5], alpha: .5}), 'mlr-core-l21': tr => M.fitMLR(tr, {features: M.FEATURE_SETS.core, l2: 1, iters: 1500})};
  for (const [id, fit] of Object.entries(specs)) {
    const P = [], V = [];
    for (let s = a; s < n; s += 20) { const m = fit(table.slice(0, s)); for (let i = s; i < Math.min(n, s + 20); i++) { P.push(M.rounded(m.predict(table[i]), {min: .05, max: .9})); V.push(table[i]); } }
    const d = V.map((r, i) => M.brier(P[i], r.outcome) - M.brier(r.p_v1, r.outcome)), ci = BT.blockBootstrap(d);
    wf[id] = {n: V.length, brier: r4(V.reduce((s, r, i) => s + M.brier(P[i], r.outcome), 0) / V.length), v1: r4(V.reduce((s, r) => s + M.brier(r.p_v1, r.outcome), 0) / V.length), diff_vs_v1: {mean: r4(ci.mean), lo: r4(ci.lo), hi: r4(ci.hi)}};
  }
  res.walk_forward_descriptive = wf;
  return res;
}
module.exports = {run};
if (require.main === module) { const r = run(); fs.writeFileSync(path.join(root, 'research/optimization/dir5-and-walkforward.json'), JSON.stringify(r, null, 1) + '\n'); console.log(JSON.stringify(r, null, 1)); }
