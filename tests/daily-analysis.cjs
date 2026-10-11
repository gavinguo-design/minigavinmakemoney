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
  const latest=require('../investment/chart/kline_futu.json');
  for(const [name,value] of [['annotations.json',seed],['kline_futu.json',latest],['hsi-participation.json',{}]])fs.writeFileSync(path.join(dir,name),JSON.stringify(value));
  await run({projectRoot:tmp,now:Date.parse('2026-10-12T08:46:00+08:00')});
  const frozen=fs.readFileSync(path.join(dir,'annotations.json'),'utf8');
  await run({projectRoot:tmp,now:Date.parse('2026-10-12T09:05:00+08:00')});
  assert.equal(fs.readFileSync(path.join(dir,'annotations.json'),'utf8'),frozen);
  const a=JSON.parse(frozen);assert.equal(a.forecast.baseDate,'2026-10-09');assert.equal(a.forecast.applicable_date,'2026-10-12');
  await assert.rejects(run({projectRoot:tmp,phase:'postclose',now:Date.parse('2026-10-12T16:20:00+08:00')}),/Missing completed/);
  const after={...latest,updated_at:'2026-10-12T16:15:00+08:00',candles:[...latest.candles,{date:'2026-10-12',open:24211,high:24500,low:24100,close:24400}]};
  fs.writeFileSync(path.join(dir,'kline_futu.json'),JSON.stringify(after));
  await run({projectRoot:tmp,phase:'postclose',now:Date.parse('2026-10-12T16:20:00+08:00')});
  assert.equal(fs.readFileSync(path.join(dir,'annotations.json'),'utf8'),frozen);
  const status=JSON.parse(fs.readFileSync(path.join(dir,'scenario_status.json'),'utf8'));assert.equal(status.analysis_id,a.meta.analysis_id);assert.equal(status.scenarios.filter(s=>s.triggered).length,1);
  const review=JSON.parse(fs.readFileSync(path.join(dir,'daily-reviews/2026-10-12.json'),'utf8'));assert.equal(review.bar.date,'2026-10-12');assert.equal(review.brier,null);
 } finally {fs.rmSync(tmp,{recursive:true});}
});
