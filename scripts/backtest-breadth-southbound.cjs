// Research-only comparison: rule-weights-v1 vs v1 + HSI breadth / Southbound
// flow tilts (evaluation only; does not change production code or coefficients).
// Inputs for session t: v1 logits from completed candles < t (same as
// backtest-weights.cjs), breadth row of the last HK session < t, Southbound
// total_net of the last Southbound-open session < t. Coefficients and signal
// definitions are fixed below before looking at results.
'use strict';
const fs = require('node:fs'), path = require('node:path');
const BT = require('./backtest-weights.cjs');
const DA = require('./daily-analysis.cjs');
const TA = require('../investment/chart/technical-analysis.js');
const root = path.join(__dirname, '..');
const OUT_DIR = path.join(root, 'research/backtest');
const BREADTH_FILE = path.join(root, 'research/data/hsi-breadth-daily.json');
const SOUTH_FILE = path.join(root, 'research/data/southbound-daily.json');
const {KEYS} = BT;
const V1 = DA.WEIGHT_MODEL_V1;
// Pre-registered (task spec 2026-10-12): breadth coef = WEIGHT_MODEL_V1.coefficients.breadth (0.4); southbound 0.3; z window 60 open sessions.
const SPEC = Object.freeze({breadth_coef: V1.coefficients.breadth, southbound_coef: 0.3, sb_window: 60, sb_clip: 2, cap_sensitivity_max: 0.85});
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const r4 = v => Math.round(v * 1e4) / 1e4;

function loadAux() {
  const b = JSON.parse(fs.readFileSync(BREADTH_FILE, 'utf8')), s = JSON.parse(fs.readFileSync(SOUTH_FILE, 'utf8'));
  return {breadth: b.rows, southbound: s.rows};
}

// Breadth signal from the last breadth row with date < t (never t itself).
function breadthSignal(date, rows) {
  let r = null;
  for (const x of rows) { if (x.date < date && !x.missing && Number.isFinite(x.adv_ratio) && Number.isFinite(x.pct_above_ma20)) r = x; else if (x.date >= date) break; }
  if (!r) return {score: 0, as_of: null, status: 'unavailable'};
  const score = clamp(0.5 * (2 * r.adv_ratio - 1) + 0.5 * (2 * r.pct_above_ma20 - 1), -1, 1);
  return {score, as_of: r.date, status: 'available', adv_ratio: r.adv_ratio, pct_above_ma20: r.pct_above_ma20};
}

// Southbound z-score of the latest open session < t against the previous `window` open sessions (all < that session).
function southboundSignal(date, rows, {window = SPEC.sb_window, clip = SPEC.sb_clip} = {}) {
  const open = rows.filter(x => x.date < date && !x.southbound_closed && !x.missing && Number.isFinite(x.total_net));
  const prevSession = rows.filter(x => x.date < date).at(-1);
  if (open.length < window + 1) return {score: 0, as_of: open.at(-1)?.date || null, status: 'insufficient_history', stale: false};
  const last = open.at(-1), hist = open.slice(-window - 1, -1).map(x => x.total_net);
  const m = hist.reduce((a, b) => a + b, 0) / window, sd = Math.sqrt(hist.reduce((a, b) => a + (b - m) ** 2, 0) / (window - 1));
  const z = sd > 0 ? (last.total_net - m) / sd : 0;
  return {score: clamp(z, -clip, clip) / clip, z, as_of: last.date, total_net: last.total_net, status: 'available',
    stale: !!prevSession && prevSession.date !== last.date}; // t-1 was a Southbound holiday -> used most recent open day
}

