const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const TradingOperation = require('../investment/chart/trading-operation.js');
const annotations = JSON.parse(fs.readFileSync(require('node:path').join(__dirname, '../investment/chart/annotations.json'), 'utf8'));
const status = JSON.parse(fs.readFileSync(require('node:path').join(__dirname, '../investment/chart/scenario_status.json'), 'utf8'));
const participation = JSON.parse(fs.readFileSync(require('node:path').join(__dirname, '../investment/chart/hsi-participation.json'), 'utf8'));
const at = s => Date.parse(s + '+08:00');
// Use the canonical feed representation so this fixture is independent of
// whichever chart-time adapter the checked-out branch currently carries.
const completeBar = { time: '2026-10-06', open: 24279, high: 24354, low: 24179, close: 24280, partial: false };
const freshStatus = Object.assign({}, status, {
  analysis_id: annotations.meta && annotations.meta.analysis_id,
  analysis_updated_at: annotations.forecast.updatedAt || (annotations.meta && annotations.meta.updatedAt),
  updated_at: '2026-10-06T16:32:10+08:00',
  conditions_date: '2026-10-06',
  judgment_mode: 'close_final',
  data_stale: false,
  conditions_stale: false
});
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
  assert.ok(['unavailable', 'stale'].includes(section(preview, 'trigger_confirmation').provenance.status));
  assert.equal(preview.decision.code, 'INTRADAY_GUIDANCE');
  assert.match(preview.decision.headline, /盘中位于/);
  const provisional = TradingOperation.build(input({ dailyBars: [Object.assign({}, completeBar, { partial: true })] }));
  assert.equal(section(provisional, 'trigger_confirmation').data.daily_confirmation, 'not_confirmed');
  assert.equal(section(provisional, 'scenario_paths').data.scenarios.find(s => s.id === 'A').state, 'not_actionable');
});

test('intraday window is a narrow tactical band with explicit boundary distances', () => {
  const contract = TradingOperation.build(input({
    scenarioStatus: Object.assign({}, freshStatus, { judgment_mode: 'intraday_preview', updated_at: '2026-10-06T14:34:00+08:00' }),
    quote: { price: 24130.5, ts: at('2026-10-06T14:34:00') / 1000 },
    now: at('2026-10-06T14:35:00')
  }));
  const tactical = contract.decision.tactical_window;
  assert.equal(tactical.scope, 'intraday_tactical');
  assert.deepEqual(tactical.range, [24100, 24276]);
  assert.equal(tactical.width_points, 176);
  assert.equal(tactical.lower.distance_points, 30.5);
  assert.equal(tactical.upper.distance_points, 145.5);
  assert.equal(tactical.nearest_boundary, 'lower');
  assert.equal(tactical.lower.next_stance, '偏空/观望');
  assert.equal(tactical.upper.next_stance, '偏多观察');
});

