const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs');
const {build,judge}=require('../scripts/daily-analysis.cjs');
const {audit,deployment}=require('../scripts/check-daily-publication.cjs');
const MR=require('../investment/chart/market-rules.js');
const feed=require('./fixtures/hsi-preopen-2026-10-09.json');
const seed=require('../investment/chart/archive/2026-10-06.json');
const args={date:'2026-10-09',feed,seed,generatedAt:'2026-10-11T10:00:00+08:00',backfill:true};
test('October 9 reconstruction uses only preopen information and is not a genuine prediction',()=>{
 const a=build(args);
 assert.equal(a.forecast.baseDate,'2026-10-08');assert.equal(a.forecast.basePrice,23785.79);
 assert.equal(a.publication.eligible_as_new_prediction,false);
 assert.equal(a.publication.information_cutoff,'2026-10-09T08:45:00+08:00');
 assert.equal(MR.analysisAvailability(a,Date.parse('2026-10-09T12:00:00+08:00')).status,'backfill');
 assert.equal(a.forecast.scenarios.every(s=>s.probability===null),true);
});
test('October 9 price and later candles cannot affect reconstructed boundaries or narratives',()=>{
 const polluted=JSON.parse(JSON.stringify(feed));polluted.candles.push({date:'2026-10-09',open:1,high:999999,low:1,close:999999});
 assert.deepEqual(build({...args,feed:polluted}),build(args));
 const late={...feed,updated_at:'2026-10-09T16:30:00+08:00'};
 assert.throws(()=>build({...args,feed:late}),/after preopen cutoff/);
});
test('missing prior session, malformed OHLC and unsupported calendar reject publication',()=>{
 assert.throws(()=>build({...args,feed:{...feed,candles:feed.candles.filter(b=>b.date!=='2026-10-08')}}),/baseline/);
 const bad=JSON.parse(JSON.stringify(feed));bad.candles.at(-1).high=1;
 assert.throws(()=>build({...args,feed:bad}),/OHLC/);
 assert.throws(()=>build({...args,date:'2026-10-10'}),/trading/);
 assert.throws(()=>build({...args,backfill:false}),/missed/);
});
test('price partition covers exact boundaries once; environment never changes core verdict',()=>{
 assert.equal(judge,MR.priceCondition);
 const a=build(args),rules=a.forecast.scenarios.map(s=>s.price_rule),lo=rules[1].lower,hi=rules[1].upper;
 for(const p of [lo-1,lo,lo+1,hi-1,hi,hi+1])assert.equal(rules.filter(r=>judge(r,p)).length,1);
 assert.equal(judge(rules[1],lo),true);assert.equal(judge(rules[0],hi),true);
 const changed=build({...args,participation:{status:'available',as_of:'2026-10-08',updated_at:'2026-10-09T01:00:00+08:00',metrics:{weighted_breadth:1}}});
 assert.deepEqual(changed.forecast.scenarios.map(s=>s.price_rule),rules);
 assert.equal(auditableDate(a),true);
});
function auditableDate(a){return a.forecast.horizonEndDate===MR.horizon('2026-10-09',5).end;}
test('deadline watchdog rejects carryovers/backfills and accepts genuine preopen generation',()=>{
 const now=Date.parse('2026-10-09T09:15:00+08:00');
 assert.throws(()=>audit(build(args),now),/genuine/);
 assert.throws(()=>audit(seed,now),/genuine/);
 const daily=build({...args,backfill:false,generatedAt:'2026-10-09T08:46:00+08:00'});
  assert.equal(audit(daily,now).date,'2026-10-09');
  assert.throws(()=>audit({...daily,meta:{...daily.meta,updatedAt:'2026-10-08T08:45:00+08:00'}},now),/timestamp/);
 assert.equal(audit({},Date.parse('2026-10-11T09:15:00+08:00')).skipped,true);
});
test('deployment verification fails on absent, pending or failed Cloudflare checks',async()=>{
 const previous=global.fetch;
 try {
  for(const conclusion of [null,'failure']){
   global.fetch=async()=>({ok:true,json:async()=>({check_runs:[{name:'Cloudflare Pages',status:conclusion?'completed':'in_progress',conclusion}]})});
   await assert.rejects(deployment('owner/repo','a'.repeat(40)),/not confirmed/);
  }
  global.fetch=async()=>({ok:true,json:async()=>({check_runs:[{name:'Cloudflare Pages',status:'completed',conclusion:'success'}]})});
  await deployment('owner/repo','a'.repeat(40));
 } finally {global.fetch=previous;}
});
test('generator and independent watchdog have real separate scheduled workflow definitions',()=>{
 const generation=fs.readFileSync('.github/workflows/daily-analysis.yml','utf8');
 const checks=fs.readFileSync('.github/workflows/check-daily-publication.yml','utf8');
 assert.match(generation,/45 0 \* \* 1-5/);assert.match(generation,/20,40 8 \* \* 1-5/);
 assert.match(checks,/15,25 1 \* \* 1-5/);assert.match(checks,/check-daily-publication.cjs/);
 assert.match(generation,/publish-daily-analysis.cjs/);
});

