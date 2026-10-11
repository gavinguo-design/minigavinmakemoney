const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'), path=require('node:path'), vm=require('node:vm');
const MR=require('../investment/chart/market-rules.js');
const TradingOperation=require('../investment/chart/trading-operation.js');
const {build}=require('../scripts/daily-analysis.cjs');
const read=p=>JSON.parse(fs.readFileSync(path.join(__dirname,p),'utf8'));
const at=s=>Date.parse(s+'+08:00');
const now=at('2026-10-09T10:20:00');
const analysis=()=>build({date:'2026-10-09',feed:read('fixtures/hsi-preopen-2026-10-09.json'),seed:read('fixtures/annotations-2026-10-06.json'),participation:read('fixtures/hsi-participation-2026-10-06.json'),generatedAt:'2026-10-09T08:45:00+08:00'});
const quote=(price,when=now)=>({price,ts:when/1000,source:'test-quote'});
const selected=s=>s.scenarios.filter(x=>x.triggered).map(x=>x.id);
const html=fs.readFileSync(path.join(__dirname,'../investment/chart/index.html'),'utf8');
function extract(name){const start=html.indexOf('  function '+name+'(');assert.ok(start>=0,name);return html.slice(start,html.indexOf('\n  }',start)+4);}

test('a 30-minute-old status is replaced by the frozen rule evaluated at the current source quote',()=>{
  const a=analysis(), original=JSON.stringify(a), old=read('../investment/chart/scenario_status.json');
  const oldBytes=JSON.stringify(old), middle=(a.forecast.scenarios[1].price_rule.lower+a.forecast.scenarios[1].price_rule.upper)/2;
  const s=MR.resolveScenarioStatus(a,old,[quote(middle)],now);
  assert.equal(s.analysis_id,a.meta.analysis_id);assert.equal(s.conditions_date,'2026-10-09');
  assert.equal(s.judgment_mode,'intraday_preview');assert.deepEqual(selected(s),['B']);
  assert.equal(MR.timestamp(s.updated_at),now);assert.equal(MR.statusIssue(s,a,now),null);
  assert.equal(s.metrics.southbound_net_yi,null);assert.equal(s.metrics.volume_ratio,undefined);
  assert.equal(JSON.stringify(a),original);assert.equal(JSON.stringify(old),oldBytes);
});
test('crossing both exact frozen boundaries updates A, B, C without gaps or overlap',()=>{
  const a=analysis(), {lower,upper}=a.forecast.scenarios[1].price_rule;
  for(const [price,id] of [[lower-0.01,'C'],[lower,'B'],[upper-0.01,'B'],[upper,'A'],[upper+100,'A']]){
    assert.deepEqual(selected(MR.resolveScenarioStatus(a,null,[quote(price)],now)),[id]);
  }
});
test('old, future, missing and nonfinite quotes cannot gain freshness from another download',()=>{
  const a=analysis();
  for(const q of [null,quote(24000,now-6*60000),quote(24000,now+2*60000),quote(NaN),quote(-1),{price:24000},quote(24000,at('2026-10-08T16:30:00'))]){
    assert.equal(MR.resolveScenarioStatus(a,null,[q],now),null);
  }
  const old=MR.resolveScenarioStatus(a,null,[quote(24000)],now);
  assert.equal(MR.resolveScenarioStatus(a,old,[quote(24000)],now+6*60000),null);
});
test('the newest usable quote wins and a stale primary does not suppress a fresh fallback',()=>{
  const a=analysis(), upper=a.forecast.scenarios[1].price_rule.upper;
  assert.deepEqual(selected(MR.resolveScenarioStatus(a,null,[quote(upper-1,now-360000),quote(upper,now-1000)],now)),['A']);
  assert.equal(MR.resolveScenarioStatus(a,null,[quote(upper,now-1000),quote(upper-1,now-2000)],now).metrics.price,upper);
});
test('previous-day rules, hindsight supplements, missing identity and malformed partitions fail closed',()=>{
  const variations=[a=>a.forecast.applicable_date='2026-10-08',a=>a.publication.kind='retrospective_backfill',a=>delete a.meta.analysis_id,
    a=>a.publication.eligible_as_new_prediction=false,a=>a.publication.generated_at='2026-10-09T10:00:00+08:00',
    a=>a.publication.information_cutoff='2026-10-09T10:00:00+08:00',a=>a.publication.baseline_date='2026-10-07',
    a=>a.forecast.scenarios[0].price_rule.value+=1,a=>a.forecast.scenarios[2].id='A',a=>a.forecast.scenarios.pop(),a=>a.forecast.scenarios[0]=null];
  for(const change of variations){const a=analysis();change(a);assert.equal(MR.resolveScenarioStatus(a,null,[quote(24000)],now),null);}
});
test('lunch accepts a latest-morning quote and closing auction stays a preview',()=>{
  const a=analysis(), q=quote(24000,at('2026-10-09T11:59:00'));
  assert.equal(MR.resolveScenarioStatus(a,null,[q],at('2026-10-09T12:30:00')).judgment_mode,'intraday_preview');
  assert.equal(MR.resolveScenarioStatus(a,null,[quote(24000,at('2026-10-09T11:40:00'))],at('2026-10-09T12:30:00')),null);
  assert.equal(MR.resolveScenarioStatus(a,null,[quote(24000,at('2026-10-09T16:05:00'))],at('2026-10-09T16:06:00')).judgment_mode,'intraday_preview');
});
test('quotes cannot create a completed close; an independently published valid close remains unchanged',()=>{
  const a=analysis(), when=at('2026-10-09T16:30:00'), q=quote(24000,when);
  assert.equal(MR.resolveScenarioStatus(a,null,[q],when),null);
  const final={...MR.resolveScenarioStatus(a,null,[quote(24000)],now),judgment_mode:'close_final',updated_at:'2026-10-09T16:20:00+08:00'};
  const original=JSON.stringify(final), resolved=MR.resolveScenarioStatus(a,final,[quote(26000,when)],when);
  assert.equal(resolved.metrics.price,24000);assert.equal(resolved.judgment_mode,'close_final');
  assert.equal(JSON.stringify(final),original);
  assert.equal(MR.resolveScenarioStatus(a,{...final,analysis_id:'wrong'},[q],when),null);
});
test('preopen, holidays, weekends and half-day close do not fabricate intraday judgments',()=>{
  const a=analysis();
  for(const time of ['2026-10-09T09:20:00','2026-10-10T10:20:00','2026-10-19T10:20:00']){
    const t=at(time);assert.equal(MR.resolveScenarioStatus(a,null,[quote(24000,t)],t),null);
  }
  const half=analysis();half.meta.analysis_id='test-half-day';half.forecast.applicable_date='2026-12-24';
  Object.assign(half.publication,{session_date:'2026-12-24',baseline_date:'2026-12-23',generated_at:'2026-12-24T08:45:00+08:00',information_cutoff:'2026-12-24T08:45:00+08:00'});
  const t=at('2026-12-24T12:10:00');assert.equal(MR.resolveScenarioStatus(half,null,[quote(24000,t)],t),null);
});
test('a price-preview match never becomes a formally triggered trading decision',()=>{
  const a=analysis(), q=quote(a.forecast.scenarios[0].price_rule.value+1);
  const status=MR.resolveScenarioStatus(a,null,[q],now);
  const result=TradingOperation.build({annotations:a,scenarioStatus:status,dailyBars:[],quote:q,now});
  assert.equal(result.action_state,'no_trade');
  assert.equal(result.sections.find(x=>x.id==='trigger_confirmation').data.daily_confirmation,'not_confirmed');
});
test('actual checklist rendering follows quote changes for all three cards, then clears stale judgments',()=>{
  let clock=now;
  const a=analysis(), cards=a.forecast.scenarios.map((sc,i)=>({getAttribute:()=>String(i),nodes:{},querySelector(sel){return this.nodes[sel]||(this.nodes[sel]={innerHTML:'',outerHTML:''});}}));
  const context=vm.createContext({MarketRules:{...MR,resolveScenarioStatus:(...args)=>MR.resolveScenarioStatus(...args,clock),statusIssue:(s,a)=>MR.statusIssue(s,a,clock)},Date:class extends Date{static now(){return clock;}},
    viewingDate:null,annotations:a,storedScenarioStatus:null,scenarioStatus:null,realtimeData:quote(23000),yahooQuote:null,currentBars:[],currentIv:'1d',
    document:{querySelectorAll:()=>cards},escapeHtml:s=>String(s),fmt:String,scenarioEvidenceHtml:()=>'',scenarioLiveRRHtml:()=>'',scenarioRefPrice:()=>24000});
  for(const name of ['statusForScenario','jmBadgeHtml','signalStateForScenario','scenarioBadgeHtml','scenarioChecklistHtml','refreshScenarioChecklists']) vm.runInContext(extract(name),context);
  context.refreshScenarioChecklists();
  assert.match(cards[2].nodes['.sc-status'].outerHTML,/若收盘则触发/);
  for(const c of cards)assert.match(c.nodes['.sc-checklist-holder'].innerHTML,/盘中预览/);
  clock+=30000;context.realtimeData=quote(26000,clock);context.refreshScenarioChecklists();
  assert.match(cards[0].nodes['.sc-status'].outerHTML,/若收盘则触发/);
  assert.doesNotMatch(cards[2].nodes['.sc-status'].outerHTML,/若收盘则触发/);
  clock+=6*60000;context.refreshScenarioChecklists();
  for(const c of cards)assert.match(c.nodes['.sc-checklist-holder'].innerHTML,/条件数据未加载/);
  const preserved=cards.map(c=>c.nodes['.sc-checklist-holder'].innerHTML);
  context.viewingDate='2026-10-08';context.realtimeData=quote(25000,clock);context.refreshScenarioChecklists();
  assert.deepEqual(cards.map(c=>c.nodes['.sc-checklist-holder'].innerHTML),preserved);
});
test('a rejected network request and a rendering failure both leave the next quote poll scheduled',async()=>{
  for(const renderingFailure of [false,true]){
    const scheduled=[];let refreshed=0;
    const c=vm.createContext({MarketRules:{session:()=>({phase:'open'})},realtimeTimer:null,clearTimeout(){},setTimeout:(fn,delay)=>{scheduled.push({fn,delay});return scheduled.length;},
      refreshScenarioChecklists:()=>refreshed++,updateDataQuality(){},fetchRealtime:()=>renderingFailure?Promise.resolve({price:24000}):Promise.reject(Error('offline')),applyRealtime:()=>{throw Error('render failure');}});
    vm.runInContext(extract('scheduleRealtime'),c);c.scheduleRealtime();scheduled[0].fn();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(scheduled.length,2);assert.equal(scheduled[1].delay,30000);assert.equal(refreshed,2);
  }
});
test('manual refresh waits for K-line completion and removes its busy state even on errors',async()=>{
  let finishBars, busy=false;
  const fab={classList:{contains:()=>busy,add:()=>busy=true,remove:()=>busy=false}};
  const c=vm.createContext({document:{getElementById:()=>fab},technicalPanel:{refresh(){}},fetchAnnotations:async()=>null,fetchScenarioStatus:async()=>null,fetchRealtime:async()=>null,applyRealtime(){},
    refreshParticipation:async()=>{},refreshMirror:async()=>{},currentIv:'1d',loadInterval:()=>new Promise(resolve=>finishBars=resolve),refreshScenarioChecklists(){},updateDataQuality(){}});
  vm.runInContext(extract('refreshAllData'),c);const pending=c.refreshAllData();
  await new Promise(resolve=>setImmediate(resolve));assert.equal(busy,true);finishBars();await pending;assert.equal(busy,false);
  c.loadInterval=()=>Promise.reject(Error('offline'));await assert.rejects(c.refreshAllData(),/offline/);assert.equal(busy,false);
});
