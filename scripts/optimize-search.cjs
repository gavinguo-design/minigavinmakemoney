// Out-of-sample search for A/B/C scenario weights (research only; never edits production defaults).
// Protocol (Aronson): chronological split train 60% / validation 20% / holdout 20%.
// All candidates are fitted on train only and ranked on validation. The holdout is scored ONCE,
// for the single pre-declared selection (best validation Brier among candidates that beat v1 on validation),
// refitted on train+validation with the frozen hyperparameters. Every attempt is logged in search-ledger.json.
// Usage: node scripts/optimize-search.cjs [--stage=1,2,3,4] [--holdout]
'use strict';
const fs = require('node:fs'), path = require('node:path');
const BT = require('./backtest-weights.cjs');
const F = require('./optimize-features.cjs');
const M = require('./optimize-models.cjs');
const {KEYS, r4, brier} = M;
const root = path.join(__dirname, '..'), OUT = path.join(root, 'research/optimization');
const LEDGER = path.join(OUT, 'search-ledger-v3.json');
const SHIP_BOUNDS = Object.freeze({min: 0.05, max: 0.90}); // display format for candidates (step 0.05)

function split(rows) { const n = rows.length, a = Math.floor(n * 0.6), b = Math.floor(n * 0.8); return {train: rows.slice(0, a), val: rows.slice(a, b), hold: rows.slice(b)}; }
const hit = (p, o) => BT.hit(p, o);
function ece(rows, P) { const bins = Array.from({length: 10}, () => ({n: 0, sp: 0, so: 0})); rows.forEach((r, i) => KEYS.forEach(k => { const p = P[i][k], b = bins[Math.min(9, Math.floor(p * 10 + 1e-9))]; b.n++; b.sp += p; b.so += r.outcome === k ? 1 : 0; })); const t = bins.reduce((s, b) => s + b.n, 0); return bins.filter(b => b.n).reduce((s, b) => s + b.n / t * Math.abs(b.sp / b.n - b.so / b.n), 0); }
function score(rows, P) {
  const b = rows.map((r, i) => brier(P[i], r.outcome));
  return {n: rows.length, brier: r4(b.reduce((a, x) => a + x, 0) / rows.length), hit: r4(rows.reduce((s, r, i) => s + hit(P[i], r.outcome), 0) / rows.length),
    logloss: r4(rows.reduce((s, r, i) => s - Math.log(Math.max(P[i][r.outcome], 1e-6)), 0) / rows.length), ece: r4(ece(rows, P))};
}
function diffCI(rows, P, Q) { const d = rows.map((r, i) => brier(P[i], r.outcome) - brier(Q[i], r.outcome)), x = BT.blockBootstrap(d); return {mean: r4(x.mean), lo: r4(x.lo), hi: r4(x.hi)}; }

