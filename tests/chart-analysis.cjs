const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const MR = require('../investment/chart/market-rules.js');
const TA = require('../investment/chart/technical-analysis.js');
const CandlePatterns = require('../investment/chart/patterns.js');
const html = fs.readFileSync(require('node:path').join(__dirname,'../investment/chart/index.html'),'utf8');
const now = Date.parse('2026-10-06T14:35:00+08:00');
const at = s => Date.parse(s+'+08:00');
const bar = (close, i=0) => ({time:{year:2026,month:8,day:i+1},open:close,high:close+1,low:close-1,close});
function closeTo(actual, expected, tolerance=1e-8) { assert.ok(Math.abs(actual-expected)<tolerance, `${actual} != ${expected}`); }
function extract(name) {
  const start=html.indexOf('  function '+name+'(');
  assert.ok(start>=0,name);
  return html.slice(start,html.indexOf('\n  }',start)+4);
}
function render(name,globals={}) {
  const ctx=vm.createContext({MarketRules:MR,TechnicalAnalysis:TA,Date:class extends Date{static now(){return now;}},...globals});
  vm.runInContext(extract(name),ctx);return ctx;
}
test('an upstream quote stays stale despite repeated downloads; future ticks rejected',()=>{
  assert.equal(MR.quoteState({price:24000,ts:(now-86400000)/1000},now),'stale');
  assert.equal(MR.quoteState({price:24000,ts:(now-400000)/1000},now),'stale');
  assert.equal(MR.quoteState({price:24000,ts:(now-30000)/1000},now),'live');
  assert.equal(MR.quoteState({price:24000,ts:(now+120000)/1000},now),'stale');
});
test('last-close quote valid overnight/weekend, intraday quote not substituted for close',()=>{
  const quote={price:24000,ts:at('2026-10-02T16:00:00')/1000};
  assert.equal(MR.quoteState(quote,at('2026-10-04T14:35:00')),'last-close');
  assert.equal(MR.quoteState({...quote,ts:at('2026-10-02T14:00:00')/1000},at('2026-10-04T14:35:00')),'stale');
});
test('16:00-16:10 is a closing preview, never mislabeled as a confirmed close',()=>{
  const preview={price:24280,ts:at('2026-10-06T16:08:00')/1000};
  assert.equal(MR.session(at('2026-10-06T16:08:00')).phase,'closing');
  assert.equal(MR.quoteState(preview,at('2026-10-06T16:08:30')),'closing-preview');
  assert.equal(MR.quoteState(preview,at('2026-10-06T16:10:00')),'last-close');
});
test('HKEX holidays, half days, lunch, year transition and unsupported calendar',()=>{
  assert.equal(MR.tradingDay('2026-10-01'),false);
  assert.equal(MR.tradingDay('2026-10-07'),true);
  assert.equal(MR.session(at('2026-12-24T13:00:00')).phase,'closed');
  assert.equal(MR.session(at('2026-10-06T12:30:00')).phase,'lunch');
  assert.equal(MR.session(at('2027-02-05T13:00:00')).active,false);
  assert.deepEqual(MR.nextDays('2026-09-30',2).map(MR.dayString),['2026-10-02','2026-10-05']);
  assert.deepEqual(MR.nextDays('2026-12-31',1).map(MR.dayString),['2027-01-04']);
  assert.equal(MR.tradingDay('2028-01-03'),null);
  assert.deepEqual(MR.nextDays('2027-12-31',1),[]);
});
test('track display corrects the frozen 10/7 holiday wording without rewriting the ledger source',()=>{
  const source=fs.readFileSync(require('node:path').join(__dirname,'../investment/chart/track/index.html'),'utf8');
  assert.match(source,/10\/7港股正常交易（仅沪深港通关闭）/);
  assert.match(source,/displayCorrection\(v\)/);
});
test('forecast horizons use actual trading days, include October 7, and reject unsupported or malformed input',()=>{
  assert.equal(MR.horizon('2026-09-25',8).end,'2026-10-08');
  assert.equal(MR.horizon('2026-10-06',5).end,'2026-10-13');
  assert.equal(MR.horizon('2026-09-30',3).end,'2026-10-06');
  assert.equal(MR.horizon('2026-10-16',1).end,'2026-10-20');
  assert.equal(MR.horizon('2026-12-31',1).end,'2027-01-04');
  for(const [date,count] of [['2026-02-30',5],['2026-13-01',5],['2028-01-03',1],['2027-12-31',1],['2026-10-06',0],['2026-10-06',1.5]]) {
    assert.equal(MR.horizon(date,count),null);
  }
});
test('horizon validation flags false holiday text and date mismatches without mutating frozen records',()=>{
  const record={createdAt:'2026-10-06T08:45:00+08:00',horizon:'未来约5个交易日',horizonDesc:'未来约5个交易日（至 2026-10-13，中间隔 10/7 中秋翌日休市）'};
  const frozen=JSON.stringify(record);
  assert.equal(MR.auditHorizon(record).status,'mismatch');
  assert.equal(JSON.stringify(record),frozen);
  assert.equal(MR.auditHorizon({...record,horizonDesc:MR.horizon('2026-10-06',5).description}).status,'valid');
  assert.equal(MR.auditHorizon({...record,horizonDesc:'至 2026-10-14'}).status,'mismatch');
  assert.equal(MR.auditHorizon({}).status,'unavailable');
});
test('B and C share a short direction but have different structural boundaries; untriggered C is not called a stopped trade',()=>{
  const c=render('signalStateForScenario',{fmt:String});
  const scenario=stop=>({direction:'short',risk:{structural_invalidation:{price:stop}}});
  const status={core_total:1,core_met:0,triggered:false};
  const bars=[{close:24130.5,partial:false}];
  assert.equal(c.signalStateForScenario(scenario(24444),status,bars,'1d').id,'candidate');
  const state=c.signalStateForScenario(scenario(24100),status,bars,'1d');
  assert.equal(state.label,'当前结构不符合');
  assert.match(state.title,/不代表该情景此前曾触发/);
  assert.equal(c.signalStateForScenario(scenario(24100),status,[{close:24130.5,partial:true}],'1d').id,'candidate');
});
test('partial candles: daily, weekly before Friday, minute session boundary and HKT shift',()=>{
  assert.equal(MR.markBars([{...bar(100),time:'2026-10-06'}],'1d',now)[0].partial,true);
  assert.equal(MR.markBars([{...bar(100),time:'2026-10-05'}],'1wk',now)[0].partial,true);
  const raw=at('2026-10-06T11:30:00')/1000;
  assert.equal(MR.markBars([{...bar(100),time:raw+28800,marketTime:raw}],'60m',at('2026-10-06T11:45:00'))[0].partial,true);
  assert.equal(MR.markBars([{...bar(100),time:raw+28800,marketTime:raw}],'60m',at('2026-10-06T12:05:00'))[0].partial,false);
  assert.equal(MR.dayString(raw+28800),'2026-10-06');
});
test('scenario confirmation requires exact map version, date and fresh source time',()=>{
  const a={meta:{analysis_id:'HSI-20261006-v2'},forecast:{applicable_date:'2026-10-06'}};
  const s={analysis_id:'HSI-20261006-v2',conditions_date:'2026-10-06',updated_at:'2026-10-06T14:34:00+08:00',judgment_mode:'intraday_preview'};
  assert.equal(MR.statusIssue(s,a,now),null);
  assert.match(MR.statusIssue({...s,analysis_id:'old'},a,now),/版本/);
  assert.match(MR.statusIssue({...s,conditions_date:'2026-10-05'},a,now),/日期/);
  assert.match(MR.statusIssue({...s,updated_at:'2026-10-06T12:00:00+08:00'},a,now),/10分钟/);
  assert.match(MR.statusIssue({...s,judgment_mode:'close_final'},a,now),/收盘/);
  assert.match(MR.statusIssue({...s,data_stale:true},a,now),/过期/);
});
test('no funding carry-forward or full-day volume confirmation during session',()=>{
  const input={conditions_date:'2026-10-06',judgment_mode:'intraday_preview',metrics:{southbound_net_yi:68.6,southbound_available:true,southbound_updated_at:'2026-10-06T14:30:00+08:00'},scenarios:[{conditions:[{id:'core',role:'core',met:true},{id:'southbound',role:'confirm',met:true},{id:'strong_vol',role:'confirm',met:true}]}]};
  const s=MR.sanitizeStatus(input,now);
  assert.equal(s.metrics.southbound_net_yi,null);
  assert.equal(s.scenarios[0].conditions[1].met,null);
  assert.equal(s.scenarios[0].conditions[2].met,null);
  assert.equal(s.scenarios[0].strength,'待验证');
  assert.equal(input.metrics.southbound_net_yi,68.6,'original snapshot untouched');
  const openDay={...input,conditions_date:'2026-10-08',metrics:{southbound_net_yi:60,southbound_available:true,southbound_updated_at:'2026-10-08T14:30:00+08:00',volume_ratio_basis:'same_time'}};
  assert.equal(MR.sanitizeStatus(openDay,at('2026-10-08T14:35:00')).scenarios[0].confirm_met,2);
});
test('Wilder RSI reference example, zero-change, monotonic and insufficient data',()=>{
  const closes=[44.34,44.09,44.15,43.61,44.33,44.83,45.10,45.42,45.84,46.08,45.89,46.03,45.61,46.28,46.28];
  closeTo(TA.calculate(closes.map(bar)).rsi[14],70.46413502109705);
  assert.equal(TA.calculate(Array.from({length:40},()=>bar(100))).rsi[39],50);
  assert.equal(TA.calculate(Array.from({length:40},(_,i)=>bar(100+i))).rsi[39],100);
  assert.equal(TA.calculate(Array.from({length:10},()=>bar(100))).rsi[9],null);
});
test('ATR includes price gaps; MACD SMA seeds and histogram scale',()=>{
  const bars=Array.from({length:50},(_,i)=>bar(100,i));
  closeTo(TA.calculate(bars).atr[49],2);
  bars[14]={...bar(110,14),low:109,high:111};
  closeTo(TA.calculate(bars).atr[14],(2*13+11)/14);
  const rising=TA.calculate(Array.from({length:60},(_,i)=>bar(100+i,i)));
  closeTo(rising.dif[25],7);closeTo(rising.dea[33],7);closeTo(rising.hist[33],0);
  assert.equal(rising.dea[32],null);
});
test('confirmed summaries and pivots never use provisional bars or future confirmation',()=>{
  const bars=Array.from({length:40},(_,i)=>bar(100+i,i));
  const s=TA.summary([...bars,{...bar(10000,41),partial:true}]);
  assert.equal(s.bar.close,139);
  const highs=[1,2,5,2,1];const pivotBars=highs.map((h,i)=>({...bar(0,i),high:h,low:-h}));
  assert.equal(TA.pivots(pivotBars.slice(0,4)).highs.length,0);
  assert.equal(TA.pivots(pivotBars).highs[0].confirmedAt.day,5);
});
test('gap lifecycle and missing formation date do not manufacture a formal invalidation',()=>{
  const bars=[{...bar(9,0),low:8,high:10},{...bar(13,1),low:12,high:14},{...bar(12,2),low:11,high:13},{...bar(10,3),low:9,high:11}];
  assert.equal(TA.gaps(bars.slice(0,3))[0].status,'部分回补');
  assert.equal(TA.gaps(bars)[0].status,'完全回补');
  assert.match(TA.levelState({price:10,type:'resistance'},bars,2).status,/形成日期未提供/);
});
test('invalid RR rejected; long and short use the real planned entry',()=>{
  assert.equal(MR.rr(24040.34,24648,24100,'long'),null);
  closeTo(MR.rr(24280,24648,24100,'long').ratio,368/180);
  closeTo(MR.rr(24200,23500,24444,'short').ratio,700/244);
});
test('sub-2:1 and invalid scenarios fail the rendering admission gate',()=>{
  const c=render('scenarioRREligible',{computeRR:rr=>MR.rr(rr.entry,rr.target,rr.stop,rr.direction)});
  assert.equal(c.scenarioRREligible({rr:{entry:100,target:119,stop:90,direction:'long'}}),false);
  assert.equal(c.scenarioRREligible({rr:{entry:100,target:120,stop:90,direction:'long'}}),true);
  assert.equal(c.scenarioRREligible({rr:{entry:100,target:90,stop:110,direction:'long'}}),false);
});
test('chase boundary is exactly 2:1 and prices beyond it are rejected for both directions',()=>{
  const short=MR.chaseBoundary('short',110,80,2);
  closeTo(short.boundary,100);
  closeTo(MR.rr(short.boundary,80,110,'short').ratio,2);
  assert.ok(MR.rr(99.9,80,110,'short').ratio<2);
  const long=MR.chaseBoundary('long',90,120,2);
  closeTo(long.boundary,100);
  closeTo(MR.rr(long.boundary,120,90,'long').ratio,2);
  assert.ok(MR.rr(100.1,120,90,'long').ratio<2);
});
test('scenario ruler shows a human chase boundary, missed state, and hides incomplete odds',()=>{
  const c=render('scenarioRulerHtml',{viewingDate:null,computeRR:rr=>MR.rr(rr.refPrice,rr.target,rr.stop,rr.direction),fmt:String,fmtRatio:r=>r.toFixed(1)+' : 1'});
  const out=c.scenarioRulerHtml({rr:{entry:100,target:80,stop:110,direction:'short'}},99);
  assert.match(out,/跌破 100 不追空/);
  assert.match(out,/价格已越追价边界·等下一结构/);
  assert.match(out,/距理想入场 1点/);
  assert.equal(c.scenarioRulerHtml({rr:{entry:100,stop:110,direction:'short'}},100),'');
});
test('rendered badge never claims trigger when data is missing/stale',()=>{
  const c=render('scenarioBadgeHtml',{viewingDate:null,annotations:{forecast:{}},scenarioStatus:null,statusForScenario:()=>null,currentBars:[],currentIv:'1d',escapeHtml:String,signalStateForScenario:()=>({id:'unavailable',label:'待核对',title:'条件待确认'})});
  const output=c.scenarioBadgeHtml({rr:{entry:24200,direction:'short'}},23000);
  assert.match(output,/条件待确认/);assert.doesNotMatch(output,/✅|条件触发/);
});
test('real-time merges preserve partial flag and update turnover on successive ticks',()=>{
  const c=render('mergeRealtimeIntoChart',{
    currentIv:'1d',klineSource:'futu',currentBars:[{...bar(24000),time:{year:2026,month:10,day:5},volume:981},{...bar(24200),time:{year:2026,month:10,day:6},volume:600,partial:true}],
    hktDateOf:ts=>{const p=MR.hk(ts*1000).date.split('-');return {year:+p[0],month:+p[1],day:+p[2]};},
    sameDay:(a,b)=>MR.dayString(a)===MR.dayString(b),round2:x=>x,
    estimateTodayVolume:rt=>rt.amount/1e8,series:{update(){}},volumeSeries:{update(){}},updateMALines(){},computePatterns(){},applyAllMarkers(){},
    el:()=>({classList:{toggle(){}}}),hasRecentVolumeGap:()=>false
  });
  const tick={ts:now/1000,price:24220,open:24279,high:24354,low:24179,amount:700e8};
  c.mergeRealtimeIntoChart(tick);c.mergeRealtimeIntoChart({...tick,amount:740e8});
  assert.equal(c.currentBars[1].partial,true);assert.equal(c.currentBars[1].volume,740);
});
test('a closing-preview quote never downgrades a confirmed daily bar',()=>{
  let updates=0;
  const confirmed={...bar(24280),time:{year:2026,month:10,day:6},volume:982.6,partial:false};
  const c=render('mergeRealtimeIntoChart',{
    currentIv:'1d',klineSource:'futu',currentBars:[confirmed],
    hktDateOf:ts=>{const p=MR.hk(ts*1000).date.split('-');return {year:+p[0],month:+p[1],day:+p[2]};},
    sameDay:(a,b)=>MR.dayString(a)===MR.dayString(b),round2:x=>x,
    estimateTodayVolume:()=>900,series:{update(){updates++;}},volumeSeries:{update(){updates++;}},updateMALines(){},computePatterns(){},applyAllMarkers(){},
    el:()=>({classList:{toggle(){}}}),hasRecentVolumeGap:()=>false
  });
  c.mergeRealtimeIntoChart({ts:at('2026-10-06T16:08:26')/1000,price:24280.56,open:24279.63,high:24354.11,low:24179.38,amount:982.6e8,final:false});
  assert.equal(c.currentBars[0].partial,false);
  assert.equal(c.currentBars[0].close,24280);
  assert.equal(c.currentBars[0].volume,982.6);
  assert.equal(updates,0);
});
test('a conflicting final tick never rewrites a confirmed daily bar',()=>{
  let updates=0;
  const confirmed={...bar(24280),time:{year:2026,month:10,day:6},open:24279,high:24354,low:24179,volume:982.6,partial:false};
  const c=render('mergeRealtimeIntoChart',{
    currentIv:'1d',klineSource:'futu',currentBars:[confirmed],
    hktDateOf:ts=>{const p=MR.hk(ts*1000).date.split('-');return {year:+p[0],month:+p[1],day:+p[2]};},
    sameDay:(a,b)=>MR.dayString(a)===MR.dayString(b),round2:x=>x,
    estimateTodayVolume:()=>999,series:{update(){updates++;}},volumeSeries:{update(){updates++;}},updateMALines(){},computePatterns(){},applyAllMarkers(){},
    el:()=>({classList:{toggle(){}}}),hasRecentVolumeGap:()=>false
  });
  c.mergeRealtimeIntoChart({ts:at('2026-10-06T16:11:00')/1000,price:24100,open:24000,high:25000,low:23000,amount:999e8,final:true});
  assert.equal(c.currentBars[0].close,24280);
  assert.equal(c.currentBars[0].high,24354);
  assert.equal(c.currentBars[0].volume,982.6);
  assert.equal(updates,0);
});
test('planned RR normalization uses per-scenario entry instead of invalid global reference',()=>{
  const f={rr:{refPrice:24040.34,long:{target:24648,stop:24100}},scenarios:[{rr:{direction:'long',entry:24280,target:24648,stop:24100}}]};
  const c=render('normalizeRRDirs',{annotations:{forecast:f}});
  const dirs=c.normalizeRRDirs(f.rr);assert.equal(dirs[0].entry,24280);closeTo(dirs[0].stat.ratio,368/180);
});

