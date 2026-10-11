// Retrospective rule-weight computation for sessions published before
// rule-weights-v1 existed. Reads only Git snapshots that existed at each
// session's 08:45 HKT cutoff. Never edits archive/ snapshots or supplements and
// never feeds Brier / prediction scoring.
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const MR=require('../investment/chart/market-rules.js');
const {build,WEIGHT_MODEL}=require('./daily-analysis.cjs');
const root=path.join(__dirname,'..');
const git=(...a)=>execFileSync('git',a,{cwd:root,encoding:'utf8'}).trim();
function snapshotAt(file,cutoff){
  const line=git('log','-1','--format=%H %cI','--until='+cutoff,'--',file);if(!line)return null;
  const [commit,committed_at]=line.split(' ');
  if(MR.timestamp(committed_at)>MR.timestamp(cutoff))return null;
  return {commit,committed_at,data:JSON.parse(git('show',commit+':'+file))};
}
function compute(dates,computedAt=new Date().toISOString()){
  const seed=JSON.parse(fs.readFileSync(path.join(root,'investment/chart/archive/2026-10-06.json'),'utf8'));
  const sessions={};
  for(const date of dates){
    const cutoff=date+'T08:45:00+08:00';
    const k=snapshotAt('investment/chart/kline_futu.json',cutoff),p=snapshotAt('investment/chart/hsi-participation.json',cutoff);
    const a=build({date,feed:k.data,seed,participation:p&&p.data,generatedAt:computedAt,backfill:true,ruleWeights:true});
    const f=a.forecast.weight_model_info.factors;
    sessions[date]={information_cutoff:cutoff,baseline_date:a.forecast.baseDate,base_close:a.forecast.basePrice,
      source_snapshot:{kline_commit:k.commit,kline_committed_at:k.committed_at,participation_commit:p?p.commit:null,participation_committed_at:p?p.committed_at:null,participation_used:f.breadth_status==='available'},
      scenarios:a.forecast.scenarios.map(s=>({id:s.id,price_rule:s.price_rule,probability:s.probability,probability_basis:s.probability_basis})),factors:f};
  }
  return {kind:'retrospective',weight_model:WEIGHT_MODEL.version,computed_at:computedAt,eligible_for_scoring:false,
    note:'事后补算：rule-weights-v1 上线前的交易日，用当日 08:45 前已存在的 Git 快照重算规则权重。不修改冻结 archive，不计入预测打分或 Brier。',sessions};
}
module.exports={compute};
if(require.main===module){
  const out=compute(process.argv.slice(2).length?process.argv.slice(2):['2026-10-07','2026-10-08','2026-10-09']);
  const file=path.join(root,'investment/chart/archive/rule-weights-backfill.json');
  fs.writeFileSync(file,JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify(Object.fromEntries(Object.entries(out.sessions).map(([d,s])=>[d,s.scenarios.map(x=>x.id+'='+x.probability).join(' ')+' breadth:'+s.factors.breadth_status]))));
}