test('preopen publishes in an isolated repository, retries preserve the same freeze, and close review is separate',async()=>{
 const os=require('node:os'),path=require('node:path'),{run}=require('../scripts/publish-daily-analysis.cjs');
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'daily-analysis-')),dir=path.join(tmp,'investment/chart');fs.mkdirSync(dir,{recursive:true});
 try {
  const latest=require('./fixtures/hsi-close-2026-10-09.json');
  for(const [name,value] of [['annotations.json',seed],['kline_futu.json',latest],['hsi-participation.json',{}]])fs.writeFileSync(path.join(dir,name),JSON.stringify(value));
  // Overnight inputs are injected (no network in tests); the second run must not even consult them.
  let calls=0;const ovn=require('./fixtures/overnight-2026-10-12.json'),fetchOvernight=async({now})=>{calls++;return {...ovn,fetched_at:new Date(now).toISOString()};};
  await run({projectRoot:tmp,now:Date.parse('2026-10-12T08:46:00+08:00'),fetchOvernight});
  const frozen=fs.readFileSync(path.join(dir,'annotations.json'),'utf8');
  await run({projectRoot:tmp,now:Date.parse('2026-10-12T09:05:00+08:00'),fetchOvernight:async()=>{throw Error('frozen day must not refetch');}});
  assert.equal(calls,1);
  assert.equal(fs.readFileSync(path.join(dir,'annotations.json'),'utf8'),frozen);
  const a=JSON.parse(frozen);assert.equal(a.forecast.baseDate,'2026-10-09');assert.equal(a.forecast.applicable_date,'2026-10-12');
  await assert.rejects(run({projectRoot:tmp,phase:'postclose',now:Date.parse('2026-10-12T16:20:00+08:00')}),/Missing completed/);
  const after={...latest,updated_at:'2026-10-12T16:15:00+08:00',candles:[...latest.candles,{date:'2026-10-12',open:24211,high:24500,low:24100,close:24400}]};
  fs.writeFileSync(path.join(dir,'kline_futu.json'),JSON.stringify(after));
  await run({projectRoot:tmp,phase:'postclose',now:Date.parse('2026-10-12T16:20:00+08:00')});
  assert.equal(fs.readFileSync(path.join(dir,'annotations.json'),'utf8'),frozen);
  const status=JSON.parse(fs.readFileSync(path.join(dir,'scenario_status.json'),'utf8'));assert.equal(status.analysis_id,a.meta.analysis_id);assert.equal(status.scenarios.filter(s=>s.triggered).length,1);
  const review=JSON.parse(fs.readFileSync(path.join(dir,'daily-reviews/2026-10-12.json'),'utf8'));assert.equal(review.bar.date,'2026-10-12');
  const p=a.forecast.scenarios.map(s=>s.probability),o=review.verdicts.map(v=>v.met?1:0);assert.deepEqual(o,[1,0,0]);
  assert.equal(review.brier,Math.round(p.reduce((s,v,i)=>s+(v-o[i])**2,0)*10000)/10000);assert.equal(review.brier_status,'scored');assert.equal(review.weight_model,'rule-weights-v4');
 } finally {fs.rmSync(tmp,{recursive:true});}
});

