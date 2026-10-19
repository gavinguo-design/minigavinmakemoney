// Random-walk reference + Pardo strategy stop line for the production probability model (round1 B1).
// Research basis: data/books gap-list-fpp P0-1 (RW baseline) and gap-list-pardo PD-P0-3 (策略停用线).
//
// * rwGauss(): zero-parameter random walk. sigma = sd (ddof=1) of the last 60 daily log returns ending at the
//   baseline close c0 (completed bars strictly before the session). P(A)=1-Phi(ln(upper/c0)/sigma),
//   P(C)=Phi(ln(lower/c0)/sigma), P(B)=rest. Published through the production boundedRound [0.10,0.85]/0.05.
//   Identical to scripts/backtest-weights.cjs rwBaselines().rw_gauss and scripts/v4-walkforward.py rw_baselines().
// * evaluateGuard(): skill_t = Brier_RW,t − Brier_v4,t on scored sessions strictly before the session (both
//   probabilities frozen at publication; v4 is kept as a shadow when RW is active, so the guard never goes blind).
//   RED (停用 v4, publish RW): rolling-60 mean skill < WF p1 for >= 10 consecutive scored sessions, OR the cumulative
//   skill drawdown from its peak > 2 x WF skill MDD (Pardo Ch14 P306, DSF=2).
//   Resume v4 only after rolling-60 >= WF median for 10 consecutive sessions (hysteresis; Pardo gives no resume rule).
//   While RW is active the drawdown peak is re-anchored to the running trough, so resumption depends on recovered skill.
//   YELLOW (label only): rolling-60 < WF p5. Pardo P317's 50%/150%-of-mean band is NOT used: v4's mean skill vs RW
//   (0.009) is small relative to 60-day noise, so that band flags 79% of walk-forward days (measured) — no information.
//   WF reference numbers = v4 frozen predictions vs RW-gauss, 2016–2025 walk-forward, n=2434 (research/v4/rw-baseline.json).
'use strict';
const KEYS = ['A', 'B', 'C'];
const RW_VERSION = 'rw-gauss-v1';
const GUARD = Object.freeze({
  window: 60, red_consecutive: 10, resume_consecutive: 10, dd_multiple: 2,
  wf: Object.freeze({n: 2434, mean: 0.009045, mdd: 6.6, roll60_p1: -0.041167, roll60_p5: -0.026917, roll60_p50: 0.0075, source: 'v4 frozen walk-forward vs rw_gauss 2016–2025 (research/v4/rw-guard-seed.json stats)'}),
});
function normCdf(x) { const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989422804014327 * Math.exp(-x * x / 2), p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429)))); return x >= 0 ? 1 - p : p; }
function rwGauss({bars, lower, upper, round, bounds = {min: 0.10, max: 0.85, step: 0.05}, win = 60}) {
  if (!Array.isArray(bars) || bars.length < win + 1 || !(lower < upper)) throw Error('Insufficient history for RW');
  const c = bars.slice(-(win + 1)).map(b => b.close);
  if (!c.every(v => Number.isFinite(v) && v > 0)) throw Error('Invalid closes for RW');
  const r = []; for (let i = 1; i < c.length; i++) r.push(Math.log(c[i] / c[i - 1]));
  const m = r.reduce((a, b) => a + b, 0) / r.length, sd = Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1));
  if (!(sd > 0)) throw Error('Zero volatility for RW');
  const c0 = c.at(-1), a = 1 - normCdf(Math.log(upper / c0) / sd), cc = normCdf(Math.log(lower / c0) / sd), raw = [a, Math.max(0, 1 - a - cc), cc];
  const p = round ? round(raw, bounds) : raw;
  return {version: RW_VERSION, probabilities: {A: p[0], B: p[1], C: p[2]}, raw, sigma60: sd, base_close: c0};
}
const brier = (p, o) => KEYS.reduce((s, k) => s + (p[k] - (o === k ? 1 : 0)) ** 2, 0);
// history: [{date, outcome:'A'|'B'|'C', v4:{A,B,C}, rw:{A,B,C}, source}] — any order; only dates < session are used.
function evaluateGuard(history, session, cfg = GUARD) {
  const rows = (history || []).filter(r => r && r.date < session && KEYS.includes(r.outcome) && r.v4 && r.rw && KEYS.every(k => Number.isFinite(r.v4[k]) && Number.isFinite(r.rw[k])))
    .sort((a, b) => a.date.localeCompare(b.date));
  const dedup = []; for (const r of rows) { if (dedup.length && dedup.at(-1).date === r.date) dedup[dedup.length - 1] = r; else dedup.push(r); }
  const skill = dedup.map(r => brier(r.rw, r.outcome) - brier(r.v4, r.outcome));
  const base = {window: cfg.window, n_scored: dedup.length, thresholds: {red_roll60: cfg.wf.roll60_p1, red_consecutive: cfg.red_consecutive, red_drawdown: cfg.dd_multiple * cfg.wf.mdd, resume_roll60: cfg.wf.roll60_p50, yellow_roll60: cfg.wf.roll60_p5}, wf_reference: cfg.wf,
    sources: [...new Set(dedup.map(r => r.source || 'unknown'))], first_date: dedup[0]?.date || null, last_date: dedup.at(-1)?.date || null};
  if (dedup.length < cfg.window) return {...base, status: 'warming_up', use: 'v4', roll60: null, drawdown: null, yellow: null, red_streak: 0,
    reason: '已打分样本 ' + dedup.length + ' < ' + cfg.window + '，停用线未启用；默认 v4'};
  // Replay the state machine over history so the state is a pure function of past outcomes (no hidden mutable state).
  let state = 'v4', redStreak = 0, okStreak = 0, cum = 0, peak = 0, dd = 0, roll = null, trippedOn = null, why = null;
  for (let i = 0; i < skill.length; i++) {
    cum += skill[i]; peak = Math.max(peak, cum); dd = peak - cum;
    if (i + 1 < cfg.window) continue;
    roll = skill.slice(i + 1 - cfg.window, i + 1).reduce((a, b) => a + b, 0) / cfg.window;
    redStreak = roll < cfg.wf.roll60_p1 ? redStreak + 1 : 0;
    okStreak = roll >= cfg.wf.roll60_p50 ? okStreak + 1 : 0;
    const ddRed = dd > cfg.dd_multiple * cfg.wf.mdd;
    if (state === 'v4' && (redStreak >= cfg.red_consecutive || ddRed)) { state = 'rw'; trippedOn = dedup[i].date; okStreak = 0; peak = cum; why = ddRed ? '技能权益回撤 ' + dd.toFixed(3) + ' > 2×WF MDD ' + (cfg.dd_multiple * cfg.wf.mdd).toFixed(2) : '60 日滚动技能连续 ' + redStreak + ' 个交易日低于 WF p1 ' + cfg.wf.roll60_p1; }
    else if (state === 'rw') { peak = Math.min(peak, cum); if (okStreak >= cfg.resume_consecutive) { state = 'v4'; trippedOn = null; why = null; peak = cum; } }
  }
  const yellow = roll < cfg.wf.roll60_p5 ? 'below' : null;
  return {...base, status: state === 'rw' ? 'red' : yellow ? 'yellow' : 'green', use: state, roll60: Math.round(roll * 1e5) / 1e5, drawdown: Math.round(dd * 1e4) / 1e4, cumulative_skill: Math.round(cum * 1e4) / 1e4,
    red_streak: redStreak, resume_streak: okStreak, yellow, tripped_on: trippedOn,
    reason: state === 'rw' ? '停用线触发（' + why + '）；改用随机游走概率，v4 继续影子记录' : yellow ? '黄线：60 日技能 ' + roll.toFixed(4) + ' 低于 WF p5 ' + cfg.wf.roll60_p5 + '（仅标注，不切换）' : '60 日技能在回测正常范围内'};
}
// Build guard history from the frozen research seed + live daily reviews (reviews carry v4/rw from the published card).
function guardHistory({seed = null, reviews = []} = {}) {
  const out = [];
  for (const r of seed?.rows || []) out.push({date: r.date, outcome: r.outcome, v4: r.v4, rw: r.rw, source: 'research_replay'});
  for (const v of reviews) {
    const met = (v.verdicts || []).filter(x => x.met === true);
    const p = v.model_probabilities || {}, v4 = p['rule-weights-v4'], rw = p[RW_VERSION];
    if (met.length === 1 && v4 && rw) out.push({date: v.session_date, outcome: met[0].id, v4, rw, source: 'live_review'});
  }
  // live reviews supersede research replay for the same date
  const by = new Map(); for (const r of out) if (!by.has(r.date) || r.source === 'live_review') by.set(r.date, r);
  return [...by.values()].sort((a, b) => a.date.localeCompare(b.date));
}
module.exports = {RW_VERSION, GUARD, normCdf, rwGauss, evaluateGuard, guardHistory, brier};