// Candidate registry: each returns {fit(trainRows) -> {params, predict}} plus output bounds (null = raw probs).
function candidates(stages) {
  const C = [];
  const add = (stage, id, desc, fit, bounds = SHIP_BOUNDS) => { if (stages.includes(stage)) C.push({stage, id, desc, fit, bounds}); };
  const fixedV1 = bounds => () => ({params: {bounds}, predict: r => r.raw_v1});
  // Stage 1: calibration of v1
  add(1, 'v1-prod', '生产 v1（[0.10,0.70]）', fixedV1(), {min: .10, max: .70});
  for (const mx of [.85, .90]) for (const mn of [.10, .05]) add(1, `v1-bounds-${mn}-${mx}`, `v1 原 logits，界限 [${mn},${mx}]`, fixedV1(), {min: mn, max: mx});
  for (const loss of ['brier', 'logloss']) add(1, `v1-temp-${loss}`, `v1 温度缩放（${loss}）`, tr => M.fitV1Scaling(tr, {mode: 'temperature', loss}));
  for (const l2 of [0, 0.01, 0.1]) add(1, `v1-platt-l2${l2}`, `v1 向量 Platt（A/C 各自截距+斜率，brier，向 1 收缩 l2=${l2}）`, tr => M.fitV1Scaling(tr, {mode: 'platt', loss: 'brier', l2}));
  add(1, 'v1-isotonic', 'v1 原始概率按类 isotonic（PAV），归一化', tr => M.fitIsotonic(tr));
  // Stage 2: transition / persistence
  for (const [name, edges] of [['zone', []], ['e0.5', [0.5]], ['e0.5-1', [0.5, 1]], ['e0.25-0.5-1-2', [0.25, 0.5, 1, 2]]]) for (const alpha of [0.5, 1, 3]) add(2, `trans-${name}-a${alpha}`, `转移表：前日区×距边界 ATR 分桶 ${JSON.stringify(edges)}，向区先验平滑 α=${alpha}`, tr => M.fitTransition(tr, {edges, alpha}));
  // Stage 3: multinomial logistic regression
  const FS = M.FEATURE_SETS, sets = {
    core: FS.core, 'core+v1logit': [...FS.core, ...FS.v1logit], 'core+price': [...FS.core, ...FS.price_ext], 'core+v2': [...FS.core, ...FS.v2],
    'core+breadth': [...FS.core, ...FS.breadth], 'core+south': [...FS.core, ...FS.southbound], 'core+breadth+south': [...FS.core, ...FS.breadth, ...FS.southbound],
    all: [...FS.core, ...FS.v1logit, ...FS.price_ext, ...FS.v2, ...FS.breadth, ...FS.southbound]};
  for (const [name, features] of Object.entries(sets)) for (const l2 of [1, 10, 30, 100]) add(3, `mlr-${name}-l2${l2}`, `多项逻辑回归 ${name}（${features.length} 特征，L2=${l2}）`, tr => M.fitMLR(tr, {features, l2}));
  // Stage 4: ensembles  p = w * stat + (1-w) * v1_raw  (stat model fitted on train with fixed hyperparameters chosen in stages 2/3)
  const statModels = {trans: tr => M.fitTransition(tr, {edges: [0.5], alpha: 1}), mlr: tr => M.fitMLR(tr, {features: [...FS.core, ...FS.v1logit, ...FS.price_ext, ...FS.v2, ...FS.breadth, ...FS.southbound], l2: 10}),
    'trans+mlr': tr => { const a = M.fitTransition(tr, {edges: [0.5], alpha: 1}), b = M.fitMLR(tr, {features: [...FS.core, ...FS.v1logit, ...FS.price_ext, ...FS.v2, ...FS.breadth, ...FS.southbound], l2: 10}); return {params: {}, predict: r => mix(a.predict(r), b.predict(r), 0.5)}; }};
  for (const [name, fs_] of Object.entries(statModels)) for (const w of [0.25, 0.5, 0.75, 1]) add(4, `ens-${name}-w${w}`, `集成：${w}×${name} + ${1 - w}×v1 原始概率`, tr => { const m = fs_(tr); return {params: {w, base: m.params}, predict: r => mix(m.predict(r), r.raw_v1, w)}; });
  return C;
}
const mix = (p, q, w) => Object.fromEntries(KEYS.map(k => [k, w * p[k] + (1 - w) * q[k]]));

// Rolling-origin CV inside the training block (expanding window, 4 folds) — used as a stability check for MLR hyperparameters.
function rollingCV(train, cand) {
  const n = train.length, folds = 4, first = Math.floor(n * 0.5), step = Math.floor((n - first) / folds), res = [];
  for (let f = 0; f < folds; f++) { const a = first + f * step, b = f === folds - 1 ? n : a + step, m = cand.fit(train.slice(0, a)), te = train.slice(a, b);
    res.push(score(te, te.map(r => M.rounded(m.predict(r), cand.bounds))).brier); }
  return r4(res.reduce((s, x) => s + x, 0) / res.length);
}

function loadLedger() { try { return JSON.parse(fs.readFileSync(LEDGER, 'utf8')); } catch { return {protocol: null, attempts: [], holdout: null}; } }
function saveLedger(L) { fs.mkdirSync(OUT, {recursive: true}); fs.writeFileSync(LEDGER, JSON.stringify(L, null, 1) + '\n'); }

