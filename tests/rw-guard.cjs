const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const G=require('../scripts/rw-guard.cjs'),DA=require('../scripts/daily-analysis.cjs');
const close=require('./fixtures/hsi-close-2026-10-09.json'),seed=require('../investment/chart/archive/2026-10-06.json'),ovn=require('./fixtures/overnight-2026-10-12.json');
const live={date:'2026-10-12',feed:close,seed,participation:null,overnight:ovn,generatedAt:'2026-10-12T08:45:30+08:00'};
const mk=(n,good,start='2025-01-01')=>Array.from({length:n},(_,i)=>{const d=new Date(Date.parse(start+'T00:00:00Z')+i*864e5).toISOString().slice(0,10);
  return {date:d,outcome:'B',v4:good?{A:.1,B:.8,C:.1}:{A:.45,B:.1,C:.45},rw:{A:.2,B:.6,C:.2}};});
test('rwGauss matches the FPP formula on completed bars and is rounded like production',()=>{
 const bars=close.candles,lower=23835.68,upper=24354.11,r=G.rwGauss({bars,lower,upper});
 const c=bars.slice(-61).map(b=>b.close),x=c.slice(1).map((v,i)=>Math.log(v/c[i])),m=x.reduce((a,b)=>a+b,0)/60,sd=Math.sqrt(x.reduce((a,b)=>a+(b-m)**2,0)/59);
 assert.ok(Math.abs(r.sigma60-sd)<1e-15);assert.ok(Math.abs(r.raw[0]-(1-G.normCdf(Math.log(upper/c.at(-1))/sd)))<1e-12);
 const rr=G.rwGauss({bars,lower,upper,round:DA.boundedRound});assert.ok(Math.abs(rr.probabilities.A+rr.probabilities.B+rr.probabilities.C-1)<1e-9);
 assert.throws(()=>G.rwGauss({bars:bars.slice(0,20),lower,upper}),/Insufficient/);
});
test('guard: warming up below 60, red after 10 sessions under WF p1, hysteresis resume, only past dates used',()=>{
 assert.equal(G.evaluateGuard(mk(30,true),'2026-01-01').status,'warming_up');
 const good=mk(80,true);assert.equal(G.evaluateGuard(good,'2026-01-01').use,'v4');
 const bad=[...good,...mk(80,false,'2025-03-22')],g=G.evaluateGuard(bad,'2026-01-01');assert.equal(g.status,'red');assert.equal(g.use,'rw');assert.ok(g.tripped_on);
 // future rows are ignored
 assert.deepEqual(G.evaluateGuard(bad,'2025-03-22'),G.evaluateGuard(good,'2025-03-22'));
 const rec=[...bad,...mk(90,true,'2025-06-10')];assert.equal(G.evaluateGuard(rec,'2026-01-01').use,'v4');
});
test('frozen seed reproduces the walk-forward stats in GUARD.wf and is green for 2026-10-20',()=>{
 const s=require('../research/v4/rw-guard-seed.json');
 for(const k of ['mean','mdd','roll60_p1','roll60_p5','roll60_p50'])assert.ok(Math.abs(s.wf_stats_2016_2025[k]-G.GUARD.wf[k])<1e-6,k);
 const h=G.guardHistory({seed:s});assert.equal(G.evaluateGuard(h,'2026-10-20').use,'v4');
 // live reviews supersede seed rows of the same date
 const h2=G.guardHistory({seed:s,reviews:[{session_date:'2026-10-09',verdicts:[{id:'A',met:true},{id:'B',met:false},{id:'C',met:false}],model_probabilities:{'rule-weights-v4':{A:.1,B:.8,C:.1},'rw-gauss-v1':{A:.2,B:.6,C:.2}}}]});
 assert.equal(h2.find(r=>r.date==='2026-10-09').source,'live_review');assert.equal(h2.length,h.length);
});
test('build: v4 + RW reference always; red guard publishes RW probabilities and keeps v4 as shadow; backfill untouched',()=>{
 const a=DA.build(live),info=a.forecast.weight_model_info;
 assert.equal(a.forecast.weight_model,'rule-weights-v4');assert.equal(info.active_model,'rule-weights-v4');assert.ok(info.rw_reference.probabilities.B>0);
 assert.deepEqual(info.shadow['rw-gauss-v1'],info.rw_reference.probabilities);assert.equal(info.rw_guard.status,'unavailable');
 const hist=[...mk(80,true,'2026-04-01'),...mk(80,false,'2026-06-20')].filter(r=>r.date<'2026-10-12');
 const r=DA.build({...live,guardHistory:hist}),ri=r.forecast.weight_model_info;
 assert.equal(r.forecast.weight_model,'rw-gauss-v1');assert.equal(ri.rw_guard.status,'red');assert.equal(ri.fallback.kind,'rw_guard');
 assert.deepEqual(Object.fromEntries(r.forecast.scenarios.map(s=>[s.id,s.probability])),ri.rw_reference.probabilities);
 assert.deepEqual(ri.shadow['rule-weights-v4'],Object.fromEntries(a.forecast.scenarios.map(s=>[s.id,s.probability])));
 assert.match(r.disclaimer,/随机游走/);assert.ok(r.forecast.scenarios.every(s=>/随机游走/.test(s.probability_basis)));
 // levels/rules unchanged by the guard
 assert.deepEqual(r.forecast.scenarios.map(s=>[s.rr,s.price_rule]),a.forecast.scenarios.map(s=>[s.rr,s.price_rule]));
 // v3 fallback (no overnight) is never swapped to RW: the guard compares v4 only
 const v3=DA.build({...live,overnight:null,guardHistory:hist});assert.equal(v3.forecast.weight_model,'rule-weights-v3');
 const bf=DA.build({date:'2026-10-09',feed:require('./fixtures/hsi-preopen-2026-10-09.json'),seed,generatedAt:'2026-10-11T10:00:00+08:00',backfill:true});
 assert.equal(bf.forecast.weight_model_info,undefined);
});
test('publisher: reviews freeze every model probability (incl. RW) and guard history loads seed + reviews',async()=>{
 const P=require('../scripts/publish-daily-analysis.cjs'),a=DA.build(live);
 const mp=P.modelProbabilities(a);assert.ok(mp['rule-weights-v4']&&mp['rw-gauss-v1']&&mp['rule-weights-v3']);
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'guard-'));fs.mkdirSync(path.join(tmp,'research/v4'),{recursive:true});fs.mkdirSync(path.join(tmp,'r'));
 fs.copyFileSync(path.join(__dirname,'../research/v4/rw-guard-seed.json'),path.join(tmp,'research/v4/rw-guard-seed.json'));
 try{const h=P.loadGuardHistory(tmp,path.join(tmp,'r'));assert.ok(h.length>2000);assert.equal(P.loadGuardHistory(path.join(tmp,'none'),path.join(tmp,'none')),null);}finally{fs.rmSync(tmp,{recursive:true});}
});
test('chart: model label says which model is used and shows RW reference/guard state',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../investment/chart/index.html'),'utf8'),vm=require('node:vm');
 const src=html.slice(html.indexOf('  function ruleWeightModel('),html.indexOf('  function participationEvaluation('));
 const ctx={escapeHtml:s=>String(s),Number,Math};vm.createContext(ctx);vm.runInContext(src,ctx);
 const a=DA.build(live);a.forecast.weight_model_info.rw_guard={status:'green',use:'v4',reason:'ok',roll60:.01,thresholds:{red_roll60:-.04}};
 assert.equal(ctx.ruleWeightNoteHtml(a,a.forecast.scenarios[1]),'');assert.equal(ctx.rwGuardNoteHtml(a,a.forecast.scenarios[1]),'');
 const hist=[...mk(80,true,'2026-04-01'),...mk(80,false,'2026-06-20')].filter(r=>r.date<'2026-10-12'),r=DA.build({...live,guardHistory:hist});
 assert.match(ctx.ruleWeightNoteHtml(r,r.forecast.scenarios[1]),/模型近期失准，已改用保守权重/);
});