test('forecast zones always originate at the displayed latest candle close',()=>{
  const c=render('anchoredZoneData');
  const last={time:{year:2026,month:10,day:6},close:24258.23};
  const future=[{year:2026,month:10,day:8},{year:2026,month:10,day:9}];
  const points=[{offset:0,price:24040.34},{offset:1,price:24400},{offset:2,price:24500}];
  const data=c.anchoredZoneData(points,last,future,2);
  assert.equal(JSON.stringify(data),JSON.stringify([
    {time:last.time,value:24258.23},
    {time:future[0],value:24400},
    {time:future[1],value:24500}
  ]));
});

test('signal state remains candidate/confirming unless existing conditions or a completed stop close support it',()=>{
  const c=render('signalStateForScenario',{fmt:String});
  const sc={direction:'short',risk:{structural_invalidation:{price:24444}},rr:{direction:'short',stop:25000}};
  assert.equal(c.signalStateForScenario(sc,{core_total:2,core_met:0,triggered:false},[{close:24000,partial:false}],'1d').id,'candidate');
  assert.equal(c.signalStateForScenario(sc,{core_total:2,core_met:1,triggered:false},[{close:24000,partial:false}],'1d').id,'confirming');
  assert.equal(c.signalStateForScenario(sc,{core_total:2,core_met:2,triggered:true},[{close:24000,partial:false}],'1d').id,'triggered');
  assert.equal(c.signalStateForScenario(sc,{core_total:2,core_met:2,triggered:true},[{close:24450,partial:false}],'1d').id,'invalidated');
  assert.equal(c.signalStateForScenario(sc,{core_total:2,core_met:2,triggered:true},[{close:24450,partial:false}],'60m').id,'triggered');
  assert.equal(c.signalStateForScenario(sc,{core_total:2,core_met:2,triggered:true},[{close:24450,partial:true}],'1d').id,'triggered');
  // A different rr.stop must not drive daily invalidation; only the explicit structure level can.
  assert.equal(c.signalStateForScenario(sc,{core_total:2,core_met:2,triggered:true},[{close:24600,partial:false}],'1d').id,'invalidated');
});

