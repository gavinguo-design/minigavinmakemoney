// Statistical / calibration candidate models for the A/B/C weight optimisation (research only).
// All fit() functions receive training rows only and return a predict(row) -> {A,B,C} closure.
'use strict';
const DA = require('./daily-analysis.cjs');
const {softmax, FEATURE_SETS} = require('./optimize-features.cjs');
const KEYS = ['A', 'B', 'C'];
const r4 = v => Math.round(v * 1e4) / 1e4;
const brier = (p, o) => KEYS.reduce((s, k) => s + (p[k] - (o === k ? 1 : 0)) ** 2, 0);
const norm = p => { const s = KEYS.reduce((a, k) => a + p[k], 0); return Object.fromEntries(KEYS.map(k => [k, p[k] / s])); };

// Production-style output: boundedRound to step 0.05 with [min,max].
function rounded(p, bounds) { if (!bounds) return p; const q = DA.boundedRound(KEYS.map(k => p[k]), {step: 0.05, ...bounds}); return {A: q[0], B: q[1], C: q[2]}; }

// ---------- Direction 1: calibration of v1 ----------
// Temperature/vector scaling on the v1 logits relative to B: L'_k = a_k + s_k * (L_k - L_B). Fitted by minimising Brier (or log loss) on train.
function fitV1Scaling(train, {mode = 'temperature', loss = 'brier', l2 = 0} = {}) {
  const x = r => [r.logits_v1.A - r.logits_v1.B, r.logits_v1.C - r.logits_v1.B];
  // params: temperature -> [s]; platt(vector) -> [aA, sA, aC, sC]
  const mk = th => mode === 'temperature' ? (z => ({A: th[0] * z[0], B: 0, C: th[0] * z[1]})) : (z => ({A: th[0] + th[1] * z[0], B: 0, C: th[2] + th[3] * z[1]}));
  const obj = th => { let s = 0; for (const r of train) { const p = softmax(mk(th)(x(r))); s += loss === 'brier' ? brier(p, r.outcome) : -Math.log(Math.max(p[r.outcome], 1e-9)); } const reg = mode === 'temperature' ? 0 : l2 * (th[1] - 1) ** 2 + l2 * (th[3] - 1) ** 2; return s / train.length + reg; };
  let th = mode === 'temperature' ? [1] : [0, 1, 0, 1];
  th = nelderMead(obj, th);
  return {params: th.map(r4), predict: r => softmax(mk(th)(x(r)))};
}

// Per-class isotonic regression (PAV) on raw v1 probabilities, renormalised.
function pav(xs, ys) {
  const idx = xs.map((x, i) => i).sort((a, b) => xs[a] - xs[b]);
  const blocks = [];
  for (const i of idx) { blocks.push({x: xs[i], xmax: xs[i], s: ys[i], n: 1}); while (blocks.length > 1 && blocks.at(-2).s / blocks.at(-2).n >= blocks.at(-1).s / blocks.at(-1).n) { const b = blocks.pop(), a = blocks.at(-1); a.s += b.s; a.n += b.n; a.xmax = b.xmax; } }
  return blocks.map(b => ({lo: b.x, hi: b.xmax, v: b.s / b.n}));
}
function fitIsotonic(train, {floor = 0.01} = {}) {
  const maps = Object.fromEntries(KEYS.map(k => [k, pav(train.map(r => r.raw_v1[k]), train.map(r => r.outcome === k ? 1 : 0))]));
  const look = (m, x) => { let v = m[0].v; for (const b of m) { if (x >= b.lo) v = b.v; } return v; };
  return {params: {blocks: Object.fromEntries(KEYS.map(k => [k, maps[k].length]))}, predict: r => norm(Object.fromEntries(KEYS.map(k => [k, Math.max(floor, look(maps[k], r.raw_v1[k]))])))};
}

// ---------- Direction 2: transition / persistence table ----------
// Buckets: zone of t-1 close x distance bucket. Zone A: distance above upper (ATR); zone C: below lower; zone B: nearest boundary side + distance.
function bucketOf(r, edges) {
  const f = r.f, b = d => edges.findIndex(e => d < e) === -1 ? edges.length : edges.findIndex(e => d < e);
  if (r.zone === 'A') return 'A' + b(f.above_a);
  if (r.zone === 'C') return 'C' + b(f.below_c);
  const side = f.dist_a <= f.dist_c ? 'u' : 'd';
  return 'B' + side + b(Math.min(f.dist_a, f.dist_c));
}
function fitTransition(train, {edges = [0.5, 1.0], alpha = 1, prior = 'zone'} = {}) {
  const cnt = {}, zc = {}, glob = {A: 0, B: 0, C: 0};
  for (const r of train) { const k = bucketOf(r, edges); (cnt[k] ||= {A: 0, B: 0, C: 0})[r.outcome]++; (zc[r.zone] ||= {A: 0, B: 0, C: 0})[r.outcome]++; glob[r.outcome]++; }
  const n = train.length, g = Object.fromEntries(KEYS.map(k => [k, (glob[k] + 1) / (n + 3)]));
  const zp = z => { const c = zc[z] || {A: 0, B: 0, C: 0}, t = c.A + c.B + c.C; return Object.fromEntries(KEYS.map(k => [k, (c[k] + 3 * g[k]) / (t + 3)])); };
  return {params: {edges, alpha, buckets: Object.keys(cnt).length}, predict: r => {
    const c = cnt[bucketOf(r, edges)] || {A: 0, B: 0, C: 0}, t = c.A + c.B + c.C, pr = prior === 'zone' ? zp(r.zone) : g;
    return Object.fromEntries(KEYS.map(k => [k, (c[k] + alpha * 3 * pr[k]) / (t + alpha * 3)]));
  }};
}

