// Walk-forward evaluation of the A/B/C rule weights (research only; never tunes
// coefficients, never edits production code or frozen archives).
// For each session t: inputs are completed candles with date < t only. Rules and
// weights come from scripts/daily-analysis.cjs (build + scoreScenarioWeights via
// require); the realised scenario is judged with MarketRules.priceCondition on
// the close of t using the same price_rule objects.
'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = path.join(__dirname, '..');
const MR = require('../investment/chart/market-rules.js');
const DA = require('./daily-analysis.cjs');
const KEYS = ['A', 'B', 'C'];
const V3_RAW = 'rule-weights-v3_raw'; // scoring-only: unbounded/unrounded v3 softmax
const DATA_FILE = path.join(root, 'research/backtest/data/hsi-daily-2024-06_2026-10.json');
const OUT_DIR = path.join(root, 'research/backtest');
const START = '2024-10-01', END = '2026-10-09';

function loadData(file = DATA_FILE) {
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  const sha = crypto.createHash('sha256').update(JSON.stringify(d.candles)).digest('hex');
  if (sha !== d.candles_sha256) throw Error('Candle checksum mismatch');
  return d;
}

// MarketRules only ships the 2026/2027 HKEX calendar (unknown years fail closed).
// For 2024-2025 sessions we temporarily extend the *exported* calendar helpers with
// the observed HKEX session dates (holiday schedules are published in advance, so
// this is not future information). Restored after every call.
function withCalendar(sessionDates, fn) {
  const sessions = new Set(sessionDates), orig = {tradingDay: MR.tradingDay, latestDay: MR.latestDay, horizon: MR.horizon};
  const td = d => (d >= '2026-01-01' ? orig.tradingDay(d) : /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= sessionDates[0] ? sessions.has(d) : null);
  MR.tradingDay = td;
  MR.latestDay = (now, completed) => {
    const h = MR.hk(now);
    let date = h.date;
    const close = 970; // only called at 08:45 preopen by build(); half-days irrelevant before 09:30
    if (td(date) !== true || h.minute < 570 || (completed && h.minute < close)) date = MR.shift(date, -1);
    for (let i = 0; i < 20; i++, date = MR.shift(date, -1)) { const t = td(date); if (t == null) return null; if (t) return date; }
    return null;
  };
  // Display-only horizon label (not used by rules/weights); internal closure cannot see the extension.
  MR.horizon = (date, count) => {
    let d = date; const days = [];
    for (let i = 0; i < count * 5 + 20 && days.length < count; i++) { d = MR.shift(d, 1); const t = td(d); if (t == null) { if (d > sessionDates.at(-1) && d < '2026-01-01') { continue; } break; } if (t) days.push(d); }
    return days.length === count ? {start: date, count, end: days.at(-1), description: '未来' + count + '个交易日（回测标签）'} : {start: date, count, end: null, description: 'n/a'};
  };
  try { return fn(); } finally { Object.assign(MR, orig); }
}

