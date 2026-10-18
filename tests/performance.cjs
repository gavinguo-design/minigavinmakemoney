const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {buildPerformance, completedBar, forecastIssue, legacyAudit, score} = require('../scripts/score-performance.cjs');
const date = '2026-10-12';
const now = Date.parse('2026-10-12T17:00:00+08:00');
const bar = {date, open: 105, high: 113, low: 98, close: 109};
const feed = {source: 'fixture', updated_at: '2026-10-12T16:30:00+08:00', candles: [bar]};
function fixture() {
  return {date, file: 'fixture.json', sha256: 'frozen', proof: {commit: 'a'.repeat(40), committed_at: '2026-10-12T08:45:00+08:00', sha256: 'frozen'}, data: {
    meta: {analysis_id: 'fixture', latestClose: 105, latestCloseDate: '2026-10-09'},
    publication: {kind: 'daily_rule_analysis', eligible_as_new_prediction: true, session_date: date,
      generated_at: '2026-10-12T08:45:00.500+08:00', information_cutoff: '2026-10-12T08:44:59+08:00', baseline_date: '2026-10-09'},
    forecast: {applicable_date: date, weight_model: 'test-v1', scenarios: [
      {id: 'A', probability: .2, price_rule: {operator: 'gte', value: 110}, rr: {target: 112}},
      {id: 'B', probability: .7, price_rule: {operator: 'range', lower: 100, upper: 110}, rr: {target: 90}},
      {id: 'C', probability: .1, price_rule: {operator: 'lt', value: 100}, rr: {target: 90}}
    ]}
  }};
}
const build = (forecasts = [fixture()], extra = {}) => buildPerformance({forecasts, feed, now, ...extra});
test('scores the preopen close partition and identical-sample baselines; never infers a trade', () => {
  const result = build(), r = result.sessions[0];
  assert.equal(r.actual, 'B'); assert.equal(r.result.brier, .14);
  assert.equal(result.summary.model.n, 1);
  for (const b of Object.values(result.summary.baselines)) assert.equal(b.n, 1);
  assert.equal(result.summary.baselines.always_b.mean_brier, 0);
  assert.equal(result.summary.baselines.uniform.mean_brier, .666667);
  assert.equal(r.price_observations[0].target_touched_same_session, true);
  assert.equal(r.price_observations[0].close_condition_met, false);
  assert.equal(r.trade_result, 'unverified'); assert.equal(result.trades.verified_net_pnl, null);
});
test('preserves exact inclusive/exclusive boundaries independent of intraday extremes', () => {
  for (const [close, expected] of [[110, 'A'], [100, 'B'], [99, 'C']]) {
    const r = build([fixture()], {feed: {...feed, candles: [{...bar, close}]}});
    assert.equal(r.sessions[0].actual, expected);
  }
});
test('missing session remains in coverage; holiday/weekend do not become missing forecasts', () => {
  const r = build([fixture()], {now: Date.parse('2026-10-19T17:00:00+08:00')});
  assert.equal(r.through_session, '2026-10-16'); assert.equal(r.coverage.expected, 5);
  assert.deepEqual(r.coverage.missing_forecasts, ['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']);
  assert.equal(r.summary.model.n, 1);
});
test('retrospective, carried forward, late, edited and unproven forecasts never count', () => {
  const mutations = [
    x => {x.data.publication.kind = 'retrospective_backfill';},
    x => {x.data.publication.eligible_as_new_prediction = false;},
    x => {x.data.publication.session_date = '2026-10-09';},
    x => {x.data.publication.generated_at = '2026-10-12T09:30:00+08:00';},
    x => {x.proof.committed_at = '2026-10-12T09:31:00+08:00';},
    x => {x.proof.sha256 = 'edited';},
    x => {x.proof = null;},
    x => {x.data.publication.information_cutoff = '2026-10-12T10:00:00+08:00';},
    x => {x.data.meta.latestCloseDate = '2026-10-08';}
  ];
  for (const mutate of mutations) {
    const x = fixture(); mutate(x);
    assert.ok(forecastIssue(x, date)); assert.equal(build([x]).summary.model.n, 0);
  }
  assert.equal(forecastIssue(fixture(), date), null, 'Git timestamps have whole-second precision');
});
test('overlapping, incomplete and malformed probabilities fail closed', () => {
  for (const mutate of [
    x => {x.data.forecast.scenarios[0].price_rule.value = 109;},
    x => {x.data.forecast.scenarios[0].probability = null;},
    x => {x.data.forecast.scenarios[0].probability = -.2;},
    x => {x.data.forecast.scenarios[0].probability = .3;},
    x => {x.data.forecast.scenarios[0].id = 'B';}
  ]) { const x = fixture(); mutate(x); assert.equal(build([x]).sessions[0].status, 'excluded'); }
});
test('ties use fractional credit instead of counting every top label as a full hit', () => {
  assert.equal(score({A: .5, B: .5, C: 0}, 'B').top_hit_credit, .5);
  assert.equal(score({A: .5, B: .5, C: 0}, 'C').top_hit_credit, 0);
  assert.throws(() => score({A: .5, B: .5, C: .5}, 'B'));
});
test('incomplete, duplicate, stale and future market data cannot manufacture outcomes', () => {
  for (const bad of [
    {...feed, candles: [{...bar, partial: true}]},
    {...feed, candles: [{...bar, final: false}]},
    {...feed, candles: [bar, bar]},
    {...feed, candles: [{...bar, low: 106}]},
    {...feed, updated_at: '2026-10-12T12:00:00+08:00'},
    {...feed, updated_at: '2026-10-13T16:30:00+08:00'}
  ]) { assert.equal(completedBar(bad, date, now), null); assert.equal(build([fixture()], {feed: bad}).summary.model.n, 0); }
});
test('a mismatched old review is exposed while score is independently recomputed', () => {
  const r = build([fixture()], {reviews: {[date]: {analysis_id: 'wrong', brier: 0}}});
  assert.equal(r.sessions[0].review_status, 'mismatch');
  assert.equal(r.summary.model.mean_brier, .14); assert.equal(r.coverage.review_issues.length, 1);
});
test('versions are separated, including actual fallback, without crediting the intended version', () => {
  const f = fixture(); f.data.forecast.weight_model_info = {fallback: {intended: 'v4', used: 'test-v1', reason: 'missing'}};
  const r = build([f]);
  assert.deepEqual(Object.keys(r.summary.by_version), ['test-v1']); assert.equal(r.sessions[0].fallback.intended, 'v4');
});
test('legacy expiry audits preserve frozen deadline, original review and neutral direction', () => {
  const p = {id: 'old', createdAt: '2026-10-09T08:45:00+08:00', horizonEndDate: date,
    horizon: '未来5个交易日', horizonDesc: '至 2026-10-12', basePrice: 105, bias: 'neutral', status: '进行中',
    scenarios: [{name: 'old A', probability: .7}], rr: {target: 112, stop: 99}};
  const before = JSON.stringify(p), r = legacyAudit(p, feed, now);
  assert.equal(r.status, 'expired_audited'); assert.equal(r.declared_end, date); assert.equal(r.calendar_end, '2026-10-16');
  assert.equal(r.direction_hit, null); assert.equal(r.net_pnl, null); assert.equal(r.main_scenario_hit, null);
  assert.equal(r.path_complete, false); assert.equal(r.reference_levels.target_touched, null);
  assert.equal(JSON.stringify(p), before);
});
test('legacy price observations exclude publication-day OHLC already seen after close', () => {
  const p = {id: 'old', createdAt: '2026-10-09T19:45:00+08:00', horizonEndDate: date, basePrice: 105, bias: 'bearish',
    rr: {target: 80, stop: 130}};
  const oldBar = {date: '2026-10-09', open: 105, high: 135, low: 75, close: 105};
  const r = legacyAudit(p, {...feed, candles: [oldBar, bar]}, now);
  assert.equal(r.path_complete, true); assert.equal(r.reference_levels.target_touched, false);
  assert.equal(r.reference_levels.invalidation_touched, false); assert.equal(r.direction_hit, false);
});
test('expiry and missing data are distinguished; no invented P&L from old outcome fields', () => {
  const p = {id: 'old', createdAt: '2026-10-09T08:45:00+08:00', horizonEndDate: date, basePrice: 105, outcome: {pnlPct: 99}};
  assert.equal(legacyAudit(p, feed, now - 86400000).status, 'pending');
  assert.equal(legacyAudit(p, {...feed, candles: []}, now).status, 'expired_missing_data');
  const r = build([], {trades: [{status: 'closed', pnlPct: 99, pnl: 9999}]});
  assert.equal(r.trades.closed, 1); assert.equal(r.trades.verified_net_pnl, null);
});
test('track inline JavaScript parses and no legacy MFE/MAE ratio is sold as realized R/R', () => {
  const source = fs.readFileSync(path.join(__dirname, '../investment/chart/track/index.html'), 'utf8');
  for (const m of source.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Function(m[1]);
  assert.doesNotMatch(source, /avgMfe\s*\/\s*avgMae/);
  assert.match(source, /performance\.json/); assert.match(source, /净收益未验证/);
});