// ---------- Direction 3: multinomial logistic regression (L2, standardised features) ----------
function fitMLR(train, {features, l2 = 1, iters = 3000, lr = 0.1} = {}) {
  const X = train.map(r => features.map(f => r.f[f])), m = features.length, n = X.length;
  const mu = features.map((_, j) => X.reduce((s, x) => s + x[j], 0) / n);
  const sd = features.map((_, j) => Math.sqrt(X.reduce((s, x) => s + (x[j] - mu[j]) ** 2, 0) / n) || 1);
  const Z = X.map(x => x.map((v, j) => (v - mu[j]) / sd[j])), Y = train.map(r => KEYS.indexOf(r.outcome));
  // W[k][j], b[k]; B (k=1) fixed at zero for identifiability.
  const W = [Array(m).fill(0), Array(m).fill(0), Array(m).fill(0)], b = [0, 0, 0];
  const mW = W.map(w => w.map(() => 0)), vW = W.map(w => w.map(() => 0)), mb = [0, 0, 0], vb = [0, 0, 0];
  for (let it = 1; it <= iters; it++) {
    const gW = W.map(w => w.map(() => 0)), gb = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      const L = [0, 1, 2].map(k => b[k] + W[k].reduce((s, w, j) => s + w * Z[i][j], 0)), mx = Math.max(...L), e = L.map(v => Math.exp(v - mx)), s = e[0] + e[1] + e[2];
      for (const k of [0, 2]) { const g = e[k] / s - (Y[i] === k ? 1 : 0); gb[k] += g / n; for (let j = 0; j < m; j++) gW[k][j] += g * Z[i][j] / n; }
    }
    for (const k of [0, 2]) {
      for (let j = 0; j < m; j++) { const g = gW[k][j] + l2 * W[k][j] / n; mW[k][j] = .9 * mW[k][j] + .1 * g; vW[k][j] = .999 * vW[k][j] + .001 * g * g; W[k][j] -= lr * (mW[k][j] / (1 - .9 ** it)) / (Math.sqrt(vW[k][j] / (1 - .999 ** it)) + 1e-8); }
      const g = gb[k]; mb[k] = .9 * mb[k] + .1 * g; vb[k] = .999 * vb[k] + .001 * g * g; b[k] -= lr * (mb[k] / (1 - .9 ** it)) / (Math.sqrt(vb[k] / (1 - .999 ** it)) + 1e-8);
    }
  }
  const predict = r => { const z = features.map((f, j) => (r.f[f] - mu[j]) / sd[j]); return softmax({A: b[0] + W[0].reduce((s, w, j) => s + w * z[j], 0), B: 0, C: b[2] + W[2].reduce((s, w, j) => s + w * z[j], 0)}); };
  return {params: {features, l2, mu: mu.map(r4), sd: sd.map(r4), bA: r4(b[0]), bC: r4(b[2]), WA: W[0].map(r4), WC: W[2].map(r4)}, predict};
}

// Simple derivative-free optimiser for the low-dimensional calibration fits.
function nelderMead(f, x0, {iters = 400, step = 0.3} = {}) {
  const n = x0.length; let s = [x0.slice()]; for (let i = 0; i < n; i++) { const x = x0.slice(); x[i] += step; s.push(x); }
  let v = s.map(f);
  for (let it = 0; it < iters; it++) {
    const o = v.map((y, i) => i).sort((a, b) => v[a] - v[b]); s = o.map(i => s[i]); v = o.map(i => v[i]);
    const c = Array(n).fill(0); for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += s[i][j] / n;
    const xr = c.map((ci, j) => ci + (ci - s[n][j])), fr = f(xr);
    if (fr < v[0]) { const xe = c.map((ci, j) => ci + 2 * (ci - s[n][j])), fe = f(xe); if (fe < fr) { s[n] = xe; v[n] = fe; } else { s[n] = xr; v[n] = fr; } }
    else if (fr < v[n - 1]) { s[n] = xr; v[n] = fr; }
    else { const xc = c.map((ci, j) => ci + .5 * (s[n][j] - ci)), fc = f(xc); if (fc < v[n]) { s[n] = xc; v[n] = fc; } else { for (let i = 1; i <= n; i++) { s[i] = s[i].map((x, j) => s[0][j] + .5 * (x - s[0][j])); v[i] = f(s[i]); } } }
  }
  return s[v.indexOf(Math.min(...v))];
}

module.exports = {fitV1Scaling, fitIsotonic, fitTransition, fitMLR, bucketOf, rounded, brier, nelderMead, pav, FEATURE_SETS, KEYS, r4};