const r4 = v => Math.round(v * 1e4) / 1e4;
function v3Unrounded(V3, args) {
  const f = V3.featuresV3(args), L = V3.WEIGHT_MODEL_V3.W.map(w => w.reduce((s, wf, j) => s + wf * f.x[j], 0)), mx = Math.max(...L), e = L.map(v => Math.exp(v - mx)), z = e.reduce((a, b) => a + b, 0);
  return Object.fromEntries(KEYS.map((k, i) => [k, e[i] / z]));
}
// Model-independent generation for session `date` from candles strictly before it.
function generateDay(date, candles, sessionDates) {
  const past = candles.filter(b => b.date < date);
  const feed = {symbol: '^HSI', source: 'research/backtest Yahoo ^HSI snapshot', updated_at: date + 'T08:40:00+08:00', candles: past};
  return withCalendar(sessionDates, () => {
    const a = DA.build({date, feed, seed: null, participation: null, generatedAt: date + 'T08:45:00+08:00', backfill: true, ruleWeights: true});
    const rules = Object.fromEntries(a.forecast.scenarios.map(s => [s.id, s.price_rule]));
    const info = a.forecast.weight_model_info, f = info.factors;
    const bars = past.map(b => ({...b, time: b.date}));
    // Score both frozen models explicitly with identical inputs (production default is irrelevant here).
    const out = {date, baseline: a.forecast.baseDate, base_close: a.forecast.basePrice, lower: f.lower, upper: f.upper, rules, models: {}};
    for (const model of [DA.WEIGHT_MODEL_V1, DA.WEIGHT_MODEL_V2]) {
      const w = DA.scoreScenarioWeights({bars, lower: f.lower, upper: f.upper, participation: null, cutoff: date + 'T08:45:00+08:00', dataUpdatedAt: feed.updated_at, model});
      out.models[w.version] = {version: w.version, p: w.probabilities, raw: w.raw, regime: w.factors.regime || null};
    }
    // v3 (frozen production/fallback model): bounded probabilities as published, plus the unrounded softmax output
    // (same features and W; scoring-only comparison for SF-P0-2 — production truncation is NOT changed here).
    const V3 = require('./weights-v3.cjs'), cutoff = date + 'T08:45:00+08:00';
    const w3 = V3.scoreScenarioWeightsV3({bars, lower: f.lower, upper: f.upper, cutoff});
    out.models[w3.version] = {version: w3.version, p: w3.probabilities, raw: v3Unrounded(V3, {bars, lower: f.lower, upper: f.upper, cutoff}), regime: w3.factors.regime};
    if (info.version === 'rule-weights-v3') {
      if (w3.probabilities.A !== a.forecast.scenarios.find(s => s.id === 'A').probability) throw Error('build/score mismatch (v3)');
    } else if (out.models[info.version].p.A !== a.forecast.scenarios.find(s => s.id === 'A').probability) throw Error('build/score mismatch');
    return out;
  });
}

function judgeOutcome(rules, close) {
  const hits = KEYS.filter(k => MR.priceCondition(rules[k], close) === true);
  if (hits.length !== 1) throw Error('Partition violated: ' + hits.join(','));
  return hits[0];
}

// Wilder ADX14 on completed bars; value at last bar.
function adx(bars, n = 14) {
  if (bars.length < 2 * n + 1) return null;
  const tr = [], pdm = [], ndm = [];
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i], p = bars[i - 1], up = b.high - p.high, dn = p.low - b.low;
    tr.push(Math.max(b.high - b.low, Math.abs(b.high - p.close), Math.abs(b.low - p.close)));
    pdm.push(up > dn && up > 0 ? up : 0); ndm.push(dn > up && dn > 0 ? dn : 0);
  }
  let st = tr.slice(0, n).reduce((a, b) => a + b, 0), sp = pdm.slice(0, n).reduce((a, b) => a + b, 0), sn = ndm.slice(0, n).reduce((a, b) => a + b, 0);
  const dx = [];
  for (let i = n; i <= tr.length; i++) {
    if (i > n) { st = st - st / n + tr[i - 1]; sp = sp - sp / n + pdm[i - 1]; sn = sn - sn / n + ndm[i - 1]; }
    const pdi = 100 * sp / st, ndi = 100 * sn / st;
    dx.push(pdi + ndi ? 100 * Math.abs(pdi - ndi) / (pdi + ndi) : 0);
  }
  if (dx.length < n) return null;
  let a = dx.slice(0, n).reduce((x, y) => x + y, 0) / n;
  for (let i = n; i < dx.length; i++) a = (a * (n - 1) + dx[i]) / n;
  return a;
}

const brier = (p, o) => KEYS.reduce((s, k) => s + (p[k] - (o === k ? 1 : 0)) ** 2, 0);
const logloss = (p, o) => -Math.log(Math.max(p[o], 1e-6));
function hit(p, o) { const m = Math.max(...KEYS.map(k => p[k])), top = KEYS.filter(k => Math.abs(p[k] - m) < 1e-9); return top.includes(o) ? 1 / top.length : 0; }