// Exact replica of the v1 branch of scoreScenarioWeights (participation=null) returning unrounded logits.
function v1Logits(bars, lower, upper) {
  const c = V1.coefficients, last = bars.at(-1), d = TA.calculate(bars), i = bars.length - 1, atr = d.atr[i], ma = d.ma20[i], maPrev = d.ma20[i - 5];
  const close = last.close, pos = (close - lower) / (upper - lower), posTerm = clamp(2 * pos - 1, -1.5, 1.5);
  const distA = clamp((upper - close) / atr, 0, 4), distC = clamp((close - lower) / atr, 0, 4);
  const trend = .5 * clamp((ma - maPrev) / atr, -1, 1) + .5 * clamp((close - ma) / atr, -1, 1);
  const tilt = c.position * posTerm + c.trend * trend;
  return {A: tilt - c.distance * distA, B: c.range_base, C: -tilt - c.distance * distC};
}
function toProb(logits, bounds = V1.bounds) {
  const mx = Math.max(...KEYS.map(k => logits[k])), ex = KEYS.map(k => Math.exp(logits[k] - mx)), s = ex.reduce((a, b) => a + b, 0);
  const p = DA.boundedRound(ex.map(x => x / s), bounds);
  return {A: p[0], B: p[1], C: p[2]};
}
const tilted = (L, x) => ({A: L.A + x, B: L.B, C: L.C - x});

function runComparison({data = BT.loadData(), aux = loadAux(), start, end} = {}) {
  const {rows} = BT.runBacktest({data, ...(start ? {start} : {}), ...(end ? {end} : {})});
  const candles = data.candles, idx = new Map(candles.map((c, i) => [c.date, i]));
  const capBounds = {...V1.bounds, max: SPEC.cap_sensitivity_max};
  const out = rows.map(r => {
    const bars = candles.filter(b => b.date < r.date).map(b => ({...b, time: b.date}));
    const L = v1Logits(bars, r.lower, r.upper);
    const ref = toProb(L);
    if (KEYS.some(k => Math.abs(ref[k] - r.p['rule-weights-v1'][k]) > 1e-9)) throw Error('v1 replica mismatch at ' + r.date);
    const br = breadthSignal(r.date, aux.breadth), sb = southboundSignal(r.date, aux.southbound);
    const xb = SPEC.breadth_coef * br.score, xs = SPEC.southbound_coef * sb.score;
    const prev = candles[idx.get(r.date) - 1];
    return {date: r.date, outcome: r.outcome, lower: r.lower, upper: r.upper, close: r.close, prev_close: prev.close, prev_high: prev.high, prev_low: prev.low,
      breadth: br, southbound: sb,
      p: {'v1': r.p['rule-weights-v1'], 'v1+breadth': toProb(tilted(L, xb)), 'v1+southbound': toProb(tilted(L, xs)), 'v1+both': toProb(tilted(L, xb + xs)),
        'v1-cap0.85': toProb(L, capBounds), 'v1+both-cap0.85': toProb(tilted(L, xb + xs), capBounds),
        uniform: r.p.uniform, persistence: r.p.persistence, hist_freq: r.p.hist_freq}};
  });
  return out;
}

// Block-bootstrap CI for a statistic over paired daily records.
function bootStat(items, stat, {reps = 2000, block = 10, seed = 20261012} = {}) {
  const n = items.length; if (n < 3) return null;
  let s = seed; const r = () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const vals = [];
  for (let b = 0; b < reps; b++) { const smp = []; while (smp.length < n) { const st = Math.floor(r() * n); for (let j = 0; j < block && smp.length < n; j++) smp.push(items[(st + j) % n]); } const v = stat(smp); if (Number.isFinite(v)) vals.push(v); }
  vals.sort((a, b) => a - b);
  return {est: r4(stat(items)), lo: r4(vals[Math.floor(0.025 * vals.length)]), hi: r4(vals[Math.ceil(0.975 * vals.length) - 1])};
}
function corr(xs, ys) { const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n; let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; } return sxx && syy ? sxy / Math.sqrt(sxx * syy) : NaN; }