test('October 9 replay uses actual close, matches B but never invents a fill or forecast win',()=>{
 const a=require('../investment/chart/archive/supplements/2026-10-09.json'),daily=require('./fixtures/hsi-close-2026-10-09.json'),frozen=JSON.stringify(a);
 const result=MR.replaySession(a,daily,'2026-10-09');
 assert.equal(result.status,'available');assert.equal(result.bar.close,24211.35);
 assert.deepEqual(result.scenarios.map(s=>s.condition),[false,true,false]);
 assert.equal(result.scenarios[1].entryTouched,false);assert.equal(result.eligible_as_prediction,false);assert.equal(JSON.stringify(a),frozen);
 const changed=structuredClone(daily),b=changed.candles.find(b=>b.date==='2026-10-09');b.close=b.high=24354.11;
 assert.deepEqual(MR.replaySession(a,changed,'2026-10-09').scenarios.map(s=>s.condition),[true,false,false]);
});
test('historical replay rejects missing, duplicate, preview and unclosed candles',()=>{
 const a=build(args),daily=require('./fixtures/hsi-close-2026-10-09.json'),b=daily.candles.find(b=>b.date==='2026-10-09');
 assert.equal(MR.replaySession(a,daily,'2026-10-09',Date.parse('2026-10-09T12:00:00+08:00')).status,'unavailable');
 for(const f of [{...daily,updated_at:'2026-10-09T15:00:00+08:00'},{...daily,candles:[]},{...daily,candles:[b,b]},{...daily,candles:[{...b,final:false}]}])assert.equal(MR.replaySession(a,f,'2026-10-09').status,'unavailable');
});
test('historical renderer produces three compact outcomes without pending signals or live rulers',()=>{
 const vm=require('node:vm'),html=fs.readFileSync(require.resolve('../investment/chart/index.html'),'utf8');
 const source=html.slice(html.indexOf('  function renderHistoricalResults('),html.indexOf('  function renderScenarioCards('));
 const nodes=[],classes=new Set(),wrap={classList:{add:c=>classes.add(c),remove:c=>classes.delete(c)},appendChild:n=>nodes.push(n)};
 const context={MarketRules:MR,historyDailyFeed:require('./fixtures/hsi-close-2026-10-09.json'),viewingDate:'2026-10-09',el:()=>({classList:{add(){}}}),document:{createElement:()=>({addEventListener(){},querySelector(){return null;},style:{setProperty(){}},innerHTML:''})},escapeHtml:s=>String(s),fmt:n=>n.toLocaleString('en-US'),scenarioColor:()=> '#00cc88',Number};
 vm.createContext(context);vm.runInContext(source,context);
 const a=require('../investment/chart/archive/supplements/2026-10-09.json');context.renderHistoricalResults(a,a.forecast.scenarios,wrap);
 assert.equal(nodes.length,4);
 for(const card of nodes.slice(1)) for(const label of ['结构目标','结构失效','参与参考','方案赔率']) assert.ok(card.innerHTML.includes(label));assert.equal(classes.has('sc-history'),true);
 assert.match(nodes[0].innerHTML,/B 收盘条件满足/);assert.match(nodes[0].innerHTML,/24,211.35/);assert.match(nodes[2].innerHTML,/当天未触及/);assert.match(nodes[2].className,/sc-history-matched/);for(const card of nodes.slice(1)){assert.match(card.className,/sc-card/);assert.match(card.innerHTML,/sc-topline/);assert.match(card.innerHTML,/sc-condition-details/);}
 assert.equal(nodes.every(n=>!n.innerHTML.includes('历史条件未回放')&&!n.innerHTML.includes('盈亏标尺')),true);
 nodes.length=0;context.historyDailyFeed=null;context.renderHistoricalResults(a,a.forecast.scenarios,wrap);
 assert.equal(nodes.length,4);for(const card of nodes.slice(1)){assert.match(card.innerHTML,/情景方案保留/);assert.match(card.innerHTML,/触价结果待核对/);assert.doesNotMatch(card.innerHTML,/当天未触及/);}
 context.MarketRules={...MR,replaySession:undefined};nodes.length=0;context.renderHistoricalResults(a,a.forecast.scenarios,wrap);assert.equal(nodes.length,4);
 context.MarketRules={...MR,replaySession(){throw Error('outcome failure');}};context.console={warn(){}};nodes.length=0;context.renderHistoricalResults(a,a.forecast.scenarios,wrap);assert.equal(nodes.length,4);
 assert.match(html,/market-rules\.js\?v=5/);
 assert.match(html,/\.scenarios\.sc-history \{ align-items: start;/);assert.match(html,/request !== historySelectionRequest/);
});

test('generator rejects explicitly unconfirmed baseline and nonpositive OHLC',()=>{
 const pending=structuredClone(feed);pending.candles.at(-1).final=false;
 assert.throws(()=>build({...args,feed:pending}),/baseline/);
 const zero=structuredClone(feed);Object.assign(zero.candles.at(-1),{open:0,low:0,close:0});
 assert.throws(()=>build({...args,feed:zero}),/OHLC/);
});
test('postclose fails closed before writing a review or final status for invalid daily data',async()=>{
 const os=require('node:os'),path=require('node:path'),{run}=require('../scripts/publish-daily-analysis.cjs');
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'invalid-close-')),dir=path.join(tmp,'investment/chart');fs.mkdirSync(dir,{recursive:true});
 const a=build({...args,backfill:false,generatedAt:'2026-10-09T08:46:00+08:00'});
 const daily=require('./fixtures/hsi-close-2026-10-09.json'),b=daily.candles.find(b=>b.date==='2026-10-09');
 try {
  fs.writeFileSync(path.join(dir,'annotations.json'),JSON.stringify(a));
  fs.writeFileSync(path.join(dir,'scenario_status.json'),'{"sentinel":true}');
  for(const candles of [[{...b,final:false}],[{...b,partial:true}],[b,b],[{...b,high:1}],[{...b,low:0}]]){
   fs.writeFileSync(path.join(dir,'kline_futu.json'),JSON.stringify({...daily,updated_at:'2026-10-09T16:15:00+08:00',candles}));
   await assert.rejects(run({projectRoot:tmp,phase:'postclose',now:Date.parse('2026-10-09T16:20:00+08:00')}),/Missing completed/);
   assert.equal(fs.existsSync(path.join(dir,'daily-reviews/2026-10-09.json')),false);
   assert.equal(fs.readFileSync(path.join(dir,'scenario_status.json'),'utf8'),'{"sentinel":true}');
  }
  assert.equal(MR.replaySession(a,{...daily,updated_at:'2026-10-10T16:15:00+08:00'},'2026-10-09',Date.parse('2026-10-09T16:20:00+08:00')).status,'unavailable');
 } finally {fs.rmSync(tmp,{recursive:true});}
});

test('October 8 has independent reconstruction from the October 7 snapshot, never October 6 carryover',()=>{
 const snapshot=require('./fixtures/hsi-preopen-2026-10-08.json');
 const saved=require('../investment/chart/archive/supplements/2026-10-08.json');
 const rebuilt=build({date:'2026-10-08',feed:snapshot,seed,generatedAt:saved.publication.generated_at,backfill:true,provenance:saved.publication.source_snapshot});
 assert.equal(saved.forecast.baseDate,'2026-10-07');
 assert.equal(saved.publication.information_cutoff,'2026-10-08T08:45:00+08:00');
 assert.equal(saved.publication.eligible_as_new_prediction,false);
 assert.deepEqual(saved.forecast,rebuilt.forecast);
 assert.equal(saved.forecast.scenarios.length,3);
 assert.notDeepEqual(saved.forecast.scenarios,require('../investment/chart/archive/supplements/2026-10-09.json').forecast.scenarios);
 const index=require('../investment/chart/archive/supplements/index.json');
 for(const date of ['2026-10-08','2026-10-09'])assert.equal(index[date],'supplements/'+date+'.json');
});

