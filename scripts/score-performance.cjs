// Forward-only scorecard. Frozen forecasts/logs are inputs and are never rewritten.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const MR = require('../investment/chart/market-rules.js');
const IDS = ['A', 'B', 'C'];
const POLICY = 'forward-scorecard-v1';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const round = n => Number(n.toFixed(6));
const mean = xs => xs.length ? round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
const closeAt = date => MR.timestamp(date + (MR.closeMinute(date) === 730 ? 'T12:10:00+08:00' : 'T16:10:00+08:00'));
function datesBetween(start, end) {
  const out = [];
  for (let d = start; d <= end; d = new Date(Date.parse(d + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10)) {
    if (MR.tradingDay(d) === null) throw Error('Unsupported calendar: ' + d);
    if (MR.tradingDay(d)) out.push(d);
  }
  return out;
}
function completedBar(feed, date, now) {
  const sourceTime = MR.timestamp(feed?.updated_at);
  if (!feed?.source || !Number.isFinite(sourceTime) || sourceTime > now + 60000 || sourceTime < closeAt(date) || now < closeAt(date)) return null;
  const bars = (feed.candles || []).filter(b => b.date === date);
  if (bars.length !== 1 || MR.tradingDay(date) !== true) return null;
  const b = bars[0];
  if (b.partial || b.final === false || ![b.open, b.high, b.low, b.close].every(Number.isFinite) ||
      b.low <= 0 || b.low > Math.min(b.open, b.close) || b.high < Math.max(b.open, b.close)) return null;
  return b;
}
function validProbabilities(p) {
  return p && IDS.every(id => Number.isFinite(p[id]) && p[id] >= 0 && p[id] <= 1) &&
    Math.abs(IDS.reduce((sum, id) => sum + p[id], 0) - 1) < 1e-9;
}
function score(p, actual) {
  if (!validProbabilities(p) || !IDS.includes(actual)) throw Error('Invalid probability/outcome');
  const maximum = Math.max(...IDS.map(id => p[id]));
  const top = IDS.filter(id => Math.abs(p[id] - maximum) < 1e-12);
  return {brier: round(IDS.reduce((sum, id) => sum + (p[id] - Number(id === actual)) ** 2, 0)),
    top, top_hit_credit: top.includes(actual) ? 1 / top.length : 0};
}
const oneHot = id => Object.fromEntries(IDS.map(k => [k, Number(k === id)]));
function forecastIssue(item, date) {
  const a = item.data, pub = a?.publication, f = a?.forecast, proof = item.proof;
  if (pub?.kind !== 'daily_rule_analysis' || pub.eligible_as_new_prediction !== true) return '非正式盘前预测';
  if (pub.session_date !== date || f?.applicable_date !== date || !a.meta?.analysis_id) return '预测日期或身份不一致';
  const generated = MR.timestamp(pub.generated_at), cutoff = MR.timestamp(pub.information_cutoff);
  const open = MR.timestamp(date + 'T09:30:00+08:00');
  if (![generated, cutoff].every(Number.isFinite) || MR.hk(generated).date !== date || cutoff > generated || generated >= open) return '生成时间不符合盘前截止';
  if (!proof?.commit || !Number.isFinite(MR.timestamp(proof.committed_at)) || proof.sha256 !== item.sha256 ||
      MR.timestamp(proof.committed_at) + 999 < generated || MR.timestamp(proof.committed_at) >= open) return '缺少开盘前原始提交证据，或冻结文件已变更';
  const expected = MR.latestDay(open - 1, true);
  if (pub.baseline_date !== expected || a.meta.latestCloseDate !== expected || !Number.isFinite(a.meta.latestClose) || a.meta.latestClose <= 0) return '盘前基准收盘无效';
  const s = f.scenarios;
  if (!Array.isArray(s) || s.length !== 3 || new Set(s.map(x => x.id)).size !== 3 || IDS.some(id => !s.find(x => x.id === id))) return 'A/B/C 不完整';
  const rules = Object.fromEntries(s.map(x => [x.id, x.price_rule]));
  const b = rules.B;
  if (b?.operator !== 'range' || !Number.isFinite(b.lower) || !Number.isFinite(b.upper) || b.lower >= b.upper ||
      rules.A?.operator !== 'gte' || rules.A.value !== b.upper || rules.C?.operator !== 'lt' || rules.C.value !== b.lower) return '价格分区不互斥或未完整覆盖';
  if (!validProbabilities(Object.fromEntries(s.map(x => [x.id, x.probability])))) return '权重缺失或合计不为 100%';
  return null;
}
function summarize(rows, pick) {
  const values = rows.map(pick).filter(Boolean);
  return {n: values.length, hit_credit: round(values.reduce((sum, x) => sum + x.top_hit_credit, 0)),
    hit_rate: mean(values.map(x => x.top_hit_credit)), mean_brier: mean(values.map(x => x.brier))};
}
function reviewIssue(review, row, bar) {
  if (!review) return 'missing';
  if (review.analysis_id !== row.analysis_id || review.session_date !== row.date || review.weight_model !== row.model ||
      IDS.some(id => review.probabilities?.[id] !== row.probabilities[id]) ||
      ['open', 'high', 'low', 'close'].some(k => review.bar?.[k] !== bar[k]) ||
      !Array.isArray(review.verdicts) || review.verdicts.length !== 3 ||
      IDS.some(id => review.verdicts.filter(v => v.id === id && v.met === (id === row.actual)).length !== 1) ||
      !Number.isFinite(review.brier) || Math.abs(review.brier - row.result.brier) > 0.000051) return 'mismatch';
  return 'verified';
}
function legacyAudit(p, feed, now) {
  // Older prose scenarios are not relabelled into the new A/B/C partition.
  // Honor the explicitly frozen end date; expose calendar conflicts instead of selecting the better outcome.
  const end = p.horizonEndDate, calendar = MR.auditHorizon(p);
  const row = {id: p.id, created_at: p.createdAt, original_status: p.status, original_outcome: p.outcome,
    declared_end: end, calendar_end: calendar.expected?.end || null, calendar_status: calendar.status,
    main_scenarios: [], status: 'unverifiable', direction_hit: null, main_scenario_hit: null,
    net_pnl: null, reason: '旧情景含文字条件，不纳入每日 A/B/C 命中率；行情涨跌幅不是交易收益。'};
  const probs = (p.scenarios || []).filter(s => Number.isFinite(s.probability));
  const max = Math.max(...probs.map(s => s.probability));
  row.main_scenarios = probs.filter(s => s.probability === max).map(s => s.name);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end || '') || MR.tradingDay(end) !== true) return row;
  if (now < closeAt(end)) { row.status = 'pending'; return row; }
  row.status = 'expired_missing_data';
  const bar = completedBar(feed, end, now);
  if (!bar || !Number.isFinite(p.basePrice) || p.basePrice <= 0) return row;
  row.status = 'expired_audited';
  row.close = bar.close;
  row.market_change_pct = round((bar.close / p.basePrice - 1) * 100);
  if (p.bias === 'bullish' || p.bias === 'bearish') {
    row.direction_hit = p.bias === 'bullish' ? bar.close > p.basePrice : bar.close < p.basePrice;
  }
  // Only complete sessions after publication; never include the already-seen publication-day bar.
  const created = MR.timestamp(p.createdAt), start = Number.isFinite(created) ? MR.hk(created).date : null;
  const days = start && start <= end ? datesBetween(start, end).filter(d => MR.timestamp(d + 'T09:30:00+08:00') > created) : [];
  const bars = days.map(d => completedBar(feed, d, now));
  row.path_complete = days.length > 0 && bars.every(Boolean);
  row.reference_levels = {target: p.rr?.target ?? null, invalidation: p.rr?.stop ?? null,
    target_touched: null, invalidation_touched: null, meaning: '全窗口价格触及，仅为观察；不推定入场、止损成交或先后顺序'};
  if (row.path_complete) {
    const touched = price => Number.isFinite(price) ? bars.some(b => b.low <= price && b.high >= price) : null;
    row.reference_levels.target_touched = touched(p.rr?.target);
    row.reference_levels.invalidation_touched = touched(p.rr?.stop);
  }
  return row;
}
function tradeAudit(trades) {
  // A closed trade needs its own fills, multiplier, fees and attribution.
  // The legacy `pnlPct` field can be an index return, so never aggregate it as a trading return.
  return {recorded: trades.length, open: trades.filter(t => t.status === 'open').length,
    closed: trades.filter(t => t.status === 'closed').length, verified_net_pnl: null,
    status: 'unverified', reason: '尚无统一核验的开平仓成交、产品乘数、费用及预测关联；不以指数涨跌或 MFE/MAE 代替净收益。'};
}
function buildPerformance({forecasts, reviews = {}, feed, legacy = [], trades = [], now = Date.now()}) {
  const completed = MR.latestDay(now, true);
  if (!completed) throw Error('Cannot determine completed session');
  const byDate = new Map();
  for (const item of forecasts) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(item.date) || byDate.has(item.date)) throw Error('Invalid/duplicate forecast date');
    byDate.set(item.date, item);
  }
  const first = [...byDate.keys()].sort()[0] || null;
  const dates = first && first <= completed ? datesBetween(first, completed) : [];
  const rows = dates.map(date => {
    const item = byDate.get(date);
    if (!item) return {date, status: 'missing_forecast', reason: '当日未发布正式预测；不补造，不计为命中。'};
    const issue = forecastIssue(item, date), a = item.data;
    const row = {date, analysis_id: a.meta?.analysis_id || null, forecast_file: item.file,
      forecast_sha256: item.sha256, publication_proof: item.proof, model: a.forecast?.weight_model || null,
      fallback: a.forecast?.weight_model_info?.fallback || null};
    if (issue) return {...row, status: 'excluded', reason: issue};
    row.probabilities = Object.fromEntries(a.forecast.scenarios.map(s => [s.id, s.probability]));
    row.rules = Object.fromEntries(a.forecast.scenarios.map(s => [s.id, s.price_rule]));
    const bar = completedBar(feed, date, now);
    if (!bar) return {...row, status: 'missing_market_data', reason: '缺少完整、唯一且已收盘的行情'};
    const classify = value => IDS.find(id => MR.priceCondition(row.rules[id], value));
    row.status = 'scored';
    row.close = bar.close;
    row.actual = classify(bar.close);
    row.result = score(row.probabilities, row.actual);
    row.baselines = {
      always_b: score(oneHot('B'), row.actual),
      previous_close_zone: score(oneHot(classify(a.meta.latestClose)), row.actual),
      uniform: score({A: 1 / 3, B: 1 / 3, C: 1 / 3}, row.actual)
    };
    row.review_status = reviewIssue(reviews[date], row, bar);
    row.price_observations = a.forecast.scenarios.map(s => ({id: s.id,
      target: s.rr?.target ?? null,
      target_touched_same_session: Number.isFinite(s.rr?.target) ? bar.low <= s.rr.target && bar.high >= s.rr.target : null,
      close_condition_met: s.id === row.actual}));
    row.trade_result = 'unverified';
    return row;
  });
  const scored = rows.filter(r => r.status === 'scored');
  return {schema_version: 1, policy: POLICY, generated_at: new Date(now).toISOString(),
    through_session: completed, market_data_updated_at: feed.updated_at,
    notes: {outcome: '仅核算发布当日收盘落点：A 上边界及以上，B 区间内，C 下边界以下；不代表当日涨跌方向或逐日曲线。',
      baselines: '同一批样本；固定 B 和前收盘所在区均为 100% 单类基准，均分基准为各 1/3。并列最高按 1/并列数计命中分。',
      interpretation: '展示全部可核验样本及分母，小样本仅描述事实，不据此宣称稳定优势。',
      observation: '价格触及与收盘条件分开记录，不推定交易触发或成交；未验证收益保持空值。'},
    coverage: {start: first, expected: rows.length, scored: scored.length,
      missing_forecasts: rows.filter(r => r.status === 'missing_forecast').map(r => r.date),
      excluded: rows.filter(r => r.status === 'excluded').map(r => r.date),
      missing_market_data: rows.filter(r => r.status === 'missing_market_data').map(r => r.date),
      review_issues: scored.filter(r => r.review_status !== 'verified').map(r => ({date: r.date, status: r.review_status}))},
    summary: {model: summarize(scored, r => r.result),
      baselines: Object.fromEntries(['always_b', 'previous_close_zone', 'uniform'].map(k => [k, summarize(scored, r => r.baselines[k])])),
      by_version: Object.fromEntries([...new Set(scored.map(r => r.model))].map(version => [version, summarize(scored.filter(r => r.model === version), r => r.result)]))},
    sessions: rows, legacy: legacy.map(p => legacyAudit(p, feed, now)), trades: tradeAudit(trades)};
}
function publicationProof(root, file) {
  try {
    const history = execFileSync('git', ['log', '--reverse', '--diff-filter=A', '--format=%H %cI', '--', file], {cwd: root, encoding: 'utf8'}).trim();
    const [commit, committed_at] = history.split('\n')[0].split(' ');
    if (!/^[0-9a-f]{40}$/.test(commit)) return null;
    const original = execFileSync('git', ['show', commit + ':' + file], {cwd: root});
    return {commit, committed_at, sha256: hash(original)};
  } catch { return null; }
}
function run({projectRoot = path.join(__dirname, '..'), now = Date.now()} = {}) {
  const dir = path.join(projectRoot, 'investment/chart');
  const read = file => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  const forecasts = fs.readdirSync(path.join(dir, 'daily-generated')).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().map(f => {
    const file = 'investment/chart/daily-generated/' + f;
    const body = fs.readFileSync(path.join(projectRoot, file));
    return {date: f.slice(0, 10), file, data: JSON.parse(body), sha256: hash(body), proof: publicationProof(projectRoot, file)};
  });
  const reviews = {};
  for (const f of fs.readdirSync(path.join(dir, 'daily-reviews')).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))) reviews[f.slice(0, 10)] = read('daily-reviews/' + f);
  const data = buildPerformance({forecasts, reviews, feed: read('kline_futu.json'), legacy: read('predictions/log.json').predictions,
    trades: read('trades.json').trades, now});
  data.input_sha256 = Object.fromEntries(['kline_futu.json', 'predictions/log.json', 'trades.json'].map(file =>
    [file, hash(fs.readFileSync(path.join(dir, file)))]));
  fs.writeFileSync(path.join(dir, 'predictions/performance.json'), JSON.stringify(data, null, 2) + '\n');
  console.log(JSON.stringify({through: data.through_session, scored: data.coverage.scored, missing: data.coverage.missing_forecasts,
    legacy_audited: data.legacy.filter(r => r.status === 'expired_audited').length}));
  return data;
}
module.exports = {buildPerformance, completedBar, forecastIssue, legacyAudit, score, run};
if (require.main === module) run();