// Baselines use only outcomes realised strictly before t.
// persistence (primary, SF-P0-1): expanding-window empirical transition matrix P(o_t | o_{t-1}) with Laplace (+1)
// smoothing, estimated only from consecutive outcome pairs realised before t. persistence_fixed = legacy 0.6/0.2/0.2.
// Pairs are formed over the outcome chain as recorded (a skipped session simply joins its neighbours).
function baselines(prevOutcomes) {
  const n = prevOutcomes.length, cnt = {A: 0, B: 0, C: 0};
  prevOutcomes.forEach(o => cnt[o]++);
  const freq = Object.fromEntries(KEYS.map(k => [k, (cnt[k] + 1) / (n + 3)]));
  const y = prevOutcomes.at(-1);
  const fixed = y ? Object.fromEntries(KEYS.map(k => [k, k === y ? 0.6 : 0.2])) : {A: 1 / 3, B: 1 / 3, C: 1 / 3};
  let emp = {A: 1 / 3, B: 1 / 3, C: 1 / 3};
  if (y) {
    const t = {A: 1, B: 1, C: 1};
    for (let i = 1; i < n; i++) if (prevOutcomes[i - 1] === y) t[prevOutcomes[i]]++;
    const s = t.A + t.B + t.C; emp = Object.fromEntries(KEYS.map(k => [k, t[k] / s]));
  }
  return {uniform: {A: 1 / 3, B: 1 / 3, C: 1 / 3}, hist_freq: freq, persistence: emp, persistence_fixed: fixed};
}

// Brier skill score vs a reference: 1 - BS_model / BS_ref (paired moving-block bootstrap CI).
function bss(rows, m, ref, {reps = 2000, block = 10, seed = 20261012} = {}) {
  const n = rows.length; if (!n) return null;
  const a = rows.map(r => brier(r.p[m], r.outcome)), b = rows.map(r => brier(r.p[ref], r.outcome));
  const est = 1 - a.reduce((x, y) => x + y, 0) / b.reduce((x, y) => x + y, 0), r = rng(seed), v = [];
  for (let k = 0; k < reps; k++) { let sa = 0, sb = 0, c = 0; while (c < n) { const st = Math.floor(r() * n); for (let j = 0; j < block && c < n; j++, c++) { sa += a[(st + j) % n]; sb += b[(st + j) % n]; } } v.push(1 - sa / sb); }
  v.sort((x, y) => x - y);
  return {bss: r4(est), lo: r4(v[Math.floor(0.025 * reps)]), hi: r4(v[Math.ceil(0.975 * reps) - 1])};
}

// Murphy (1973) decomposition of the 3-class-sum Brier: BS = REL - RES + UNC (+ within-bin term when forecasts are binned).
// Forecasts are grouped per class by value rounded to `width` (production probabilities sit on a 0.05 grid -> exact).
function murphy(rows, model, {width = 0.05, pick = r => r.p[model]} = {}) {
  const N = rows.length; if (!N) return null;
  let rel = 0, res = 0, unc = 0, bs = 0;
  for (const k of KEYS) {
    const obar = rows.filter(r => r.outcome === k).length / N, g = new Map();
    unc += obar * (1 - obar);
    for (const r of rows) { const p = pick(r)[k], o = r.outcome === k ? 1 : 0, key = Math.round(p / width), x = g.get(key) || {n: 0, sp: 0, so: 0}; x.n++; x.sp += p; x.so += o; g.set(key, x); bs += (p - o) ** 2; }
    for (const x of g.values()) { const pm = x.sp / x.n, om = x.so / x.n; rel += x.n * (pm - om) ** 2; res += x.n * (om - obar) ** 2; }
  }
  rel /= N; res /= N; bs /= N;
  // On the production 0.05 grid each bin holds one forecast value, so BS = REL - RES + UNC exactly (residual 0).
  // For continuous (raw) forecasts the residual is the within-bin term and is reported, not hidden.
  return {brier: r4(bs), reliability: r4(rel), resolution: r4(res), uncertainty: r4(unc), residual: r4(bs - (rel - res + unc)), bin_width: width};
}

function wilson(k, n, z = 1.96) { if (!n) return null; const p = k / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d; return [r4(Math.max(0, c - h)), r4(Math.min(1, c + h))]; }

