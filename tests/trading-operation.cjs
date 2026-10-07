const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const TradingOperation = require('../investment/chart/trading-operation.js');
const annotations = JSON.parse(fs.readFileSync(require('node:path').join(__dirname, '../investment/chart/annotations.json'), 'utf8'));
const status = JSON.parse(fs.readFileSync(require('node:path').join(__dirname, '../investment/chart/scenario_status.json'), 'utf8'));
const at = s => Date.parse(s + '+08:00');
const completeBar = { time: { year: 2026, month: 10, day: 6 }, open: 24279, high: 24354, low: 24179, close: 24280, partial: false };
const freshStatus = Object.assign({}, status, { updated_at: '2026-10-06T16:32:10+08:00', conditions_date: '2026-10-06', judgment_mode: 'close_final', data_stale: false, conditions_stale: false });
const input = extra => Object.assign({ annotations, scenarioStatus: freshStatus, dailyBars: [completeBar], quote: { price: 24280, ts: at('2026-10-06T16:11:00') / 1000 }, now: at('2026-10-06T16:33:00') }, extra || {});
const section = (contract, id) => contract.sections.find(s => s.id === id);

test('trading operation has exactly the frozen eight sections and machine-readable provenance', () => {
  const contract = TradingOperation.build(input());
  assert.equal(TradingOperation.validate(contract), true);
  assert.deepEqual(contract.sections.map(s => s.id), TradingOperation.SECTION_IDS);
  for (const item of contract.sections) {
    assert.ok(item.provenance.source);
    assert.ok(['available', 'stale', 'missing', 'unavailable'].includes(item.provenance.status));
    assert.ok(['observe_only', 'no_trade'].includes(item.action_state));
  }
});

test('complete close-final input keeps A/B/C and gap fallback coherent but fails closed without independent stop and sizing', () => {
  const contract = TradingOperation.build(input());
  const paths = section(contract, 'scenario_paths');
  assert.deepEqual(paths.data.scenarios.map(s => s.id), ['A', 'B', 'C']);
  assert.equal(paths.data.gap_fallback_status, 'available');
  assert.deepEqual(paths.data.gap_fallback.range, [24100, 24276]);
  assert.equal(section(contract, 'trigger_confirmation').data.daily_confirmation, 'completed_daily_bar');
  assert.equal(section(contract, 'risk_controls').data.scenarios[0].disaster_stop_status, 'unavailable');
  assert.equal(contract.action_state, 'no_trade');
  assert.equal(contract.decision.code, 'TRIGGERED_RISK_INCOMPLETE');
  assert.equal(contract.decision.scenario_id, 'A');
  assert.equal(contract.decision.structural_invalidation, 24100);
  assert.equal(contract.decision.plan.target, 24648);
  assert.deepEqual(contract.decision.gap_fallback.range, [24100, 24276]);
});

test('A/B/C is permanently ordered from most bullish to most bearish', () => {
  const scenarios = annotations.forecast.scenarios;
  assert.deepEqual(scenarios.map(s => s.id), ['A', 'B', 'C']);
  assert.deepEqual(Object.fromEntries(scenarios.map(s => [s.id, s.color])), {
    A: '#00d87f',
    B: '#a78bfa',
    C: '#ff8c42'
  });
  assert.equal(annotations.forecast.scenario_order.version, 'direction_desc_v1');
  assert.equal(scenarios[0].rr.direction, 'long');
  assert.match(scenarios[0].name, /收复24276/);
  assert.equal(scenarios[1].rr.direction, 'short');
  assert.match(scenarios[1].name, /弱反抽/);
  assert.equal(scenarios[2].rr.direction, 'short');
  assert.match(scenarios[2].name, /跌破23865/);
  assert.ok(scenarios[0].rr.target > scenarios[0].rr.entry);
  assert.ok(scenarios[1].rr.target < scenarios[1].rr.entry);
  assert.ok(scenarios[2].rr.target < scenarios[2].rr.entry);
  assert.equal(annotations.forecast.scenario_evidence.scenarios.A.direction_alignment, 'aligned');
  assert.equal(annotations.forecast.scenario_evidence.scenarios.B.direction_alignment, 'conflicts');
  assert.equal(annotations.forecast.scenario_evidence.scenarios.C.direction_alignment, 'conflicts');
});

