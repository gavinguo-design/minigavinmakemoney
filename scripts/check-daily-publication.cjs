// Independent deadline and deployment check. A green archive run is not proof
// of a new analysis. Failures become failed Actions checks, never silent reuse.
const fs=require('node:fs');
const MR=require('../investment/chart/market-rules.js');
function audit(a,now,phase='preopen') {
  const today=MR.hk(now).date;
  if(MR.tradingDay(today)===false)return {skipped:true};
  if(MR.tradingDay(today)!==true)throw Error('Unsupported calendar');
  if(a.publication?.kind!=='daily_rule_analysis'||a.forecast?.applicable_date!==today||a.publication?.eligible_as_new_prediction!==true)throw Error('Missing genuine daily analysis '+today);
  if(a.publication.baseline_date!==MR.latestDay(MR.timestamp(today+'T08:45:00+08:00'),true))throw Error('Wrong baseline date');
  if(MR.timestamp(a.meta.updatedAt)>=MR.timestamp(today+'T09:30:00+08:00'))throw Error('Publication generated after opening');
  if(phase==='postclose') {
    const record=JSON.parse(fs.readFileSync('investment/chart/daily-reviews/'+today+'.json','utf8'));
    if(record.analysis_id!==a.meta.analysis_id||record.bar.date!==today)throw Error('Missing same-day close review');
  }
  return {date:today,analysis_id:a.meta.analysis_id};
}
async function deployment(repo,sha,token) {
  const r=await fetch('https://api.github.com/repos/'+repo+'/commits/'+sha+'/check-runs',{headers:{'User-Agent':'minigavin-publication-watchdog',Accept:'application/vnd.github+json',...(token?{Authorization:'Bearer '+token}:{})},signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw Error('Cannot verify deployment: '+r.status);
  const checks=(await r.json()).check_runs||[];
  if(!checks.some(c=>c.name==='Cloudflare Pages'&&c.status==='completed'&&c.conclusion==='success'))throw Error('Cloudflare deployment not confirmed for '+sha);
}
module.exports={audit,deployment};
if(require.main===module)(async()=>{
  const a=JSON.parse(fs.readFileSync('investment/chart/annotations.json','utf8'));
  const result=audit(a,process.env.ANALYSIS_NOW?MR.timestamp(process.env.ANALYSIS_NOW):Date.now(),process.argv[2]||'preopen');
  if(!result.skipped) {
    const cp=require('node:child_process');
    const paths=['investment/chart/annotations.json'];
    if(process.argv[2]==='postclose')paths.push('investment/chart/scenario_status.json','investment/chart/daily-reviews/'+result.date+'.json');
    const sha=cp.execFileSync('git',['log','-1','--format=%H','--',...paths],{encoding:'utf8'}).trim();
    await deployment(process.env.GITHUB_REPOSITORY||'gavinguo-design/minigavinmakemoney',sha,process.env.GITHUB_TOKEN);
  }
  console.log(JSON.stringify(result));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