function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
// Moving-block bootstrap of the mean (daily outcomes are autocorrelated).
function blockBootstrap(values, {reps = 2000, block = 10, seed = 20261012} = {}) {
  const n = values.length, r = rng(seed), means = [];
  if (!n) return null;
  for (let b = 0; b < reps; b++) {
    let s = 0, c = 0;
    while (c < n) { const st = Math.floor(r() * n); for (let j = 0; j < block && c < n; j++, c++) s += values[(st + j) % n]; }
    means.push(s / n);
  }
  means.sort((a, b) => a - b);
  return {mean: values.reduce((a, b) => a + b, 0) / n, lo: means[Math.floor(0.025 * reps)], hi: means[Math.ceil(0.975 * reps) - 1]};
}

function calibration(rows, model, pick = r => r.p[model]) {
  const bins = Array.from({length: 10}, (_, i) => ({bin: (i / 10).toFixed(1) + '-' + ((i + 1) / 10).toFixed(1), n: 0, sp: 0, so: 0}));
  for (const r of rows) for (const k of KEYS) { const p = pick(r)[k], b = bins[Math.min(9, Math.floor(p * 10 + 1e-9))]; b.n++; b.sp += p; b.so += r.outcome === k ? 1 : 0; }
  const out = bins.filter(b => b.n).map(b => ({bin: b.bin, n: b.n, mean_pred: r4(b.sp / b.n), freq: r4(b.so / b.n), freq_wilson95: wilson(b.so, b.n)}));
  const total = out.reduce((s, b) => s + b.n, 0);
  return {bins: out, ece: r4(out.reduce((s, b) => s + b.n / total * Math.abs(b.mean_pred - b.freq), 0))};
}

function summarize(rows, models, opts) {
  const res = {n: rows.length};
  for (const m of models) {
    const b = rows.map(r => brier(r.p[m], r.outcome)), l = rows.map(r => logloss(r.p[m], r.outcome)), h = rows.map(r => hit(r.p[m], r.outcome));
    res[m] = {brier: rows.length ? r4(b.reduce((a, x) => a + x, 0) / rows.length) : null, brier_ci: rows.length ? (x => ({lo: r4(x.lo), hi: r4(x.hi)}))(blockBootstrap(b, opts)) : null,
      logloss: rows.length ? r4(l.reduce((a, x) => a + x, 0) / rows.length) : null, hit_rate: rows.length ? r4(h.reduce((a, x) => a + x, 0) / rows.length) : null};
  }
  return res;
}
function diffCI(rows, a, b, opts) { const d = rows.map(r => brier(r.p[a], r.outcome) - brier(r.p[b], r.outcome)), x = blockBootstrap(d, opts); return x && {mean: r4(x.mean), lo: r4(x.lo), hi: r4(x.hi)}; }

function runBacktest({data = loadData(), start = START, end = END} = {}) {
  const candles = data.candles, dates = candles.map(c => c.date), byDate = new Map(candles.map(c => [c.date, c]));
  const rows = [], skipped = [], outcomes = [];
  for (const date of dates) {
    if (date > end) break;
    let g;
    try { g = generateDay(date, candles, dates); } catch (e) { if (date >= start) skipped.push({date, reason: e.message}); continue; }
    const outcome = judgeOutcome(g.rules, byDate.get(date).close);
    if (date >= start) {
      const past = candles.filter(b => b.date < date), a = adx(past);
      const p = {...Object.fromEntries(Object.entries(g.models).map(([k, v]) => [k, v.p])), [V3_RAW]: g.models['rule-weights-v3'].raw, ...baselines(outcomes)};
      rows.push({date, baseline: g.baseline, base_close: g.base_close, close: byDate.get(date).close, lower: g.lower, upper: g.upper, outcome, p,
        raw: Object.fromEntries(Object.entries(g.models).map(([k, v]) => [k, v.raw])), v2_regime: g.models['rule-weights-v2.1']?.regime || null,
        adx14: a == null ? null : Math.round(a * 10) / 10, regime: a == null ? 'unknown' : a >= 25 ? 'trend' : a < 20 ? 'range' : 'transition'});
    }
    outcomes.push(outcome);
  }
  return {rows, skipped};
}

