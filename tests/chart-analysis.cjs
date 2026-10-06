const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const MR = require('../investment/chart/market-rules.js');
const TA = require('../investment/chart/technical-analysis.js');
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
test('HKEX holidays, half days, lunch, year transition and unsupported calendar',()=>{
  assert.equal(MR.tradingDay('2026-10-01'),false);
  assert.equal(MR.session(at('2026-12-24T13:00:00')).phase,'closed');
  assert.equal(MR.session(at('2026-10-06T12:30:00')).phase,'lunch');
  assert.equal(MR.session(at('2027-02-05T13:00:00')).active,false);
  assert.deepEqual(MR.nextDays('2026-09-30',2).map(MR.dayString),['2026-10-02','2026-10-05']);
  assert.deepEqual(MR.nextDays('2026-12-31',1).map(MR.dayString),['2027-01-04']);
  assert.equal(MR.tradingDay('2028-01-03'),null);
  assert.deepEqual(MR.nextDays('2027-12-31',1),[]);
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
test('rendered badge never claims trigger when data is missing/stale',()=>{
  const c=render('scenarioBadgeHtml',{viewingDate:null,annotations:{forecast:{}},scenarioStatus:null,statusForScenario:()=>null,escapeHtml:String});
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
test('planned RR normalization uses per-scenario entry instead of invalid global reference',()=>{
  const f={rr:{refPrice:24040.34,long:{target:24648,stop:24100}},scenarios:[{rr:{direction:'long',entry:24280,target:24648,stop:24100}}]};
  const c=render('normalizeRRDirs',{annotations:{forecast:f}});
  const dirs=c.normalizeRRDirs(f.rr);assert.equal(dirs[0].entry,24280);closeTo(dirs[0].stat.ratio,368/180);
});

test('historical weekly analysis excludes a candle completed after the frozen baseline',()=>{
 const week={time:{year:2026,month:9,day:21},open:100,high:110,low:90,close:105};
 assert.equal(MR.markBars([week],'1wk',at('2026-09-22T16:10:00'))[0].partial,true);
 assert.equal(MR.markBars([week],'1wk',at('2026-09-25T16:10:00'))[0].partial,false);
});