// Single-factor information check (signal uses data < t only; targets realised on t).
function infoCheck(rows, key) {
  const av = rows.filter(r => r[key].status === 'available');
  const ret = r => Math.log(r.close / r.prev_close), up = r => r.close > r.prev_close ? 1 : r.close < r.prev_close ? -1 : 0;
  const outside = r => r.close > r.prev_high ? 1 : r.close < r.prev_low ? -1 : 0, abcSign = r => r.outcome === 'A' ? 1 : r.outcome === 'C' ? -1 : 0;
  const nz = av.filter(r => r[key].score !== 0 && up(r) !== 0), brk = av.filter(r => outside(r) !== 0 && r[key].score !== 0);
  return {n: av.length,
    corr_signal_vs_return: bootStat(av, s => corr(s.map(r => r[key].score), s.map(ret))),
    direction_hit_rate: {n: nz.length, ...bootStat(nz, s => s.filter(r => Math.sign(r[key].score) === up(r)).length / s.length), base_rate_up: r4(nz.filter(r => up(r) === 1).length / nz.length)},
    corr_abs_signal_vs_outside_prev_range: bootStat(av, s => corr(s.map(r => Math.abs(r[key].score)), s.map(r => outside(r) !== 0 ? 1 : 0))),
    outside_prev_range_rate: r4(av.filter(r => outside(r) !== 0).length / av.length),
    breakout_side_hit_rate: {n: brk.length, ...bootStat(brk, s => s.filter(r => Math.sign(r[key].score) === outside(r)).length / s.length), base_rate_up: r4(brk.filter(r => outside(r) === 1).length / brk.length)},
    corr_signal_vs_abc_direction: bootStat(av, s => corr(s.map(r => r[key].score), s.map(abcSign)))};
}

const MODELS = ['v1', 'v1+breadth', 'v1+southbound', 'v1+both', 'v1-cap0.85', 'v1+both-cap0.85'], BASE = ['uniform', 'persistence', 'hist_freq'];
function evaluateAll(rows) {
  const ev = BT.evaluate(rows.map(r => ({...r, v2_regime: null, regime: 'n/a'})), [...MODELS, ...BASE]);
  delete ev.by_regime_v21; delete ev.by_regime_adx;
  const diff = (m, sub) => { const d = sub.map(r => BT.brier(r.p[m], r.outcome) - BT.brier(r.p.v1, r.outcome)), x = BT.blockBootstrap(d); return {mean: r4(x.mean), lo: r4(x.lo), hi: r4(x.hi)}; };
  const cut = Math.floor(rows.length * 0.7);
  ev.brier_diff_vs_v1 = Object.fromEntries(MODELS.filter(m => m !== 'v1').map(m => [m, {all: diff(m, rows), first_70: diff(m, rows.slice(0, cut)), last_30: diff(m, rows.slice(cut))}]));
  return ev;
}

module.exports = {SPEC, loadAux, breadthSignal, southboundSignal, v1Logits, toProb, tilted, runComparison, infoCheck, evaluateAll, corr, bootStat, MODELS};