const BASELINES = ['uniform', 'hist_freq', 'persistence', 'persistence_fixed'];
// BSS of each model vs uniform / hist_freq / empirical persistence (primary) / legacy fixed persistence.
function skillTable(rows, models, opts = {}) {
  const refs = BASELINES.filter(b => rows.length && rows[0].p[b]);
  return Object.fromEntries(models.filter(m => rows.length && rows[0].p[m]).map(m => [m, Object.fromEntries(refs.map(b => [b, bss(rows, m, b, opts)]))]));
}
function evaluate(rows, models, opts = {}) {
  const cut = Math.floor(rows.length * 0.7), early = rows.slice(0, cut), late = rows.slice(cut);
  const group = f => Object.fromEntries([...new Set(rows.map(f))].sort().map(g => [g, summarize(rows.filter(r => f(r) === g), models, opts)]));
  const primary = models[0];
  return {
    overall: summarize(rows, models, opts), split: {first_70: {range: [early[0]?.date, early.at(-1)?.date], ...summarize(early, models, opts)}, last_30: {range: [late[0]?.date, late.at(-1)?.date], ...summarize(late, models, opts)}},
    by_year: group(r => r.date.slice(0, 4)), by_regime_v21: group(r => r.v2_regime || 'unknown'), by_regime_adx: group(r => r.regime),
    brier_diff_vs: Object.fromEntries(models.filter(m => m !== primary).map(m => [primary + ' - ' + m, diffCI(rows, primary, m, opts)])),
    calibration: Object.fromEntries(models.map(m => [m, calibration(rows, m)])),
    skill: skillTable(rows, models.filter(m => !BASELINES.includes(m)), opts),
    murphy: Object.fromEntries(models.map(m => [m, murphy(rows, m)])),
    outcome_freq: Object.fromEntries(KEYS.map(k => [k, r4(rows.filter(r => r.outcome === k).length / rows.length)]))
  };
}

// Real manual records: transcribed rules judged on the session close; model rows for same day attached.
function scoreManual(rows, candles, file = path.join(OUT_DIR, 'manual-rules.json')) {
  const spec = JSON.parse(fs.readFileSync(file, 'utf8')), byDate = new Map(candles.map(c => [c.date, c]));
  return spec.records.map(rec => {
    const close = byDate.get(rec.session)?.close;
    const hits = KEYS.filter(k => MR.priceCondition(rec.rules[k], close) === true);
    const outcome = hits.length === 1 ? hits[0] : hits.length ? 'ambiguous' : 'none';
    const row = rows.find(r => r.date === rec.session);
    const sum = KEYS.reduce((s, k) => s + rec.p[k], 0);
    return {id: rec.id, session: rec.session, close, p: rec.p, outcome,
      brier: KEYS.includes(outcome) ? r4(brier(rec.p, outcome)) : null, hit: KEYS.includes(outcome) ? hit(rec.p, outcome) : null, prob_sum: r4(sum),
      models_same_day: row ? Object.fromEntries(['rule-weights-v1', 'rule-weights-v2.1', 'rule-weights-v3', 'uniform', 'persistence', 'persistence_fixed', 'hist_freq'].filter(m => row.p[m]).map(m => [m, {p: row.p[m], outcome: row.outcome, brier: r4(brier(row.p[m], row.outcome))}])) : null,
      model_rules: row ? {lower: row.lower, upper: row.upper} : null};
  });
}

module.exports = {bss, murphy, wilson, skillTable, BASELINES, V3_RAW, v3Unrounded, scoreManual, loadData, withCalendar, generateDay, judgeOutcome, adx, brier, logloss, hit, baselines, blockBootstrap, calibration, summarize, runBacktest, evaluate, KEYS};