function runStages(table, stages) {
  const {train, val} = split(table), L = loadLedger();
  L.protocol = {split: 'chronological 60/20/20', train: [train[0].date, train.at(-1).date, train.length], val: [val[0].date, val.at(-1).date, val.length],
    holdout_reserved: [table[Math.floor(table.length * .8)].date, table.at(-1).date, table.length - Math.floor(table.length * .8)],
    selection_rule: 'lowest validation Brier (production-format output, step 0.05) among candidates whose validation Brier < v1; holdout scored once after selection',
    ship_bounds: SHIP_BOUNDS};
  const v1Val = val.map(r => r.p_v1);
  for (const c of candidates(stages)) {
    const t0 = Date.now(); let m, rec;
    try {
      m = c.fit(train);
      const Pv = val.map(r => M.rounded(m.predict(r), c.bounds)), Pt = train.map(r => M.rounded(m.predict(r), c.bounds)), Praw = val.map(r => m.predict(r));
      rec = {id: c.id, stage: c.stage, desc: c.desc, bounds: c.bounds, params: m.params, train: score(train, Pt), val: score(val, Pv), val_raw: score(val, Praw),
        val_diff_vs_v1: diffCI(val, Pv, v1Val), cv_train_rolling: c.stage === 3 ? rollingCV(train, c) : null, ms: Date.now() - t0, status: 'ok'};
    } catch (e) { rec = {id: c.id, stage: c.stage, desc: c.desc, status: 'error', error: String(e.message || e)}; }
    L.attempts = L.attempts.filter(a => a.id !== rec.id).concat(rec);
    console.log(rec.id, rec.status, rec.val ? JSON.stringify({tr: rec.train.brier, val: rec.val.brier, raw: rec.val_raw.brier, d: rec.val_diff_vs_v1, cv: rec.cv_train_rolling}) : rec.error);
  }
  saveLedger(L);
  return L;
}

// One-time holdout: the selected candidate is refitted on train+validation with frozen hyperparameters and scored on holdout.
// Refuses to run twice (ledger.holdout already present) unless --force-rerun-identical (only re-prints the identical computation).
function runHoldout(table, selectedId) {
  const L = loadLedger();
  if (L.holdout && L.holdout.selected !== selectedId) throw Error('Holdout already used for ' + L.holdout.selected + '; protocol forbids re-selection');
  const {train, val, hold} = split(table), cand = candidates([1, 2, 3, 4]).find(c => c.id === selectedId);
  if (!cand) throw Error('unknown candidate ' + selectedId);
  const m = cand.fit(train.concat(val)), mTrainOnly = cand.fit(train);
  const P = hold.map(r => M.rounded(m.predict(r), cand.bounds)), V1 = hold.map(r => r.p_v1), PER = hold.map(r => r.p_persistence);
  const PT = hold.map(r => M.rounded(mTrainOnly.predict(r), cand.bounds));
  const v1cal = hold.map(r => r.raw_v1);
  const res = {selected: selectedId, desc: cand.desc, fitted_on: 'train+validation (' + (train.length + val.length) + ' rows), hyperparameters frozen from validation', params: m.params,
    range: [hold[0].date, hold.at(-1).date], n: hold.length,
    selected_score: score(hold, P), v1: score(hold, V1), persistence: score(hold, PER),
    diff_vs_v1: diffCI(hold, P, V1), diff_vs_persistence: diffCI(hold, P, PER),
    sensitivity_train_only_fit: {score: score(hold, PT), diff_vs_v1: diffCI(hold, PT, V1)},
    outcome_freq: Object.fromEntries(KEYS.map(k => [k, r4(hold.filter(r => r.outcome === k).length / hold.length)])),
    calibration: calTable(hold, P), calibration_v1: calTable(hold, V1), evaluated_at: new Date().toISOString()};
  L.holdout = res; saveLedger(L); return res;
}
function calTable(rows, P) { const bins = Array.from({length: 10}, (_, i) => ({bin: (i / 10).toFixed(1) + '-' + ((i + 1) / 10).toFixed(1), n: 0, sp: 0, so: 0})); rows.forEach((r, i) => KEYS.forEach(k => { const p = P[i][k], b = bins[Math.min(9, Math.floor(p * 10 + 1e-9))]; b.n++; b.sp += p; b.so += r.outcome === k ? 1 : 0; })); return bins.filter(b => b.n).map(b => ({bin: b.bin, n: b.n, mean_pred: r4(b.sp / b.n), freq: r4(b.so / b.n)})); }

module.exports = {split, score, diffCI, candidates, runStages, runHoldout, loadLedger, saveLedger, SHIP_BOUNDS, calTable};

if (require.main === module) {
  const arg = k => (process.argv.find(a => a.startsWith('--' + k + '=')) || '').split('=')[1];
  const stages = (arg('stage') || '1').split(',').map(Number);
  const table = F.buildTable();
  if (arg('holdout')) console.log(JSON.stringify(runHoldout(table, arg('holdout')), null, 1));
  else runStages(table, stages);
}