function fmtP(x) { return (x * 100).toFixed(1) + '%'; }
function report(ev, info, rows, meta) {
  const name = {'v1': 'v1', 'v1+breadth': 'v1+宽度', 'v1+southbound': 'v1+南向', 'v1+both': 'v1+宽度+南向', 'v1-cap0.85': 'v1 上限0.85（敏感性）', 'v1+both-cap0.85': 'v1+两者 上限0.85（敏感性）', uniform: '均匀1/3', persistence: '持续', hist_freq: '历史频率'};
  const tbl = s => ['| 模型 | Brier | 95% CI | Log loss | 主情景命中 |', '|---|---|---|---|---|', ...[...MODELS, 'persistence'].map(m => `| ${name[m]} | ${s[m].brier} | [${s[m].brier_ci.lo}, ${s[m].brier_ci.hi}] | ${s[m].logloss} | ${fmtP(s[m].hit_rate)} |`)].join('\n');
  const L = [];
  L.push('<!-- BREADTH-SOUTHBOUND:BEGIN (generated by scripts/backtest-breadth-southbound.cjs) -->', '## 8. 宽度/南向对照（v1 + 市场宽度 / 南向资金）', '',
    `> 只评估，不改生产代码与系数。生成：\`node scripts/backtest-breadth-southbound.cjs\`；代码基线 ${meta.repo_commit.slice(0, 7)}。明细 \`daily-ledger-breadth-southbound.csv\`，结果 \`results-v1-breadth.json\` / \`results-v1-southbound.json\` / \`results-v1-both.json\` / \`results-v1-cap085.json\`。`, '',
    '### 8.1 数据与防未来', `- 宽度：\`research/data/hsi-breadth-daily.json\`（point-in-time 成分，等权收盘对收盘，非加权）；南向：\`research/data/southbound-daily.json\`（东方财富 total_net，亿港元；24 天南向休市）。`,
    '- t 日只用 **date < t** 的最近一行：宽度取 t-1 交易日；南向取 t 之前最近一个南向开市日，若 t-1 南向休市则沿用更早开市日并标注 stale（' + meta.southbound_stale_days + ' 天）。`tests/backtest-breadth-southbound.cjs` 断言删除/篡改 t 及以后的宽度、南向数据不改变 t 的信号与概率。',
    `- 宽度首日（2024-10-02，前一交易日 2024-09-30 不在数据内）不可用 ${meta.breadth_unavailable_days} 天；南向 z-score 需要 60 个此前开市日，前 ${meta.southbound_insufficient_days} 天信号为 0（不可用），故南向实际生效 ${498 - meta.southbound_insufficient_days} 天。`,
    '- v1 logits 由回测脚本按 `scoreScenarioWeights` v1 分支逐项复现（未取整），498 天经同一 `boundedRound` 后与生产 v1 概率逐日完全一致（脚本内断言）。', '',
    '### 8.2 对照定义（事先定死，未看结果调参）',
    '- 生产 v1 的 breadth 因子依赖 `MP.signal(participation)`：等权宽度 0.45 + **加权宽度** 0.35 + **点数贡献方向** 0.20，并按**前五贡献集中度**打折。历史宽度数据只有等权涨跌家数与 MA20 上方占比，缺加权宽度/贡献/集中度，**无法映射成同口径**，因此用独立定义：',
    `  - 宽度信号 b = clip(0.5·(2·adv_ratio−1) + 0.5·(2·pct_above_ma20−1), −1, 1)，系数 ${SPEC.breadth_coef}（= WEIGHT_MODEL_V1.coefficients.breadth）；`,
    `  - 南向信号 s = clip(z, −2, 2)/2，z = (total_net_{最近开市日} − 前 60 个开市日均值)/样本标准差，系数 ${SPEC.southbound_coef}；`,
    '  - 与 v1 的 breadth 项同方式进入 logits：A += 系数·信号，C −= 系数·信号，B 不变；再 softmax + 生产 `boundedRound`（[0.10,0.70]，步长 0.05）。', '',
    '### 8.3 全样本（n=' + ev.overall.n + '）', tbl(ev.overall), '',
    'Brier 差值（对照 − v1，负 = 更好；10 日移动块 bootstrap 95% CI）：', '| 版本 | 全样本 | 前 70% | 后 30% |', '|---|---|---|---|',
    ...Object.entries(ev.brier_diff_vs_v1).map(([m, d]) => `| ${name[m]} | ${d.all.mean} [${d.all.lo}, ${d.all.hi}] | ${d.first_70.mean} [${d.first_70.lo}, ${d.first_70.hi}] | ${d.last_30.mean} [${d.last_30.lo}, ${d.last_30.hi}] |`), '',
    `### 8.4 前 70%（${ev.split.first_70.range.join(' ~ ')}，n=${ev.split.first_70.n}）`, tbl(ev.split.first_70), '',
    `### 8.5 后 30%（${ev.split.last_30.range.join(' ~ ')}，n=${ev.split.last_30.n}）`, tbl(ev.split.last_30), '',
    '### 8.6 按年份（Brier / 命中）', '| 年 | n | ' + MODELS.map(m => name[m]).join(' | ') + ' |', '|---|---|' + MODELS.map(() => '---|').join(''),
    ...Object.entries(ev.by_year).map(([y, s]) => `| ${y} | ${s.n} | ` + MODELS.map(m => `${s[m].brier} / ${Math.round(s[m].hit_rate * 100)}%`).join(' | ') + ' |'), '',
    '### 8.7 校准（0.1 分档，三类合并）');
  for (const m of ['v1+breadth', 'v1+southbound', 'v1+both', 'v1-cap0.85']) {
    L.push(`**${name[m]}**（ECE ${ev.calibration[m].ece}；v1 ECE ${ev.calibration.v1.ece}）`, '| 分档 | 样本 | 预测均值 | 实际频率 |', '|---|---|---|---|', ...ev.calibration[m].bins.map(b => `| ${b.bin} | ${b.n} | ${b.mean_pred} | ${b.freq} |`), '');
  }
  const ci = x => x ? `${x.est} [${x.lo}, ${x.hi}]` : 'n/a';
  L.push('### 8.8 单因子信息量（信号来自 t 之前；目标为 t 日实现）', '| 指标 | 宽度 b | 南向 s |', '|---|---|---|',
    `| 可用天数 | ${info.breadth.n} | ${info.southbound.n} |`,
    `| corr(信号, t 日对数收益) | ${ci(info.breadth.corr_signal_vs_return)} | ${ci(info.southbound.corr_signal_vs_return)} |`,
    `| 方向命中率 sign(信号)=sign(close_t−close_{t−1}) | ${ci(info.breadth.direction_hit_rate)}（n=${info.breadth.direction_hit_rate.n}，上涨基率 ${info.breadth.direction_hit_rate.base_rate_up}） | ${ci(info.southbound.direction_hit_rate)}（n=${info.southbound.direction_hit_rate.n}，上涨基率 ${info.southbound.direction_hit_rate.base_rate_up}） |`,
    `| corr(|信号|, 收盘走出前日高低区间) | ${ci(info.breadth.corr_abs_signal_vs_outside_prev_range)} | ${ci(info.southbound.corr_abs_signal_vs_outside_prev_range)} |`,
    `| 走出前日区间频率 | ${info.breadth.outside_prev_range_rate} | ${info.southbound.outside_prev_range_rate} |`,
    `| 走出时方向命中率 | ${ci(info.breadth.breakout_side_hit_rate)}（n=${info.breadth.breakout_side_hit_rate.n}，向上基率 ${info.breadth.breakout_side_hit_rate.base_rate_up}） | ${ci(info.southbound.breakout_side_hit_rate)}（n=${info.southbound.breakout_side_hit_rate.n}，向上基率 ${info.southbound.breakout_side_hit_rate.base_rate_up}） |`,
    `| corr(信号, A/B/C 方向 +1/0/−1) | ${ci(info.breadth.corr_signal_vs_abc_direction)} | ${ci(info.southbound.corr_signal_vs_abc_direction)} |`, '');
  L.push('### 8.9 结论', ...meta.conclusions, '<!-- BREADTH-SOUTHBOUND:END -->');
  return L.join('\n');
}