test('rule weights: sum to 1, bounded, 0.05 grid, deterministic, versioned and published as rule_based_uncalibrated',()=>{
 const {scoreScenarioWeights,WEIGHT_MODEL}=require('../scripts/daily-analysis.cjs');
 const close=require('./fixtures/hsi-close-2026-10-09.json'),part=require('./fixtures/hsi-participation-2026-10-09.json');
 // v3 path (no overnight snapshot -> annotated fallback); the v4 path is covered by the production-default test below.
 const live={date:'2026-10-12',feed:close,seed,participation:part,generatedAt:'2026-10-12T08:45:30+08:00'};
 const a=build(live),b=build(live),p=a.forecast.scenarios.map(s=>s.probability);
 assert.deepEqual(a,b);assert.equal(WEIGHT_MODEL.version,'rule-weights-v1');
 assert.equal(Math.round(p.reduce((s,v)=>s+v,0)*100),100);
 for(const v of p){assert.ok(v>=0.1-1e-9&&v<=0.85+1e-9);assert.equal(Math.abs(v*20-Math.round(v*20))<1e-9,true);}
 assert.equal(a.publication.probability_status,'rule_based_uncalibrated');assert.equal(a.forecast.weight_model,'rule-weights-v3');
 assert.equal(a.forecast.scenarios.every(s=>typeof s.probability_basis==='string'&&s.probability_basis.length>5),true);
 assert.equal(p[1]>=0.3,true);assert.equal(a.forecast.weight_model_info.factors.breadth_status,'not_used');assert.deepEqual(a.forecast.weight_model_info.factors.shadow_v1,{A:0.3,B:0.5,C:0.2});assert.equal(a.forecast.scenarios.every(s=>s.probability_locked===true),true);
 const noBreadth=build({...live,participation:null});assert.deepEqual(noBreadth.forecast.scenarios.map(s=>s.probability),a.forecast.scenarios.map(s=>s.probability));assert.match(noBreadth.forecast.scenarios[0].probability_basis,/不含宽度\/南向/);
 const {scoreScenarioWeights:sv1}=require('../scripts/daily-analysis.cjs');assert.equal(sv1({bars:close.candles.filter(x=>x.date<'2026-10-12').map(x=>({...x,time:x.date})),lower:23835.68,upper:24354.11,participation:null,cutoff:'2026-10-12T08:45:00+08:00'}).version,'rule-weights-v1');
 // Extreme synthetic inputs still respect [0.10,0.70] and sum 1.
 const bars=close.candles.filter(x=>x.date<'2026-10-12').map(x=>({...x,time:x.date}));
 for(const [lo,hi] of [[10000,10001],[40000,40001],[24000,24300],[1,99999]]){
  const w=scoreScenarioWeights({bars,lower:lo,upper:hi,participation:null,cutoff:'2026-10-12T08:45:00+08:00'}).probabilities,v=Object.values(w);
  assert.equal(Math.round(v.reduce((s,x)=>s+x,0)*100),100);for(const x of v)assert.ok(x>=0.1-1e-9&&x<=0.7+1e-9);
 }
});
test('rule weights ignore data after the information cutoff',()=>{
 const {scoreScenarioWeights}=require('../scripts/daily-analysis.cjs');
 const close=require('./fixtures/hsi-close-2026-10-09.json'),part=require('./fixtures/hsi-participation-2026-10-09.json');
 const live={date:'2026-10-12',feed:close,seed,participation:part,generatedAt:'2026-10-12T08:45:30+08:00'},base=build(live);
 const polluted=structuredClone(close);polluted.candles.push({date:'2026-10-12',open:30000,high:31000,low:29000,close:30500});
 assert.deepEqual(build({...live,feed:polluted}).forecast.scenarios,base.forecast.scenarios);
 // A participation snapshot published after the cutoff, or for another session, is ignored.
 const late={...part,updated_at:'2026-10-12T09:00:00+08:00'},other={...part,as_of:'2026-10-08'};
 for(const p of [late,other])assert.deepEqual(build({...live,participation:p}).forecast.scenarios.map(s=>s.probability),base.forecast.scenarios.map(s=>s.probability));
 const bars=close.candles.map(x=>({...x,time:x.date}));
 assert.throws(()=>scoreScenarioWeights({bars,lower:23835.68,upper:24354.11,cutoff:'2026-10-09T08:45:00+08:00'}),/after cutoff/);
 // Backfill reconstructions keep probability null by default (frozen supplements unchanged).
 assert.equal(build(args).forecast.scenarios.every(s=>s.probability===null),true);
});
test('multi-class Brier score with shared/no-outcome rules',()=>{
 const {brierScore}=require('../scripts/publish-daily-analysis.cjs');
 const sc=[{id:'A',probability:0.3},{id:'B',probability:0.5},{id:'C',probability:0.2}],v=m=>['A','B','C'].map((id,i)=>({id,met:m[i]}));
 assert.equal(brierScore(sc,v([false,true,false])).brier,0.38);
 assert.equal(brierScore(sc,v([true,false,false])).brier,0.78);
 const shared=brierScore(sc,v([true,true,false]));assert.equal(shared.brier,0.08);assert.equal(shared.brier_status,'scored_shared_outcome');
 const none=brierScore(sc,v([false,false,false]));assert.equal(none.brier,null);assert.equal(none.brier_status,'no_outcome_met');
 const legacy=brierScore(sc.map(s=>({...s,probability:null})),v([false,true,false]));assert.equal(legacy.brier,null);assert.equal(legacy.brier_status,'no_probability');
});
test('chart shows rule weights with version note and keeps legacy null cards as uncalibrated',()=>{
 const html=fs.readFileSync(require.resolve('../investment/chart/index.html'),'utf8');
 const vm=require('node:vm'),src=html.slice(html.indexOf('  function ruleWeightModel('),html.indexOf('  function participationEvaluation('));
 const ctx={escapeHtml:s=>String(s),Number};vm.createContext(ctx);vm.runInContext(src,ctx);
 const a=build({date:'2026-10-12',feed:require('./fixtures/hsi-close-2026-10-09.json'),seed,participation:require('./fixtures/hsi-participation-2026-10-09.json'),generatedAt:'2026-10-12T08:45:30+08:00'});
 assert.equal(ctx.ruleWeightModel(a),'rule-weights-v3');assert.match(ctx.ruleWeightNoteHtml(a,a.forecast.scenarios[0]),/模型 v3 · v4 回退（盘前隔夜数据不可用；实盘已打分 0 次）/);
 const a4=build({date:'2026-10-12',feed:require('./fixtures/hsi-close-2026-10-09.json'),seed,participation:require('./fixtures/hsi-participation-2026-10-09.json'),overnight:require('./fixtures/overnight-2026-10-12.json'),generatedAt:'2026-10-12T08:45:30+08:00'});
 assert.equal(ctx.ruleWeightModel(a4),'rule-weights-v4');assert.match(ctx.ruleWeightNoteHtml(a4,a4.forecast.scenarios[0]),/模型 v4（含盘前隔夜美股\/ETF；2016–2025 滚动回测 10\/10 年优于重训 v3；实盘已打分 0 次）/);
 // Legacy v3 analyses (published 2026-10-12, no fallback field) keep their original label.
 const legacy=structuredClone(a);delete legacy.forecast.weight_model_info.fallback;assert.match(ctx.ruleWeightNoteHtml(legacy,legacy.forecast.scenarios[0]),/模型 v3（两年回测，保留集优于 v1；实盘已打分 0 次）/);
 assert.equal(ctx.ruleWeightModel(build(args)),null);
 const MP=require('../investment/chart/market-participation.js'),ev=MP.evaluate(require('./fixtures/hsi-participation-2026-10-09.json'),a.forecast.scenarios,'2026-10-09');
 assert.equal(ev.already_in_base,true);assert.deepEqual(Object.values(ev.weights).map(v=>Math.round(v*100)),a.forecast.scenarios.map(s=>Math.round(s.probability*100)));assert.equal(ctx.ruleWeightModel(seed),null);
 assert.match(html,/'% 权重' : '权重未校准'/);assert.match(html,/主情景 · /);
});

