const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const M=require('../scripts/manual-adjustments.cjs');
const card=(s,p,rw)=>({meta:{analysis_id:'HSI-'+s},forecast:{weight_model:'rule-weights-v4',weight_model_info:{rw_reference:{probabilities:rw}},scenarios:[
 {id:'A',probability:p.A,price_rule:{operator:'gte',value:110}},{id:'B',probability:p.B,price_rule:{operator:'range',lower:90,upper:110}},{id:'C',probability:p.C,price_rule:{operator:'lt',value:90}}]}});
function repo(){const r=fs.mkdtempSync(path.join(os.tmpdir(),'manual-'));const d=path.join(r,'investment/chart/daily-generated');fs.mkdirSync(d,{recursive:true});
 fs.writeFileSync(path.join(d,'2026-10-20.json'),JSON.stringify(card('20',{A:.1,B:.8,C:.1},{A:.2,B:.6,C:.2})));return r;}
test('manual ledger: append-only hash chain, dedup to last pre-cutoff entry, late entries never scored, scored next to model and RW',()=>{
 const r=repo();try{
  const t=s=>Date.parse(s);
  M.record({root:r,session:'2026-10-20',probabilities:{A:.5,B:.3,C:.2},reason:'first',now:t('2026-10-19T16:30:00+08:00')});
  M.record({root:r,session:'2026-10-20',probabilities:{A:.2,B:.6,C:.2},reason:'second',now:t('2026-10-19T21:00:00+08:00')});
  M.record({root:r,session:'2026-10-20',probabilities:{A:.9,B:.05,C:.05},reason:'late',now:t('2026-10-20T10:00:00+08:00')});
  const L=M.load(r);assert.equal(L.entries.length,3);assert.equal(M.verify(L),true);
  const st=M.effective(L).status.map(s=>s.state);assert.deepEqual(st,['superseded','effective','late']);
  const sc=M.score({root:r,candles:[{date:'2026-10-20',close:100}]});
  assert.equal(sc.scored_sessions,1);const row=sc.rows[0];assert.equal(row.manual.outcome,'B');assert.equal(row.manual.brier,Math.round((.04+.16+.04)*1e4)/1e4);
  assert.equal(row.model.brier,Math.round((.01+.04+.01)*1e4)/1e4);assert.equal(row.rw.brier,Math.round((.04+.16+.04)*1e4)/1e4);assert.equal(row.same_rules_as_model,true);
  // tampering is detected; prior files untouched
  const f=M.ledgerPath(r),j=JSON.parse(fs.readFileSync(f,'utf8'));j.entries[0].probabilities.A=.6;fs.writeFileSync(f,JSON.stringify(j));assert.throws(()=>M.load(r)&&M.verify(M.load(r)),/tampered/);
  assert.throws(()=>M.record({root:r,session:'2026-10-21',probabilities:{A:.5,B:.5,C:.5},reason:'x'}),/sum/);
  assert.throws(()=>M.record({root:repo(),session:'2026-10-20',probabilities:{A:.5,B:.3,C:.2},reason:''}),/reason/);
 }finally{fs.rmSync(r,{recursive:true});}
});