test('scenario identity colours cannot be replaced by state colours', () => {
  const source = fs.readFileSync(require('node:path').join(__dirname, '../investment/chart/index.html'), 'utf8');
  assert.match(source, /SCENARIO_COLORS\s*=\s*\{\s*A:\s*'#00d87f',\s*B:\s*'#a78bfa',\s*C:\s*'#ff8c42'\s*\}/);
  assert.doesNotMatch(source, /invalid\s*\?\s*'#FF453A'\s*:\s*hexToRgba\(sc\.color/);
  assert.match(source, /card\.style\.setProperty\('--sc-color',\s*scenarioColor\(sc\)\)/);
  assert.match(source, /class="fc-endpoint-label"/);
  assert.match(source, /timeToCoordinate\(fs\.endTime\)/);
  assert.doesNotMatch(source, /shape:\s*'circle'.*text:\s*shortName\(sc\.name\)/);
});

test('missing or stale status never promotes a raw A/B/C narrative into a trigger', () => {
  const missing = TradingOperation.build(input({ scenarioStatus: null }));
  assert.equal(section(missing, 'scenario_paths').provenance.status, 'missing');
  assert.ok(section(missing, 'scenario_paths').data.scenarios.every(s => s.state === 'not_actionable'));
  const stale = TradingOperation.build(input({ scenarioStatus: Object.assign({}, freshStatus, { updated_at: '2026-10-06T14:00:00+08:00' }) }));
  assert.equal(section(stale, 'trigger_confirmation').provenance.status, 'stale');
  assert.ok(section(stale, 'scenario_paths').data.scenarios.every(s => s.state === 'not_actionable'));
  assert.equal(stale.decision.code, 'INTRADAY_GUIDANCE');
  assert.equal(stale.decision.label, '盘中参考·待收盘');
  assert.equal(stale.decision.intraday_guidance, true);
  assert.equal(stale.decision.current_zone.range_text, '24,276–24,444');
  assert.match(stale.decision.next_action, /A剧本预备区/);
  assert.equal(stale.decision.scenario_id, null);
});

test('intraday or unpaired status cannot be labeled daily confirmation', () => {
  const preview = TradingOperation.build(input({ scenarioStatus: Object.assign({}, freshStatus, { judgment_mode: 'intraday_preview', updated_at: '2026-10-06T14:34:00+08:00' }), quote: { price: 24280, ts: at('2026-10-06T14:34:00') / 1000 }, now: at('2026-10-06T14:35:00') }));
  assert.equal(section(preview, 'trigger_confirmation').data.daily_confirmation, 'not_confirmed');
  assert.equal(section(preview, 'trigger_confirmation').provenance.status, 'unavailable');
  assert.equal(preview.decision.code, 'INTRADAY_GUIDANCE');
  assert.match(preview.decision.headline, /盘中位于/);
  const provisional = TradingOperation.build(input({ dailyBars: [Object.assign({}, completeBar, { partial: true })] }));
  assert.equal(section(provisional, 'trigger_confirmation').data.daily_confirmation, 'not_confirmed');
  assert.equal(section(provisional, 'scenario_paths').data.scenarios.find(s => s.id === 'A').state, 'not_actionable');
});

test('research-only breadth cannot affect operation decisions', () => {
  const base = TradingOperation.build(input());
  const withResearch = TradingOperation.build(input({ breadth: { status: 'available', score: 999, contribution: ['invented'] }, options: { iv: 1 } }));
  assert.equal(withResearch.action_state, base.action_state);
  assert.deepEqual(withResearch.sections, base.sections);
  assert.equal(JSON.stringify(withResearch).includes('invented'), false);
});

test('structural invalidation remains distinct from an unavailable disaster stop', () => {
  const risk = section(TradingOperation.build(input()), 'risk_controls').data.scenarios;
  for (const scenario of risk) {
    assert.equal(typeof scenario.structural_invalidation.price, 'number');
    assert.equal(scenario.disaster_stop_status, 'unavailable');
    assert.notEqual(scenario.structural_invalidation, scenario.disaster_stop);
  }
});