test('v2 completed-bar factors and Nison patterns have deterministic directional effects',()=>{
 const {candlePattern,scoreScenarioWeights,WEIGHT_MODEL}=require('../scripts/daily-analysis.cjs');
 const c=(o,h,l,close)=>({open:o,high:h,low:l,close});
 assert.equal(candlePattern(c(10,11,8,9),c(8.5,12,8,11.5)).name,'bullish_engulfing');
 assert.equal(candlePattern(c(9,11,8,10.5),c(11,11.2,8,8.8)).name,'bearish_engulfing');
 assert.equal(candlePattern(c(12,13,9,10),c(9,12,8,11.5)).name,'piercing');
 assert.equal(candlePattern(c(10,12,9,11),c(13,14,7,13.05)).name,'doji');
 const close=require('./fixtures/hsi-close-2026-10-09.json');const bars=close.candles.filter(x=>x.date<'2026-10-12').map(x=>({...x,time:x.date}));
 const {WEIGHT_MODEL_V2}=require('../scripts/daily-analysis.cjs');const x=scoreScenarioWeights({bars,lower:23835.68,upper:24354.11,participation:null,cutoff:'2026-10-12T08:45:00+08:00',model:WEIGHT_MODEL_V2});
 assert.equal(x.version,'rule-weights-v2.1');assert.equal(x.weight_factors.length,6);assert.equal(x.weight_factors.find(f=>f.name==='regime_gate').raw.range,false);assert.equal(x.weight_factors.find(f=>f.name==='regime_gate').raw.trend,'down');
 const vals=Object.values(x.probabilities);assert.equal(vals.reduce((a,b)=>a+b,0),1);for(const v of vals)assert.ok(v>=.1&&v<=.7);
});

test('v2.1 regime: monotonic up/down swings are trends, mixed swings are range', () => {
 const {pivotState}=require('../scripts/daily-analysis.cjs');
 // Explicit swing points: each swing is a 5-bar tent so width=2 pivots are unambiguous.
 // Linear legs between explicit swing points (4 bars per leg) so width=2 pivots land exactly on the swings.
 const series=(pts)=>{const bars=[];for(let k=0;k<pts.length-1;k++)for(let j=0;j<4;j++){const v=pts[k]+(pts[k+1]-pts[k])*j/4;bars.push({date:'d'+bars.length,time:bars.length,open:v,high:v+1,low:v-1,close:v});}const v=pts.at(-1);for(let j=0;j<3;j++)bars.push({date:'d'+bars.length,time:bars.length,open:v,high:v+1-(j+1)*3,low:v-1-(j+1)*3,close:v-(j+1)*3});return bars;};
 const up=series([100,120,110,130,118,140,128]);
 const down=series([140,120,130,110,122,100,112]);
 const mixed=series([100,140,110,130,105,135,115]);
 assert.equal(pivotState(up).trend,'up');assert.equal(pivotState(up).higher_highs,true);assert.equal(pivotState(up).higher_lows,true);
 assert.equal(pivotState(down).trend,'down');assert.equal(pivotState(down).lower_highs,true);assert.equal(pivotState(down).lower_lows,true);
 assert.equal(pivotState(mixed).trend,'range');
});
test('v2.1 sakata new values count chronologically', () => {
 const {sakataNewValues}=require('../scripts/daily-analysis.cjs');
 const b=c=>({close:c});
 assert.deepEqual(sakataNewValues([b(100),b(110),b(120),b(130)],105,90),{up:3,down:0});
 assert.deepEqual(sakataNewValues([b(100),b(130),b(120),b(110)],105,90),{up:1,down:0});
 assert.deepEqual(sakataNewValues([b(100),b(85),b(80),b(75)],105,90),{up:0,down:3});
 assert.deepEqual(sakataNewValues([b(100),b(75),b(80),b(85)],105,90),{up:0,down:1});
 assert.deepEqual(sakataNewValues([b(110),b(120),b(85)],105,90),{up:0,down:1});
});