test('label-derived level zones only render when the annotated level lies inside the stated range',()=>{
  const c=render('levelRange');
  assert.equal(JSON.stringify(c.levelRange({price:24100,label:'向下缺口 24100–24333'})),JSON.stringify({low:24100,high:24333}));
  assert.equal(c.levelRange({price:24000,label:'整数关 24000'}),null);
  assert.equal(c.levelRange({price:24000,label:'无关区 24100–24333'}),null);
  assert.equal(c.levelRange({price:24444,label:'A剧本作废位 24444（9/29低点）'}),null);
  assert.equal(c.levelRange({price:23500,label:'7月平台上沿 23500'}),null);
  assert.equal(JSON.stringify(c.levelRange({price:24280,label:'多空分界 24276–24358（10/2失守转阻）'})),JSON.stringify({low:24276,high:24358}));
});

test('historical weekly analysis excludes a candle completed after the frozen baseline',()=>{
 const week={time:{year:2026,month:9,day:21},open:100,high:110,low:90,close:105};
 assert.equal(MR.markBars([week],'1wk',at('2026-09-22T16:10:00'))[0].partial,true);
 assert.equal(MR.markBars([week],'1wk',at('2026-09-25T16:10:00'))[0].partial,false);
});

test('latest forecast starts at the newest confirmed candle and skips an intraday partial candle',()=>{
  const bars=[
    {time:{year:2026,month:10,day:5},partial:false},
    {time:{year:2026,month:10,day:6},partial:false},
    {time:{year:2026,month:10,day:7},partial:true}
  ];
  const c=render('anchorIndex',{
    viewingDate:null,
    findBarTime:()=>({year:2026,month:10,day:5})
  });
  assert.equal(c.anchorIndex({forecast:{baseDate:'2026-10-05'}},bars),1);
});