test('chart keeps a compact canvas while price content occupies more of it', () => {
  const source = fs.readFileSync(require('node:path').join(__dirname, '../investment/chart/index.html'), 'utf8');
  assert.match(source, /#chart \{ width: 100%; height: 50vh; min-height: 360px; max-height: 520px;/);
  assert.match(source, /scaleMargins: \{ top: 0\.04, bottom: 0\.14 \}/);
  assert.match(source, /bandAlpha = 0\.07 \+ weight \* 0\.18/);
  assert.match(source, /centerLine/);
  assert.match(source, /Compact intraday status/);
  assert.match(source, /key_level_distances/);
  assert.match(source, /gap-takeover/);
});

test('key-level distances are signed, dynamic, nearest-first, and fail closed', () => {
  const scenarios=[{id:'C',rr:{entry:24072,stop:24100}}];
  const playbook={zones:[{range:[24100,24276]}]};
  const result=TradingOperation.keyLevelDistances(24130,scenarios,playbook,{range:[24100,24276]});
  assert.equal(result.length,2);
  assert.equal(result[0].price,24100);
  assert.equal(result[0].distance_points,-30);
  assert.equal(result[1].label,'C触发');
  assert.equal(result[1].distance_points,-58);
  scenarios[0].rr.entry=24120;
  assert.equal(TradingOperation.keyLevelDistances(24130,scenarios,playbook,null)[0].distance_points,-10);
  assert.deepEqual(TradingOperation.keyLevelDistances(null,scenarios,playbook,null),[]);
});

test('intraday gap takeover and close-final state are explicit contract fields', () => {
  const intraday=Object.assign({},freshStatus,{judgment_mode:'intraday_preview'});
  const open=TradingOperation.build(input({scenarioStatus:intraday,dailyBars:[],quote:{price:24130.5,ts:at('2026-10-06T14:30:00')/1000},now:at('2026-10-06T14:35:00')}));
  assert.equal(open.decision.gap_takeover,false, 'an old gap zone alone is not a current session gap');
  assert.equal(open.decision.session_gap.status,'unavailable');
  assert.equal(open.decision.close_confirmed,false);
  const closed=TradingOperation.build(input());
  assert.equal(closed.decision.close_confirmed,true);
});

test('session takeover uses same-day OHLC, ends after filling, and ignores historic gap prices', () => {
  const prior={time:'2026-10-05',open:23963,high:24040,low:23835,close:24040};
  const today={time:'2026-10-06',open:24279,high:24354,low:24179,close:24280,partial:true};
  assert.equal(TradingOperation.sessionGap([prior,today],'2026-10-06').status,'unfilled');
  assert.equal(TradingOperation.sessionGap([prior,{...today,low:24040}],'2026-10-06').status,'filled');
  const next={time:'2026-10-07',open:24172,high:24266,low:24071,close:24130,partial:true};
  assert.equal(TradingOperation.sessionGap([{...today,partial:false},next],'2026-10-07').status,'filled');
  assert.equal(TradingOperation.sessionGap([{...today,partial:false},{...next,open:24200}],'2026-10-07').status,'no_gap');
  assert.equal(TradingOperation.sessionGap([prior,next],'2026-10-07').status,'unavailable', 'missing previous session cannot imply a gap');
  const intraday={...freshStatus,judgment_mode:'intraday_preview'};
  const active=TradingOperation.build(input({scenarioStatus:intraday,dailyBars:[prior,today],quote:{price:24200,ts:at('2026-10-06T14:30:00')/1000},now:at('2026-10-06T14:31:00')}));
  assert.equal(active.decision.gap_takeover,true);
  assert.equal(active.decision.observation_label,'等收盘确认·不开仓');
  const filled=TradingOperation.build(input({scenarioStatus:intraday,dailyBars:[prior,{...today,low:24040}],quote:{price:24130,ts:at('2026-10-06T14:30:00')/1000},now:at('2026-10-06T14:31:00')}));
  assert.equal(filled.decision.gap_takeover,false, 'price in historic zone does not reactivate filled gap');
  const afterClose=TradingOperation.build(input({scenarioStatus:intraday,dailyBars:[prior,today],quote:{price:24200,ts:at('2026-10-06T16:09:00')/1000},now:at('2026-10-06T16:33:00')}));
  assert.equal(afterClose.decision.gap_takeover,false);
  assert.match(afterClose.decision.observation_label,/已收盘.*待同步/);
  const down={time:'2026-10-06',open:23700,high:23800,low:23600,partial:true};
  assert.equal(TradingOperation.sessionGap([prior,down],'2026-10-06').direction,'down');
  assert.equal(TradingOperation.sessionGap([prior,{...down,high:23835}],'2026-10-06').active,false);
});

test('console weights include the same context correction as cards, without promoting triggers', () => {
  const MarketContext=require('../investment/chart/market-context.js');
  const MarketParticipation=require('../investment/chart/market-participation.js');
  const ctx={status:'available',futures:{return_from_previous_close:-.015,basis_pct:-.004},liquidity:{spread_points:2},options_risk:{price:25}};
  const part=MarketParticipation.evaluate(participation,annotations.forecast.scenarios,freshStatus.conditions_date);
  const expected=MarketContext.evaluate(ctx,annotations.forecast.scenarios,part.status==='available'?part.weights:null);
  const before=TradingOperation.build(input({participation}));
  const after=TradingOperation.build(input({participation,marketContext:ctx}));
  for(const row of section(after,'scenario_paths').data.scenarios) {
    assert.equal(row.effective_probability,expected.weights[row.id]);
    assert.equal(row.state,section(before,'scenario_paths').data.scenarios.find(s=>s.id===row.id).state);
  }
  const top=after.decision.scenario_pointer.top_weight;
  assert.equal(top.weight,expected.weights[top.id]);
  assert.notEqual(after.decision.scenario_pointer.top_weight.weight,before.decision.scenario_pointer.top_weight.weight);
});

test('scenario pointer separates nearest, top weight, divergence and close confirmation', () => {
  const rows=[
    {id:'A',rr:{entry:24400},effective_probability:.48,status:'available',state:'candidate'},
    {id:'B',rr:{entry:24172},effective_probability:.32,status:'available',state:'candidate'},
    {id:'C',rr:{entry:23900},effective_probability:.20,status:'available',state:'triggered'}
  ];
  const p=TradingOperation.scenarioPointer(24130,rows,200,false);
  assert.equal(p.nearest.id,'B'); assert.equal(p.nearest.distance_points,42);
  assert.deepEqual(p.top_weight,{id:'A',weight:.48}); assert.deepEqual(p.confirmed,[]);
  assert.equal(TradingOperation.scenarioPointer(24286,rows,200,false).nearest,null);
  assert.equal(TradingOperation.scenarioPointer(25000,rows,200,false).nearest,null);
  assert.deepEqual(TradingOperation.scenarioPointer(24130,rows,200,true).confirmed,['C']);
});

test('scenario colours have one source and drive cards, pointers and chart bands', () => {
  const source=fs.readFileSync(require('node:path').join(__dirname,'../investment/chart/index.html'),'utf8');
  assert.match(source,/var SCENARIO_COLORS = \{ A: '#00d87f', B: '#a78bfa', C: '#ff8c42' \}/);
  assert.match(source,/card\.style\.setProperty\('--sc-color', scenarioColor\(sc\)\)/);
  assert.match(source,/scenarioColor\(\{id:pointer\.nearest\.id\}\)/);
  assert.match(source,/var scColor = scenarioColor\(sc\)/);
});

test('research-only breadth cannot affect operation decisions', () => {
  const base = TradingOperation.build(input());
  const withResearch = TradingOperation.build(input({ breadth: { status: 'available', score: 999, contribution: ['invented'] }, options: { iv: 1 } }));
  assert.equal(withResearch.action_state, base.action_state);
  assert.deepEqual(withResearch.sections, base.sections);
  assert.equal(JSON.stringify(withResearch).includes('invented'), false);
});

test('validated HSI participation is carried into the operation contract and adjusts display weights only', () => {
  const contract = TradingOperation.build(input({ participation }));
  const regime = section(contract, 'market_regime').data.market_participation;
  const paths = section(contract, 'scenario_paths').data.scenarios;
  assert.equal(regime.status, 'available');
  assert.ok(paths.find(s => s.id === 'A').effective_probability > paths.find(s => s.id === 'A').base_probability);
  assert.equal(paths.find(s => s.id === 'A').trigger, annotations.forecast.scenarios.find(s => s.id === 'A').trigger);
  assert.equal(paths.find(s => s.id === 'A').structural_invalidation.price, annotations.forecast.scenarios.find(s => s.id === 'A').risk.structural_invalidation.price);
});

test('structural invalidation remains distinct from an unavailable disaster stop', () => {
  const risk = section(TradingOperation.build(input()), 'risk_controls').data.scenarios;
  for (const scenario of risk) {
    assert.equal(typeof scenario.structural_invalidation.price, 'number');
    assert.equal(scenario.disaster_stop_status, 'unavailable');
    assert.notEqual(scenario.structural_invalidation, scenario.disaster_stop);
  }
});