test('rule-weights-v4 is the production default; v3/v1 are recorded as shadows',()=>{
 const V4=require('../scripts/v4-weights.cjs'),V3=require('../scripts/weights-v3.cjs');
 const close=require('./fixtures/hsi-close-2026-10-09.json'),part=require('./fixtures/hsi-participation-2026-10-09.json'),ovn=require('./fixtures/overnight-2026-10-12.json');
 const live={date:'2026-10-12',feed:close,seed,participation:part,overnight:ovn,generatedAt:'2026-10-12T08:45:30+08:00'};
 const a=build(live),b=build(live),p=a.forecast.scenarios.map(s=>s.probability);
 assert.deepEqual(a,b);assert.equal(a.forecast.weight_model,'rule-weights-v4');assert.equal(a.forecast.weight_model_info.version,'rule-weights-v4');
 assert.equal(a.forecast.weight_model_info.fallback,null);
 assert.equal(Math.round(p.reduce((s,v)=>s+v,0)*100),100);for(const v of p){assert.ok(v>=0.1-1e-9&&v<=0.85+1e-9);assert.equal(Math.abs(v*20-Math.round(v*20))<1e-9,true);}
 assert.equal(a.forecast.scenarios.every(s=>s.probability_locked===true&&s.probability_model==='rule-weights-v4'&&/逻辑回归 v4/.test(s.probability_basis)&&/盘前隔夜/.test(s.probability_basis)),true);
 // shadows: v3 and v1 computed on the same completed bars, exactly as their own scorers produce them
 const bars=close.candles.filter(x=>x.date<'2026-10-12').map(x=>({...x,time:x.date})),[lower,upper]=[a.forecast.scenarios[1].price_rule.lower,a.forecast.scenarios[1].price_rule.upper];
 const v3=V3.scoreScenarioWeightsV3({bars,lower,upper,cutoff:'2026-10-12T08:45:30+08:00'}).probabilities;
 assert.deepEqual(a.forecast.weight_model_info.shadow['rule-weights-v3'],v3);assert.deepEqual(a.forecast.weight_model_info.factors.shadow_v3,v3);
 assert.deepEqual(a.forecast.weight_model_info.shadow['rule-weights-v1'],{A:0.3,B:0.5,C:0.2});
 assert.deepEqual(a.forecast.weight_model_info.coefficients.W,V4.WEIGHT_MODEL_V4.W);
 assert.equal(a.environment_evidence.overnight.status,'available');assert.equal(a.environment_evidence.overnight.us_close_date,'2026-10-09');
 assert.match(a.forecast.reasoning.join('\n'),/权重模型：v4/);assert.match(a.disclaimer,/rule-weights-v4/);
 // build() == direct v4 scorer on the same inputs (futu OHLC + Yahoo HSI volume)
 const vol=new Map(ovn.series.HSI.map(r=>[r.date,r.volume]));
 const direct=V4.scoreScenarioWeightsV4({bars:bars.map(x=>({...x,volume:vol.get(x.date)})),lower,upper,cutoff:'2026-10-12T08:45:30+08:00',overnight:ovn.series});
 assert.deepEqual(Object.values(a.forecast.scenarios.map(s=>s.probability)),[direct.probabilities.A,direct.probabilities.B,direct.probabilities.C]);
 // participation display never re-tilts locked v4 weights
 const MP=require('../investment/chart/market-participation.js'),ev=MP.evaluate(part,a.forecast.scenarios,'2026-10-09');assert.equal(ev.already_in_base,true);
 // v4 reproduces the frozen research reference for a historical session through the production build()
 const spec=require('../research/v4/model-v4.json'),ref=spec.reference_2026.find(r=>r.date==='2026-10-09');
 const h=build({date:'2026-10-09',feed:require('./fixtures/hsi-preopen-2026-10-09.json'),seed:null,overnight:{...ovn,fetched_at:'2026-10-09T08:44:00+08:00'},generatedAt:'2026-10-09T08:45:30+08:00'});
 assert.equal(h.forecast.weight_model,'rule-weights-v4');assert.deepEqual(h.forecast.scenarios.map(s=>s.probability),ref.p);
});

test('v4 fails closed to v3 with annotations when overnight inputs are missing, late, stale or inconsistent',()=>{
 const V3=require('../scripts/weights-v3.cjs');
 const close=require('./fixtures/hsi-close-2026-10-09.json'),ovn=require('./fixtures/overnight-2026-10-12.json');
 const live={date:'2026-10-12',feed:close,seed,participation:null,generatedAt:'2026-10-12T08:45:30+08:00'};
 const bars=close.candles.filter(x=>x.date<'2026-10-12').map(x=>({...x,time:x.date}));
 const drop=(k,f)=>({...ovn,series:{...ovn.series,[k]:f(ovn.series[k])}});
 const cases=[
  [null,/未提供盘前隔夜数据/],
  [{status:'unavailable',fetched_at:'2026-10-12T08:44:00+08:00',errors:['EWH (EWH) unavailable: HTTP 429'],series:{}},/拉取失败.*HTTP 429/],
  [{...ovn,fetched_at:'2026-10-12T08:50:00+08:00'},/晚于信息截止/],
  [drop('EWH',()=>[]),/缺少隔夜序列 EWH/],
  [drop('VIX',()=>undefined),/缺少隔夜序列 VIX/],
  [drop('CNY',r=>r.filter(x=>x.date<'2026-10-01')),/USD\/CNY 已过期/],
  [drop('FXI',r=>r.filter(x=>x.date<'2026-10-09')),/最新收盘日期不一致/],
  [{...ovn,series:Object.fromEntries(Object.entries(ovn.series).map(([k,v])=>[k,k==='HSI'?v:v.filter(x=>x.date<'2026-10-01')]))},/已过期/],
  [drop('HSI',r=>r.map(x=>x.date==='2026-10-08'?{...x,volume:null}:x)),/成交量不完整/],
  [drop('HSI',r=>r.map(x=>x.date==='2026-10-09'?{...x,close:x.close*1.01}:x)),/收盘与生产K线不一致/],
  [drop('EWH',r=>r.map(x=>x.date==='2026-10-09'?{...x,close:NaN}:x)),/最新收盘日期不一致/],
 ];
 const v3=V3.scoreScenarioWeightsV3({bars,lower:23835.68,upper:24354.11,cutoff:'2026-10-12T08:45:30+08:00'}).probabilities;
 for(const [overnight,re] of cases){
  const a=build({...live,overnight}),info=a.forecast.weight_model_info;
  assert.equal(a.forecast.weight_model,'rule-weights-v3');assert.deepEqual(info.fallback.intended,'rule-weights-v4');assert.equal(info.fallback.used,'rule-weights-v3');assert.match(info.fallback.reason,re);
  assert.deepEqual(Object.fromEntries(a.forecast.scenarios.map(s=>[s.id,s.probability])),v3);
  assert.equal(a.forecast.scenarios.every(s=>/已回退 v3/.test(s.probability_basis)),true);
  assert.match(a.forecast.reasoning.join('\n'),/回退 v3，不用空值或插值/);assert.equal(a.environment_evidence.overnight.status,'unavailable');
  assert.match(a.disclaimer,/已回退/);assert.equal(info.shadow['rule-weights-v1'].B,0.5);
 }
 // overnight rows dated on/after the session (US data not yet closed at 08:45) never change a v4 result
 const base=build({...live,overnight:ovn});
 const poisoned={...ovn,series:Object.fromEntries(Object.entries(ovn.series).map(([k,v])=>[k,[...v,{date:'2026-10-12',close:1e9,volume:1}]]))};
 assert.deepEqual(build({...live,overnight:poisoned}).forecast.scenarios,base.forecast.scenarios);
});

