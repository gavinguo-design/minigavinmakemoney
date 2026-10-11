// Rule-based daily structural analysis. No language model, future candles,
// assumed night futures or invented probabilities enter this contract.
const MR = require('../investment/chart/market-rules.js');
const TA = require('../investment/chart/technical-analysis.js');
const crypto = require('node:crypto');
const fmt = n => n.toLocaleString('en-US', {maximumFractionDigits:2});
function build({date, feed, seed, participation, generatedAt, backfill=false, provenance={}}) {
  if (MR.tradingDay(date)!==true) throw Error('Unsupported/non-trading analysis date');
  const cutoff = backfill ? date+'T08:45:00+08:00' : (generatedAt || new Date().toISOString());
  if (!backfill && (MR.hk(MR.timestamp(cutoff)).date!==date || MR.timestamp(cutoff)>=MR.timestamp(date+'T09:30:00+08:00'))) throw Error('Preopen publication missed; use explicit backfill');
  const expected = MR.latestDay(MR.timestamp(date+'T08:45:00+08:00'), true);
  const bars=(feed.candles||[]).filter(b=>b.date<date && !b.partial && b.final!==false)
    .map(b=>({...b,time:b.date})).sort((a,b)=>a.date.localeCompare(b.date));
  if (bars.length<60 || bars.at(-1).date!==expected) throw Error('Missing latest completed baseline '+expected);
  for (let i=0;i<bars.length;i++) {
    const b=bars[i];
    if (![b.open,b.high,b.low,b.close].every(Number.isFinite) || b.low<=0 || MR.tradingDay(b.date)!==true || b.low>Math.min(b.open,b.close) || b.high<Math.max(b.open,b.close) || (i&&bars[i-1].date===b.date)) throw Error('Invalid/duplicate OHLC');
  }
  if (!feed.source || !Number.isFinite(MR.timestamp(feed.updated_at)) || MR.timestamp(feed.updated_at)>MR.timestamp(cutoff)) throw Error('Input snapshot published after preopen cutoff');
  if (seed && MR.timestamp(seed.meta?.updatedAt)>MR.timestamp(cutoff)) throw Error('Future seed');
  const last=bars.at(-1), summary=TA.summary(bars), pivots=TA.pivots(bars,2);
  const lower=pivots.lows.at(-1)?.price, upper=pivots.highs.at(-1)?.price;
  if (!Number.isFinite(lower)||!Number.isFinite(upper)||lower>=upper) throw Error('Insufficient ordered confirmed structure');
  const known=(seed?.levels||[]).filter(l=>Number.isFinite(l.price));
  const below=[...pivots.lows.map(p=>p.price),...known.filter(l=>l.type==='support').map(l=>l.price)].filter(p=>p<Math.min(lower,last.low));
  const above=[...pivots.highs.map(p=>p.price),...known.filter(l=>l.type==='resistance').map(l=>l.price)].filter(p=>p>upper);
  const downTarget=below.length?Math.max(...below):null, upTarget=above.length?Math.min(...above):null;
  const time=generatedAt||new Date().toISOString();
  if (!backfill && MR.timestamp(time)>=MR.timestamp(date+'T09:30:00+08:00')) throw Error('Preopen publication missed; use explicit backfill');
  const id='HSI-'+date.replaceAll('-','')+'-structure-v1';
  const priceRules={A:{operator:'gte',value:upper},B:{operator:'range',lower,upper},C:{operator:'lt',value:lower}};
  const scenarios=['A','B','C'].map((key,i)=>{
    const dir=i===0?'long':'short', entry=i===2?lower:upper;
    const stop=i===0?last.low:i===1?(upTarget||upper):last.high;
    const target=i===0?upTarget:downTarget;
    const trigger=i===0?'收盘 ≥ '+fmt(upper):i===1?'收盘 ≥ '+fmt(lower)+' 且 < '+fmt(upper):'收盘 < '+fmt(lower);
    return {id:key,name:key+' · '+['收复最近摆动高点','摆动区间内整理','跌破最近摆动低点'][i],direction:dir,probability:null,
      color:['#00d87f','#a78bfa','#ff8c42'][i],trigger:trigger+'；只看完整日K价格结构',price_rule:priceRules[key],
      invalidation:(dir==='long'?'收盘 < ':'收盘 ≥ ')+fmt(stop),
      rr:{entry,stop,target,direction:dir,entryHint:'条件确认之后再观察结构位回测；价格满足赔率不等于触发。'},
      risk:{structural_invalidation:{price:stop,confirmation:'completed_daily_close'},disaster_stop:{price:null,status:'not_configured'}},
      target:target==null?'缺少已观察到的目标结构，赔率不可用':fmt(target)+'（已观察到的结构位）',
      holding_period:'每日重新核验，不承诺固定持仓天数',note:'规则生成的条件情景；未校准历史发生率，不提供概率百分比。',
      zone:target==null?{}:{upperBound:[{offset:0,price:last.close},{offset:5,price:Math.max(entry,target)}],lowerBound:[{offset:0,price:last.close},{offset:5,price:Math.min(entry,target)}]}};
  });
  const participantOK=participation?.metrics && [participation.metrics.equal_name_breadth,participation.metrics.weighted_breadth,participation.metrics.net_point_contribution].every(Number.isFinite) && participation?.status==='available' && participation.as_of===last.date && MR.timestamp(participation.updated_at)<=MR.timestamp(cutoff);
  const avg=bars.slice(-21,-1).filter(b=>Number.isFinite(b.turnover_yi));
  const ratio=avg.length===20 && Number.isFinite(last.turnover_yi)?last.turnover_yi/(avg.reduce((s,b)=>s+b.turnover_yi,0)/20):null;
  const narrative=last.date+' 收盘 '+fmt(last.close)+'；'+summary.structure.label+'；'+summary.structure.breakout+'。最近确认摆动边界 '+fmt(lower)+'–'+fmt(upper)+'。RSI14 '+summary.rsi.toFixed(1)+'、ATR14 '+fmt(summary.atr)+'、MA20 '+fmt(summary.ma20)+'。';
  const sourceHash=crypto.createHash('sha256').update(JSON.stringify(bars)).digest('hex');
  return {$schema_note:'每日规则分析：confirmed pivots(width=2) + 既有可追溯结构目标。价格结构决定核心触发，环境只提供证据。',
    meta:{symbol:'^HSI',updatedAt:time,analysis_id:id,latestClose:last.close,latestCloseDate:last.date,note:backfill?'事后补录，不是当时发布的预测':'自动生成的每日价格结构分析',dataSources:feed.source},
    publication:{kind:backfill?'retrospective_backfill':'daily_rule_analysis',session_date:date,generated_at:time,information_cutoff:cutoff,baseline_date:last.date,source_sha256:sourceHash,source_snapshot:provenance,eligible_as_new_prediction:!backfill,method:'confirmed-swing-structure-v1',probability_status:'uncalibrated'},
    disclaimer:'条件式价格结构分析；权重尚未校准。补录不参与预测命中率、Brier或实时入场判断。',
    forecast:{applicable_date:date,updatedAt:time,baseDate:last.date,basePrice:last.close,bias:summary.structure.direction<0?'bearish':summary.structure.direction>0?'bullish':'neutral',biasLabel:summary.structure.label,
      summary:narrative,horizon:'未来5个交易日，每日重新核验',horizonEndDate:MR.horizon(date,5).end,horizonDesc:MR.horizon(date,5).description,
      reasoning:[narrative,'A/B/C 分别覆盖 ≥上边界、两边界之间、<下边界；盘中穿越不算正式触发。','夜期、IV、南向资金无截止前可信快照时不可用，不用于推断。',participantOK?'环境证据：'+participation.as_of+' 官方成分报告上涨家数占比 '+(participation.metrics.equal_name_breadth*100).toFixed(1)+'%、上涨权重占比 '+(participation.metrics.weighted_breadth*100).toFixed(1)+'%、净点数贡献 '+fmt(participation.metrics.net_point_contribution)+'；只描述环境，不改变价格触发。':'环境证据：无符合截止时间的官方成分报告，标记不可用。'],
      targetUpper:upTarget,targetLower:downTarget,confidence:'未校准',scenarios,
      card:{stateEmoji:'📋',stateLabel:backfill?date+' 事后补录分析':date+' 每日结构分析',structureLine:narrative,stateTone:'neutral',keyLines:[{price:lower,tag:'最近确认摆动低点',tf:'日线'},{price:upper,tag:'最近确认摆动高点',tf:'日线'}]},
      scenario_evidence:{analysis_id:id,last_bar:{...last,completed:true},timeframe:'1d',source:feed.source,scenarios:{}}},
    environment_evidence:{volume_ratio:{status:ratio==null?'unavailable':'available',value:ratio,basis:'previous_20_completed_sessions'},participation:{status:participantOK?'available':'unavailable',as_of:participantOK?participation.as_of:null,metrics:participantOK?participation.metrics:null,source:participantOK?participation.source:null},night_futures:{status:'unavailable'},options_risk:{status:'unavailable'},southbound:{status:'unavailable'}},
    intraday_playbook:{updatedAt:time,note:'仅用于区间定位，不是即时操作指令',zones:[{range:[upper,null],stance:'修复观察',action:'等待A收盘确认'},{range:[lower,upper],stance:'区间观察',action:'等待B收盘确认'},{range:[null,lower],stance:'破位观察',action:'等待C收盘确认'}]},
    levels:[{price:lower,type:'support',label:'最近确认摆动低点',reason:pivots.lows.at(-1).time+'，确认于 '+pivots.lows.at(-1).confirmedAt},{price:upper,type:'resistance',label:'最近确认摆动高点',reason:pivots.highs.at(-1).time+'，确认于 '+pivots.highs.at(-1).confirmedAt},...(downTarget==null?[]:[{price:downTarget,type:'support',label:'下方结构目标',reason:'截止日前的确认摆动低点或既有支撑'}]),...(upTarget==null?[]:[{price:upTarget,type:'resistance',label:'上方结构目标',reason:'截止日前的确认摆动高点或既有阻力'}])],markers:[],playbook:[],pathTree:null};
}
module.exports={build,judge:MR.priceCondition};
