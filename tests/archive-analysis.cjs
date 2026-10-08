const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {snapshot,save}=require('../scripts/archive-analysis.cjs');
const a={meta:{updatedAt:'2026-10-06T08:45:00+08:00'},forecast:{scenarios:[{id:'A',probability:0.35,trigger:'收盘条件'}]}};
const provenance={source_commit:'a'.repeat(40),source_committed_at:'2026-10-07T04:07:09Z',recovered:true};
test('recovery keeps original analysis, probabilities, dates and source checksum intact; excluded from new prediction scores',()=>{
 const out=snapshot(a,'2026-10-07',provenance,Date.parse('2026-10-08T12:00:00Z'));
 const {archive_record,...original}=out;assert.deepEqual(original,a);
 assert.equal(archive_record.original_analysis_date,'2026-10-06');assert.equal(archive_record.session_date,'2026-10-07');assert.equal(archive_record.eligible_as_new_prediction,false);
 assert.equal(archive_record.source_sha256,crypto.createHash('sha256').update(JSON.stringify(a)).digest('hex'));
});
test('rejects hindsight, unsupported holidays and future forecasts',()=>{
 assert.throws(()=>snapshot(a,'2026-10-07',{...provenance,source_committed_at:'2026-10-08T04:00:00Z'}));
 assert.throws(()=>snapshot(a,'2026-10-01',provenance));
 assert.throws(()=>snapshot({meta:{updatedAt:'2026-10-08'}},'2026-10-07',provenance));
});
test('repeat capture repairs index only and never overwrites the frozen snapshot',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'minigavin-archive-test-'));
 try {
  save(root,a,'2026-10-07',provenance,0);const file=path.join(root,'investment/chart/archive/2026-10-07.json');const frozen=fs.readFileSync(file,'utf8');
  save(root,{...a,forecast:{scenarios:[]}},'2026-10-07',provenance,1);
  assert.equal(fs.readFileSync(file,'utf8'),frozen);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'investment/chart/archive/index.json'))),['2026-10-07']);
 } finally {fs.rmSync(root,{recursive:true});}
});
test('old analysis may be captured as a carried session, never as a fresh forecast',()=>{
 const out=snapshot(a,'2026-10-07',{...provenance,recovered:false});assert.equal(out.archive_record.kind,'carried_forward_snapshot');assert.equal(out.archive_record.eligible_as_new_prediction,false);
 const fresh=snapshot({...a,meta:{updatedAt:'2026-10-07T08:45:00+08:00'}},'2026-10-07',{...provenance,recovered:false});assert.equal(fresh.archive_record.kind,'daily_snapshot');assert.equal(fresh.archive_record.eligible_as_new_prediction,true);
});