test('preopen publisher falls back to v3 (not a failure) when the overnight fetch fails',async()=>{
 const os=require('node:os'),path=require('node:path'),{run}=require('../scripts/publish-daily-analysis.cjs');
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'daily-ovn-')),dir=path.join(tmp,'investment/chart');fs.mkdirSync(dir,{recursive:true});
 const err=console.error;console.error=()=>{};
 try {
  for(const [name,value] of [['annotations.json',seed],['kline_futu.json',require('./fixtures/hsi-close-2026-10-09.json')],['hsi-participation.json',{}]])fs.writeFileSync(path.join(dir,name),JSON.stringify(value));
  await run({projectRoot:tmp,now:Date.parse('2026-10-12T08:46:00+08:00'),fetchOvernight:async()=>{throw Error('network down');}});
  const a=JSON.parse(fs.readFileSync(path.join(dir,'annotations.json'),'utf8'));
  assert.equal(a.forecast.weight_model,'rule-weights-v3');assert.match(a.forecast.weight_model_info.fallback.reason,/network down/);
  assert.equal(Math.round(a.forecast.scenarios.reduce((s,x)=>s+x.probability,0)*100),100);
 } finally {console.error=err;fs.rmSync(tmp,{recursive:true});}
});

test('overnight fetcher normalises Yahoo bars like the research fetch and reports failures without throwing',async()=>{
 const P=require('../scripts/v4-preopen-data.cjs');
 const chart=(ts,close)=>({chart:{result:[{timestamp:ts,indicators:{quote:[{open:close,high:close,low:close,close,volume:close.map(()=>5)}]}}]}});
 // 2026-10-09 13:30Z (09:30 ET) -> US date 2026-10-09; null close dropped, never filled
 const rows=P.normalise(chart([1791552600,1791639000],[22.06,null]),-5,false);assert.deepEqual(rows,[{date:'2026-10-09',close:22.06}]);
 const ok=await P.fetchOvernight({now:Date.parse('2026-10-12T08:44:00+08:00'),fetchImpl:async()=>({ok:true,json:async()=>chart([1791552600],[10])})});
 assert.equal(ok.status,'available');assert.deepEqual(Object.keys(ok.series).sort(),['CNY','EWH','FXI','GSPC','HSI','IXIC','KWEB','VIX']);
 const bad=await P.fetchOvernight({fetchImpl:async(u)=>u.includes('KWEB')?{ok:false,status:404}:{ok:true,json:async()=>chart([1791552600],[10])}});
 assert.equal(bad.status,'unavailable');assert.equal(bad.errors.length,1);assert.match(bad.errors[0],/KWEB/);assert.equal(bad.series.KWEB,undefined);
});

test('round1 A1: live A/C cards are display-only with T+1 close-zone probability definition; backfills unchanged',()=>{
 const DA=require('../scripts/daily-analysis.cjs'),close=require('./fixtures/hsi-close-2026-10-09.json');
 const live=build({date:'2026-10-12',feed:close,seed,participation:null,generatedAt:'2026-10-12T08:45:30+08:00'});
 const by=Object.fromEntries(live.forecast.scenarios.map(s=>[s.id,s]));
 assert.equal(by.A.execution_status,'display_only');assert.equal(by.C.execution_status,'display_only');assert.equal(by.B.execution_status,'plan_candidate');
 assert.match(by.A.execution_note,/仅展示·不推荐执行/);assert.match(by.C.execution_note,/−0\.39R/);assert.equal(by.B.execution_note,undefined);
 for(const s of live.forecast.scenarios)assert.match(s.probability_definition,/次日收盘落在哪个区间/);
 assert.deepEqual(live.forecast.execution_policy.display_only,['A','C']);assert.equal(live.forecast.probability_definition,DA.PROBABILITY_DEFINITION);
 // probabilities/levels themselves are unchanged by the policy
 const off=build({date:'2026-10-12',feed:close,seed,participation:null,generatedAt:'2026-10-12T08:45:30+08:00',executionPolicy:false});
 assert.deepEqual(off.forecast.scenarios.map(s=>[s.probability,s.rr,s.price_rule]),live.forecast.scenarios.map(s=>[s.probability,s.rr,s.price_rule]));
 for(const s of build(args).forecast.scenarios){assert.equal(s.execution_status,undefined);assert.equal(s.probability_definition,undefined);}
 assert.equal(build(args).forecast.execution_policy,undefined);
});
test('round1 A1: chart renders display-only A/C as observation cards and no longer says 具备可执行赔率',()=>{
 const html=fs.readFileSync(require.resolve('../investment/chart/index.html'),'utf8');
 assert.match(html,/if \(scenarioDisplayOnly\(sc\) \|\| !scenarioRREligible\(sc\)\)/);assert.match(html,/仅展示·不推荐执行/);assert.match(html,/次日收盘落在哪个区间/);
 const vm=require('node:vm'),start=html.indexOf('  function scenarioDisplayOnly('),src=html.slice(start,html.indexOf('  function fmtRatio(',start));
 const ctx={escapeHtml:s=>String(s)};vm.createContext(ctx);vm.runInContext(src,ctx);
 assert.equal(ctx.scenarioDisplayOnly({execution_status:'display_only'}),true);assert.equal(ctx.scenarioDisplayOnly({}),false);
 assert.equal(ctx.probabilityDefinitionHtml({}),'');assert.match(ctx.probabilityDefinitionHtml({probability_definition:'x'}),/次日收盘落在哪个区间/);
 assert.doesNotMatch(MR.rr(100,130,90,'long').verdict,/具备可执行/);assert.equal(MR.rr(100,130,90,'long').executable,true);
});