test('historical replay keeps the frozen map base-date anchor',()=>{
  const bars=[
    {time:{year:2026,month:10,day:5},partial:false},
    {time:{year:2026,month:10,day:6},partial:false}
  ];
  const c=render('anchorIndex',{
    viewingDate:'2026-10-05',
    findBarTime:()=>({year:2026,month:10,day:5})
  });
  assert.equal(c.anchorIndex({forecast:{baseDate:'2026-10-05'}},bars),0);
});

test('intraday fallback zones cover every price and retain open-ended gap guards',()=>{
  const data=JSON.parse(fs.readFileSync(require('node:path').join(__dirname,'../investment/chart/annotations.json'),'utf8'));
  const zones=data.intraday_playbook.zones;
  assert.equal(zones[0].range[1],null);
  assert.equal(zones.at(-1).range[0],null);
  for(let i=0;i<zones.length-1;i++) assert.equal(zones[i].range[0],zones[i+1].range[1]);
  assert.deepEqual(zones[0].range,[24444,null]);
  assert.deepEqual(zones.at(-1).range,[null,23250]);
});


test('generated evidence contract is populated from OHLCV, direction-aware, and referenced by status',()=>{
  const annotations=JSON.parse(fs.readFileSync(require('node:path').join(__dirname,'../investment/chart/annotations.json'),'utf8'));
  const status=JSON.parse(fs.readFileSync(require('node:path').join(__dirname,'../investment/chart/scenario_status.json'),'utf8'));
  const e=annotations.forecast.scenario_evidence;
  assert.equal(e.schema_version,'1.0'); assert.equal(e.timeframe,'1d');
  assert.equal(e.last_bar.completed,true); assert.ok(e.last_bar.date);
  assert.ok(e.observation && e.observation.id);
  const feed=JSON.parse(fs.readFileSync(require('node:path').join(__dirname,'../investment/chart/kline_futu.json'),'utf8'));
  // A frozen evidence card must be checked against the bars that existed at
  // its own cutoff.  The live feed may already contain later sessions.
  const bars=feed.candles
    .filter(x=>x.date<=e.last_bar.date)
    .map(x=>({time:x.date,open:x.open,high:x.high,low:x.low,close:x.close}));
  const detected=CandlePatterns.detect(bars,{intraday:false}).find(x=>x.index===bars.length-1);
  assert.equal(e.observation.id,detected ? detected.id : 'no_valid_pattern');
  const scenarios=annotations.forecast.scenarios;
  scenarios.forEach(sc=>{
    assert.ok(sc.id); assert.ok(['long','short','neutral'].includes(sc.direction));
    assert.ok(e.scenarios[sc.id]);
    assert.ok(['aligned','conflicts','no_directional_evidence'].includes(e.scenarios[sc.id].direction_alignment));
    assert.ok(sc.risk && sc.risk.structural_invalidation);
    assert.ok(Object.hasOwn(sc.risk,'disaster_stop'));
  });
  // scenario_status.json is a live pipeline artifact and can briefly lag the
  // frozen annotations snapshot. Validate references when the live artifact
  // has them, without making an unrelated UI release depend on stale state.
  if(status.evidence_ref) assert.equal(status.evidence_ref.analysis_id,annotations.meta.analysis_id);
  if(status.scenarios.every(x=>x.evidence_ref)) {
    assert.deepEqual(status.scenarios.map(x=>x.evidence_ref.scenario_id),scenarios.map(x=>x.id));
  }
});

test('evidence card consumes generated scenario contract and never falls back to chart marker prose',()=>{
  const evidence={scenario_id:'A',direction_alignment:'conflicts',observation:{name:'向上跳空缺口',explanation:'OHLCV evidence'},confirmation:'daily close condition',structural_invalidation:{price:24444},disaster_stop:{price:null}};
  const c=render('scenarioEvidenceHtml',{viewingDate:null,currentIv:'1d',currentBars:[],annotations:{forecast:{scenario_evidence:{timeframe:'1d',scenarios:{A:evidence}}}},statusForScenario:()=>null,scenarioEvidenceFor:()=>evidence,signalStateForScenario:()=>({label:'待核对',title:'missing'}),escapeHtml:String,fmt:String});
  const out=c.scenarioEvidenceHtml({id:'A'});
  assert.match(out,/OHLCV evidence/); assert.match(out,/与该情景方向冲突/); assert.match(out,/未配置独立灾难止损/);
  assert.doesNotMatch(out,/patternByTime|最新完整K线未识别/);
});
