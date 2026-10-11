const fs=require('node:fs'),path=require('node:path');
const MR=require('../investment/chart/market-rules.js');
const {build,judge}=require('./daily-analysis.cjs');
const root=path.join(__dirname,'..'),dir=path.join(root,'investment/chart');
const read=name=>JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'));
// Multi-class Brier score Σ(p_i - o_i)^2 over A/B/C (range 0..2, lower is better).
// The A/B/C price rules partition the close, so normally exactly one verdict is met.
// Rule for anomalies: k>1 met -> o_i = 1/k for each met scenario (shared outcome);
// none met or any probability missing -> brier null with an explicit status.
function brierScore(scenarios,verdicts) {
  const probs=verdicts.map(v=>scenarios.find(s=>s.id===v.id)?.probability);
  if(!verdicts.length||!probs.every(p=>typeof p==='number'&&Number.isFinite(p)))return {brier:null,brier_status:'no_probability',brier_rule:null};
  const met=verdicts.filter(v=>v.met===true).length;
  if(!met)return {brier:null,brier_status:'no_outcome_met',brier_rule:'没有情景成立，不计分'};
  const score=verdicts.reduce((s,v,i)=>s+(probs[i]-(v.met===true?1/met:0))**2,0);
  return {brier:Math.round(score*10000)/10000,brier_status:met===1?'scored':'scored_shared_outcome',brier_rule:met===1?'多类Brier Σ(p_i-o_i)^2，成立情景 o=1':'多个情景同时成立，o_i=1/'+met+' 均分'};
}
function countScoredReviews(dir) {
  try {return fs.readdirSync(dir).filter(f=>/^\d{4}-\d{2}-\d{2}\.json$/.test(f)).filter(f=>{try{return Number.isFinite(JSON.parse(fs.readFileSync(path.join(dir,f),'utf8')).brier);}catch(e){return false;}}).length;}
  catch(e){return 0;}
}
function exclusive(file,data) {
  const body=JSON.stringify(data,null,2)+'\n';fs.mkdirSync(path.dirname(file),{recursive:true});
  try {fs.writeFileSync(file,body,{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;}
}
async function run({now=Date.now(),phase='preopen',projectRoot=root}={}) {
  const dir=path.join(projectRoot,'investment/chart');
  const read=name=>JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'));
  const today=MR.hk(now).date;
  fs.mkdirSync(path.join(dir,'daily-generated'),{recursive:true});
  fs.mkdirSync(path.join(dir,'daily-reviews'),{recursive:true});
  if(MR.tradingDay(today)!==true){console.log('Non-trading day: no publication');return;}
  if(phase==='postclose') {
    if(MR.hk(now).minute<MR.closeMinute(today))throw Error('Not a completed close');
    const a=read('annotations.json'),feed=read('kline_futu.json');
    if(a.forecast.applicable_date!==today||a.publication?.kind!=='daily_rule_analysis')throw Error('No genuine same-day daily analysis to review');
    const replay=MR.replaySession(a,feed,today,now);
    if(replay.status!=='available')throw Error('Missing completed same-day candle');
    const bar=feed.candles.find(b=>b.date===today);
    const verdicts=replay.scenarios.map(s=>({id:s.id,met:s.condition}));
    if(verdicts.some(v=>v.met===null))throw Error('Missing frozen price rule');
    const record={session_date:today,analysis_id:a.meta.analysis_id,kind:'price_structure_close_review',generated_at:new Date(now).toISOString(),bar,verdicts,probability_status:a.publication?.probability_status||'uncalibrated',weight_model:a.forecast.weight_model||null,probabilities:Object.fromEntries(a.forecast.scenarios.map(s=>[s.id,s.probability??null])),...brierScore(a.forecast.scenarios,verdicts)};
    exclusive(path.join(dir,'daily-reviews',today+'.json'),record);
    const status={updated_at:new Date(now).toISOString(),judgment_mode:'close_final',analysis_id:a.meta.analysis_id,conditions_date:today,data_stale:false,conditions_stale:false,metrics:{price:bar.close},scenarios:verdicts.map(v=>({id:v.id,name_prefix:v.id,triggered:v.met,core_met:v.met?1:0,core_total:1,confirm_met:0,confirm_total:0,strength:'价格确认·环境未定',conditions:[{id:'daily_price_structure',role:'core',label:a.forecast.scenarios.find(s=>s.id===v.id).trigger,met:v.met}]}))};
    fs.writeFileSync(path.join(dir,'scenario_status.json'),JSON.stringify(status,null,2)+'\n');return;
  }
  if(MR.hk(now).minute>=570)throw Error('Preopen missed: refusing hindsight publication');
  const expected=MR.latestDay(now,true);let feed=read('kline_futu.json');
  if(!feed.candles.some(b=>b.date===expected&&!b.partial&&b.final!==false)) {
    const url='https://query1.finance.yahoo.com/v8/finance/chart/%5EHSI?interval=1d&range=2y';
    const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(15000)});
    if(!r.ok)throw Error('Daily source failed '+r.status);
    const raw=(await r.json()).chart?.result?.[0],q=raw?.indicators?.quote?.[0];
    if(!q||!raw.timestamp)throw Error('Missing Yahoo daily result');
    const candles=raw.timestamp.map((ts,i)=>({date:MR.hk(ts*1000).date,open:q.open[i],high:q.high[i],low:q.low[i],close:q.close[i]})).filter(b=>b.date<=expected&&[b.open,b.high,b.low,b.close].every(Number.isFinite));
    // Never overwrite already confirmed OHLC with a second provider.
    const existingDates=new Set(feed.candles.filter(b=>!b.partial&&b.final!==false).map(b=>b.date));
    const additions=candles.filter(b=>!existingDates.has(b.date));
    feed={symbol:'^HSI',source:feed.source+'; new sessions: '+url,updated_at:new Date(now).toISOString(),candles:[...feed.candles.filter(b=>!b.partial),...additions].sort((a,b)=>a.date.localeCompare(b.date))};
    fs.writeFileSync(path.join(dir,'kline_futu.json'),JSON.stringify(feed,null,2)+'\n');
  }
  const existing=read('annotations.json');
  if(existing.forecast.applicable_date===today && existing.publication?.kind==='daily_rule_analysis') {console.log('Already generated; preserve frozen same-day analysis');return;}
  const a=build({date:today,feed,seed:existing,participation:read('hsi-participation.json'),generatedAt:new Date(now).toISOString(),scoredReviews:countScoredReviews(path.join(dir,'daily-reviews'))});
  // This prepublication ledger is separate from genuine archive snapshots.
  exclusive(path.join(dir,'daily-generated',today+'.json'),a);
  fs.writeFileSync(path.join(dir,'annotations.json'),JSON.stringify(a,null,2)+'\n');
  const status={updated_at:new Date(now).toISOString(),judgment_mode:'intraday_preview',conditions_date:today,analysis_id:a.meta.analysis_id,data_stale:false,conditions_stale:false,scenarios:a.forecast.scenarios.map(s=>({id:s.id,name_prefix:s.id,triggered:false,core_met:0,core_total:1,confirm_met:0,confirm_total:0,conditions:[{id:'daily_price_structure',role:'core',label:s.trigger,met:null}]}))};
  fs.writeFileSync(path.join(dir,'scenario_status.json'),JSON.stringify(status,null,2)+'\n');
  console.log(JSON.stringify({generated:today,baseline:expected,analysis_id:a.meta.analysis_id}));
}
module.exports={run,brierScore};
if(require.main===module)run({phase:process.argv[2]||'preopen',now:process.env.ANALYSIS_NOW?MR.timestamp(process.env.ANALYSIS_NOW):Date.now()}).catch(e=>{console.error(e.message);process.exitCode=1;});