test('round1 A4: disaster stop shadow mode — 2.5σ and turtle 2N computed, but disaster_stop stays not_configured',()=>{
 const DA=require('../scripts/daily-analysis.cjs'),TO=require('../investment/chart/trading-operation.js');
 const sh=DA.disasterStopShadow({direction:'long',structural:24000,entry:24300,atr14:300,ewma:0.01,n20:250,close:24300});
 assert.equal(sh.status,'shadow');assert.equal(sh.published,false);
 const s=sh.versions.sigma_2_5,t=sh.versions.turtle_2n;
 assert.equal(s.sigma_source,'ATR14');assert.equal(s.price,24000-2.5*300);assert.equal(t.price,24300-2*250);
 assert.equal(s.position_sizing.units_per_10k_risk,Math.round(10000/(24300-23250)*10000));assert.equal(s.position_sizing.point_value_hkd,1/10000);
 assert.equal(s.position_sizing.futures_contracts_per_10k_risk,Math.round(10000/1050/50*1000)/1000);assert.match(s.position_sizing.futures_note,/50 港元/);
 const sh2=DA.disasterStopShadow({direction:'short',structural:24500,entry:24000,atr14:200,ewma:0.012,n20:220,close:24000});
 assert.equal(sh2.versions.sigma_2_5.sigma_source,'EWMA');assert.equal(sh2.versions.sigma_2_5.price,24500+2.5*288);assert.equal(sh2.versions.turtle_2n.price,24000+440);
 assert.equal(DA.disasterStopShadow({direction:'long',structural:1,entry:2,atr14:null,ewma:.01,n20:null,close:2}).versions.turtle_2n.status,'insufficient_input');
 // Turtle N uses completed bars only and the documented recursion
 const bars=[{high:11,low:9,close:10}];for(let i=1;i<30;i++)bars.push({high:10+i%3,low:9-i%2,close:10});
 const tr=bars.slice(1).map((b,i)=>Math.max(b.high-b.low,Math.abs(b.high-bars[i].close),Math.abs(b.low-bars[i].close)));let N=tr.slice(0,20).reduce((a,b)=>a+b,0)/20;for(let i=20;i<tr.length;i++)N=(19*N+tr[i])/20;
 assert.ok(Math.abs(DA.turtleN(bars)-N)<1e-12);assert.equal(DA.turtleN(bars.slice(0,10)),null);
 const close=require('./fixtures/hsi-close-2026-10-09.json');
 const live=build({date:'2026-10-12',feed:close,seed,participation:null,generatedAt:'2026-10-12T08:45:30+08:00'});
 for(const sc of live.forecast.scenarios){
  assert.deepEqual(sc.risk.disaster_stop,{price:null,status:'not_configured'});assert.equal(sc.risk.position_sizing,undefined);
  const v=sc.risk.disaster_stop_shadow.versions,si=sc.risk.structural_invalidation.price;
  if(sc.direction==='long'){assert.ok(v.sigma_2_5.price<si);assert.ok(v.turtle_2n.price<sc.rr.entry);}else{assert.ok(v.sigma_2_5.price>si);assert.ok(v.turtle_2n.price>sc.rr.entry);}
 }
 // decision contract unchanged: risk is still unsupported
 const op=TO.build({annotations:live,scenarioStatus:null,now:Date.parse('2026-10-12T08:50:00+08:00')});
 assert.equal(op.sections.find(s=>s.id==='risk_controls').data.scenarios.every(s=>s.disaster_stop_status==='unavailable'),true);
 for(const sc of build(args).forecast.scenarios)assert.equal(sc.risk.disaster_stop_shadow,undefined);
});

test('round1 B2: target rule v2 (>=1R, beyond last close) is available but production default stays v1',()=>{
 const close=require('./fixtures/hsi-close-2026-10-09.json'),live={date:'2026-10-12',feed:close,seed,participation:null,generatedAt:'2026-10-12T08:45:30+08:00'};
 const a=build(live),b=build({...live,targetRule:'v1'});assert.deepEqual(a.forecast.scenarios.map(s=>s.rr),b.forecast.scenarios.map(s=>s.rr));
 assert.equal(a.forecast.scenarios.every(s=>s.rr.target_rule===undefined),true);
 const v2=build({...live,targetRule:'v2'}),last=close.candles.at(-1).close;
 for(const s of v2.forecast.scenarios){const r=s.rr;assert.equal(r.target_rule.version,'target-v2');if(r.target==null)continue;
  const risk=Math.abs(r.entry-r.stop);if(r.direction==='long'){assert.ok(r.target-r.entry>=risk);assert.ok(r.target>last);}else{assert.ok(r.entry-r.target>=risk);assert.ok(r.target<last);}}
});
