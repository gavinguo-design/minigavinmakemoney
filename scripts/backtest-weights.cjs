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
    if (out.models[info.version].p.A !== a.forecast.scenarios.find(s => s.id === 'A').probability) throw Error('build/score mismatch');
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
function baselines(prevOutcomes) {
  const n = prevOutcomes.length, cnt = {A: 0, B: 0, C: 0};
  prevOutcomes.forEach(o => cnt[o]++);
  const freq = Object.fromEntries(KEYS.map(k => [k, (cnt[k] + 1) / (n + 3)]));
  const y = prevOutcomes.at(-1);
  const persist = y ? Object.fromEntries(KEYS.map(k => [k, k === y ? 0.6 : 0.2])) : {A: 1 / 3, B: 1 / 3, C: 1 / 3};
  return {uniform: {A: 1 / 3, B: 1 / 3, C: 1 / 3}, hist_freq: freq, persistence: persist};
}

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

function calibration(rows, model) {
  const bins = Array.from({length: 10}, (_, i) => ({bin: (i / 10).toFixed(1) + '-' + ((i + 1) / 10).toFixed(1), n: 0, sp: 0, so: 0}));
  for (const r of rows) for (const k of KEYS) { const p = r.p[model][k], b = bins[Math.min(9, Math.floor(p * 10 + 1e-9))]; b.n++; b.sp += p; b.so += r.outcome === k ? 1 : 0; }
  const out = bins.filter(b => b.n).map(b => ({bin: b.bin, n: b.n, mean_pred: r4(b.sp / b.n), freq: r4(b.so / b.n)}));
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
      const p = {...Object.fromEntries(Object.entries(g.models).map(([k, v]) => [k, v.p])), ...baselines(outcomes)};
      rows.push({date, baseline: g.baseline, base_close: g.base_close, close: byDate.get(date).close, lower: g.lower, upper: g.upper, outcome, p,
        raw: Object.fromEntries(Object.entries(g.models).map(([k, v]) => [k, v.raw])), v2_regime: g.models['rule-weights-v2.1']?.regime || null,
        adx14: a == null ? null : Math.round(a * 10) / 10, regime: a == null ? 'unknown' : a >= 25 ? 'trend' : a < 20 ? 'range' : 'transition'});
    }
    outcomes.push(outcome);
  }
  return {rows, skipped};
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
      models_same_day: row ? Object.fromEntries(['rule-weights-v1', 'rule-weights-v2.1', 'uniform', 'persistence', 'hist_freq'].filter(m => row.p[m]).map(m => [m, {p: row.p[m], outcome: row.outcome, brier: r4(brier(row.p[m], row.outcome))}])) : null,
      model_rules: row ? {lower: row.lower, upper: row.upper} : null};
  });
}

module.exports = {scoreManual, loadData, withCalendar, generateDay, judgeOutcome, adx, brier, logloss, hit, baselines, blockBootstrap, calibration, summarize, runBacktest, evaluate, KEYS};

if (require.main === module) {
  const data = loadData(), {rows, skipped} = runBacktest({data});
  const models = Object.keys(rows[0].p).filter(m => m.startsWith('rule-weights'));
  const base = ['uniform', 'hist_freq', 'persistence'];
  const meta = {generated_by: 'scripts/backtest-weights.cjs', repo_commit: require('node:child_process').execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim(),
    data_file: path.relative(root, DATA_FILE), data_source: data.source, data_candles_sha256: data.candles_sha256, raw_response_sha256: data.raw_response_sha256,
    window: [rows[0].date, rows.at(-1).date], sessions: rows.length, skipped, breadth: 'unavailable (no point-in-time history in repo); breadth factor = 0 for all models',
    southbound: 'not used by any model; research/data/ not present at run time',
    note: '只评估、未调参。Brier 为三类求和形式（0–2，均匀 1/3 基准 = 0.667）。CI 为 10 日移动块 bootstrap 2000 次。'};
  for (const m of models) {
    const tag = m === 'rule-weights-v1' ? 'v1' : 'v2.1';
    const ev = evaluate(rows, [m, ...base, ...models.filter(x => x !== m)]);
    fs.writeFileSync(path.join(OUT_DIR, 'results-' + tag + '.json'), JSON.stringify({meta: {...meta, model: m}, ...ev, manual_records: scoreManual(rows, data.candles)}, null, 1) + '\n');
  }
  const cols = ['date', 'baseline', 'close', 'lower', 'upper', 'outcome', 'adx14', 'regime', 'v2_regime'];
  const all = [...models, ...base];
  const header = [...cols, ...all.flatMap(m => KEYS.map(k => m + '_' + k)), ...all.map(m => m + '_brier')];
  const lines = [header.join(',')].concat(rows.map(r => [...cols.map(c => r[c] ?? ''), ...all.flatMap(m => KEYS.map(k => r4(r.p[m][k]))), ...all.map(m => r4(brier(r.p[m], r.outcome)))].join(',')));
  fs.writeFileSync(path.join(OUT_DIR, 'daily-ledger.csv'), lines.join('\n') + '\n');
  console.log(JSON.stringify({sessions: rows.length, skipped: skipped.length, models}, null, 0));
}