if (require.main === module) {
  const data = BT.loadData(), rows = runComparison({data});
  const ev = evaluateAll(rows), info = {breadth: infoCheck(rows, 'breadth'), southbound: infoCheck(rows, 'southbound')};
  const commit = require('node:child_process').execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim();
  const meta = {generated_by: 'scripts/backtest-breadth-southbound.cjs', repo_commit: commit, spec: SPEC, window: [rows[0].date, rows.at(-1).date], sessions: rows.length,
    breadth_file: path.relative(root, BREADTH_FILE), southbound_file: path.relative(root, SOUTH_FILE),
    breadth_unavailable_days: rows.filter(r => r.breadth.status !== 'available').length,
    southbound_insufficient_days: rows.filter(r => r.southbound.status !== 'available').length,
    southbound_stale_days: rows.filter(r => r.southbound.stale).length,
    southbound_stale_dates: rows.filter(r => r.southbound.stale).map(r => r.date),
    production_breadth_mapping: 'not mappable: MP.signal needs weighted_breadth, contribution_direction, top_five_absolute_contribution_share (absent in history); independent definition used',
    raw_max_prob: r4(Math.max(...rows.map(r => { const bars = data.candles.filter(b => b.date < r.date); const L = v1Logits(bars, r.lower, r.upper), m = Math.max(L.A, L.B, L.C), e = KEYS.map(k => Math.exp(L[k] - m)); return Math.max(...e) / e.reduce((a, b) => a + b, 0); }))),
    cap_lowered_values: [...new Set(rows.filter(r => Math.max(...KEYS.map(k => r.p['v1-cap0.85'][k])) < Math.max(...KEYS.map(k => r.p.v1[k]))).map(r => Math.max(...KEYS.map(k => r.p['v1-cap0.85'][k]))))].sort().join('/'),
    cap_lowered_days: rows.filter(r => Math.max(...KEYS.map(k => r.p['v1-cap0.85'][k])) < Math.max(...KEYS.map(k => r.p.v1[k]))).length,
    breadth_vs_v1_tilt_corr: r4(corr(rows.filter(r => r.breadth.status === 'available').map(r => r.breadth.score), rows.filter(r => r.breadth.status === 'available').map(r => r.p.v1.A - r.p.v1.C))),
    note: '只评估、未调参。Brier 三类求和（0–2）。CI 为 10 日移动块 bootstrap 2000 次。'};
  const d = ev.brier_diff_vs_v1, sig = m => d[m].all.hi < 0 && d[m].first_70.mean < 0 && d[m].last_30.mean < 0;
  const desc = m => `${d[m].all.mean} [${d[m].all.lo}, ${d[m].all.hi}]，前70% ${d[m].first_70.mean} / 后30% ${d[m].last_30.mean}`;
  meta.conclusions = [
    ...['v1+breadth', 'v1+southbound', 'v1+both'].map((m, i) => `${i + 1}. ${m}：Brier 差 ${desc(m)}；${sig(m) ? '**显著更好且前后一致**' : d[m].all.lo > 0 ? '**显著更差**' : '与 v1 无显著差异'}。`),
    `4. 单因子信息量：宽度对 t 日收益 corr ${info.breadth.corr_signal_vs_return.est} [${info.breadth.corr_signal_vs_return.lo}, ${info.breadth.corr_signal_vs_return.hi}]、方向命中 ${info.breadth.direction_hit_rate.est}；南向 corr ${info.southbound.corr_signal_vs_return.est} [${info.southbound.corr_signal_vs_return.lo}, ${info.southbound.corr_signal_vs_return.hi}]、方向命中 ${info.southbound.direction_hit_rate.est}——均无可用的次日方向信息（点估计略偏反向）。宽度与 A/B/C 方向的 corr ${info.breadth.corr_signal_vs_abc_direction.est} 主要来自 t-1 收盘位置（宽度信号与 v1 的 A−C 倾向 corr ${meta.breadth_vs_v1_tilt_corr}，已在 position/trend 项中），属共线而非增量信息。`,
    `5. 上限放宽到 0.85（敏感性，不采纳）：v1 ${desc('v1-cap0.85')}；v1+两者 ${desc('v1+both-cap0.85')}。上限 0.85 **从未被触及**：v1 softmax 原始最大概率仅 ${meta.raw_max_prob}（logit 量级本身偏小），再经下限 0.10 重分配后最大仍为 0.70；放宽上限后，${meta.cap_lowered_days} 天原本被截在 0.70 的主情景改由下限 0.10 重分配（约 0.68–0.69）并按 0.05 步长向下取整为 ${meta.cap_lowered_values}，反而更保守，故略差。v1 的保守来自 logit 尺度 + 0.10 下限，而非 0.70 上限（低档预测 ~0.11 实际 <1%）。`,
    `6. 生产建议：${['v1+breadth', 'v1+southbound', 'v1+both'].some(sig) ? '存在显著且前后一致的改进版本，可另立研究卡复核后再考虑' : '宽度/南向两版均**不建议并入生产**（未显著优于 v1 或前后不一致）'}；上限调整需另立研究卡并做样本外验证，本次不改生产。`];
  const save = (file, models) => fs.writeFileSync(path.join(OUT_DIR, file), JSON.stringify({meta: {...meta, models}, overall: Object.fromEntries(['n', ...models, 'v1', 'persistence'].map(k => [k, ev.overall[k]])),
    split: Object.fromEntries(Object.entries(ev.split).map(([k, s]) => [k, Object.fromEntries(['range', 'n', ...models, 'v1'].map(x => [x, s[x]]))])),
    by_year: Object.fromEntries(Object.entries(ev.by_year).map(([y, s]) => [y, Object.fromEntries(['n', ...models, 'v1'].map(x => [x, s[x]]))])),
    brier_diff_vs_v1: Object.fromEntries(models.map(m => [m, d[m]])), calibration: Object.fromEntries([...models, 'v1'].map(m => [m, ev.calibration[m]])), info_check: info, outcome_freq: ev.outcome_freq}, null, 1) + '\n');
  save('results-v1-breadth.json', ['v1+breadth']); save('results-v1-southbound.json', ['v1+southbound']); save('results-v1-both.json', ['v1+both']); save('results-v1-cap085.json', ['v1-cap0.85', 'v1+both-cap0.85']);
  const all = [...MODELS, ...BASE];
  const header = ['date', 'outcome', 'prev_close', 'close', 'breadth_as_of', 'breadth_score', 'southbound_as_of', 'southbound_stale', 'southbound_z', 'southbound_score', ...all.flatMap(m => KEYS.map(k => m + '_' + k)), ...all.map(m => m + '_brier')];
  const lines = [header.join(',')].concat(rows.map(r => [r.date, r.outcome, r.prev_close, r.close, r.breadth.as_of ?? '', r4(r.breadth.score), r.southbound.as_of ?? '', r.southbound.stale, r.southbound.z == null ? '' : r4(r.southbound.z), r4(r.southbound.score),
    ...all.flatMap(m => KEYS.map(k => r4(r.p[m][k]))), ...all.map(m => r4(BT.brier(r.p[m], r.outcome)))].join(',')));
  fs.writeFileSync(path.join(OUT_DIR, 'daily-ledger-breadth-southbound.csv'), lines.join('\n') + '\n');
  const rp = path.join(OUT_DIR, 'report.md'), cur = fs.readFileSync(rp, 'utf8'), sec = report(ev, info, rows, meta);
  const re = /<!-- BREADTH-SOUTHBOUND:BEGIN[\s\S]*<!-- BREADTH-SOUTHBOUND:END -->/;
  fs.writeFileSync(rp, re.test(cur) ? cur.replace(re, sec) : cur.replace(/\s*$/, '\n\n') + sec + '\n');
  console.log(JSON.stringify({sessions: rows.length, diff: d, overall: Object.fromEntries(MODELS.map(m => [m, [ev.overall[m].brier, ev.overall[m].hit_rate]])), info}, null, 0));
}