if (require.main === module) {
  const data = loadData(), {rows, skipped} = runBacktest({data});
  const models = Object.keys(rows[0].p).filter(m => m.startsWith('rule-weights'));
  const base = BASELINES;
  const meta = {generated_by: 'scripts/backtest-weights.cjs', repo_commit: require('node:child_process').execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim(),
    data_file: path.relative(root, DATA_FILE), data_source: data.source, data_candles_sha256: data.candles_sha256, raw_response_sha256: data.raw_response_sha256,
    window: [rows[0].date, rows.at(-1).date], sessions: rows.length, skipped, breadth: 'unavailable (no point-in-time history in repo); breadth factor = 0 for all models',
    southbound: 'not used by any model; research/data/ not present at run time',
    baselines: {uniform: '1/3 each', hist_freq: 'expanding outcome frequency (+1), outcomes < t', persistence: 'PRIMARY: expanding empirical transition P(o_t|o_{t-1}) with +1 smoothing, pairs realised < t', persistence_fixed: 'legacy 0.6/0.2/0.2 on o_{t-1} (kept for comparability)'},
    v3_raw_note: 'rule-weights-v3_raw = unbounded/unrounded v3 softmax (same frozen W); scoring-only comparison, production keeps [0.10,0.85] step 0.05 (SF-P0-2 needs walk-forward before any change). v3 W was fitted on 2024-10-02..2025-12-15, so that span is in-sample for v3.',
    note: '只评估、未调参。Brier 为三类求和形式（0–2，均匀 1/3 基准 = 0.667）。CI 为 10 日移动块 bootstrap 2000 次。BSS = 1 − BS_model/BS_ref。Murphy: BS = REL − RES + UNC（按 0.05 档分组）。'};
  for (const m of models.filter(x => x !== V3_RAW)) {
    const tag = {'rule-weights-v1': 'v1', 'rule-weights-v2.1': 'v2.1', 'rule-weights-v3': 'v3'}[m];
    const extra = m === 'rule-weights-v3' ? [V3_RAW] : [];
    const ev = evaluate(rows, [m, ...extra, ...base, ...models.filter(x => x !== m && !extra.includes(x))]);
    fs.writeFileSync(path.join(OUT_DIR, 'results-' + tag + '.json'), JSON.stringify({meta: {...meta, model: m}, ...ev, manual_records: scoreManual(rows, data.candles)}, null, 1) + '\n');
  }
  // Skill / calibration summary for all models (v3 holdout window = 2026-05-18..2026-10-09 is out-of-sample for v3).
  const hold = rows.filter(r => r.date >= '2026-05-18'), all = [...models, ...base];
  const skill = {meta, overall: {n: rows.length, brier: Object.fromEntries(all.map(m => [m, r4(rows.reduce((s, r) => s + brier(r.p[m], r.outcome), 0) / rows.length)])), bss: skillTable(rows, models), murphy: Object.fromEntries(all.map(m => [m, murphy(rows, m)]))},
    v3_oos_holdout: {range: [hold[0].date, hold.at(-1).date], n: hold.length, brier: Object.fromEntries(all.map(m => [m, r4(hold.reduce((s, r) => s + brier(r.p[m], r.outcome), 0) / hold.length)])), bss: skillTable(hold, models), murphy: Object.fromEntries(all.map(m => [m, murphy(hold, m)]))},
    calibration_curves: Object.fromEntries(all.map(m => [m, calibration(rows, m)])),
    calibration_curves_v3_holdout: Object.fromEntries(all.map(m => [m, calibration(hold, m)]))};
  fs.writeFileSync(path.join(OUT_DIR, 'skill-calibration.json'), JSON.stringify(skill, null, 1) + '\n');
  const cols = ['date', 'baseline', 'close', 'lower', 'upper', 'outcome', 'adx14', 'regime', 'v2_regime'];
  const header = [...cols, ...all.flatMap(m => KEYS.map(k => m + '_' + k)), ...all.map(m => m + '_brier')];
  const lines = [header.join(',')].concat(rows.map(r => [...cols.map(c => r[c] ?? ''), ...all.flatMap(m => KEYS.map(k => r4(r.p[m][k]))), ...all.map(m => r4(brier(r.p[m], r.outcome)))].join(',')));
  fs.writeFileSync(path.join(OUT_DIR, 'daily-ledger.csv'), lines.join('\n') + '\n');
  console.log(JSON.stringify({sessions: rows.length, models, bss_overall: skill.overall.bss, bss_v3_holdout: skill.v3_oos_holdout.bss}, null, 1));
}
