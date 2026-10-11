// Rule-based daily structural analysis. No language model, future candles,
// assumed night futures or invented probabilities enter this contract.
const MR = require('../investment/chart/market-rules.js');
const TA = require('../investment/chart/technical-analysis.js');
const MP = require('../investment/chart/market-participation.js');
const crypto = require('node:crypto');
// Rule-based scenario weights. Interpretable logit model + softmax; NOT backtested
// or calibrated. Every factor is computed from completed sessions up to the
// information cutoff (previous close) only. Positive factor values lean towards A
// (close >= swing high), negative towards C (close < swing low); B has a constant
// base logit because the swing range is the default state.
const WEIGHT_MODEL = Object.freeze({
  version: 'rule-weights-v1',
  coefficients: Object.freeze({
    position: 0.8,   // (close-low)/(high-low) mapped to [-1,1] (clamped at ±1.5 outside the range)
    distance: 0.35,  // penalty per ATR14 between close and the trigger of A (upper) / C (lower), capped 0..4
    trend: 0.5,      // 0.5*MA20 slope over 5 sessions/ATR14 + 0.5*(close-MA20)/ATR14, each clamped ±1
    breadth: 0.4,    // MarketParticipation.signal().score of the baseline session; 0 when unavailable
    range_base: 0.5  // constant logit of B
  }),
  bounds: Object.freeze({min: 0.10, max: 0.70, step: 0.05})
});
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const r2 = v => Math.round(v * 100) / 100;
// Water-fill clamp to [min,max] keeping sum 1, then round to `step` by largest remainder.
function boundedRound(raw, {min, max, step}) {
  let p = raw.slice(), fixed = p.map(() => false);
  for (let k = 0; k < 5; k++) {
    let changed = false;
    p = p.map((v, i) => { if (fixed[i]) return v; if (v < min) { fixed[i] = changed = true; return min; } if (v > max) { fixed[i] = changed = true; return max; } return v; });
    const freeSum = p.reduce((s, v, i) => s + (fixed[i] ? 0 : v), 0), left = 1 - p.reduce((s, v, i) => s + (fixed[i] ? v : 0), 0);
    if (freeSum > 0) p = p.map((v, i) => fixed[i] ? v : v * left / freeSum);
    if (!changed) break;
  }
  const n = Math.round(1 / step), lo = Math.round(min / step), hi = Math.round(max / step);
  const units = p.map(v => clamp(Math.floor(v * n + 1e-9), lo, hi));
  const order = p.map((v, i) => ({i, f: v * n - Math.floor(v * n + 1e-9)})).sort((a, b) => b.f - a.f || a.i - b.i);
  for (let guard = 0; units.reduce((s, u) => s + u, 0) < n && guard < 3 * n; guard++) { const o = order[guard % order.length]; if (units[o.i] < hi) units[o.i]++; }
  for (let guard = 0; units.reduce((s, u) => s + u, 0) > n && guard < 3 * n; guard++) { const o = order[order.length - 1 - guard % order.length]; if (units[o.i] > lo) units[o.i]--; }
  return units.map(u => Math.round(u * step * 100) / 100);
}
// Pure: same input -> same output. `bars` must already be filtered to completed
// sessions before the analysis date; `participation` is used only if it is the
// baseline session's validated snapshot published no later than `cutoff`.
function scoreScenarioWeights({bars, lower, upper, participation, cutoff, model = WEIGHT_MODEL}) {
  const last = bars.at(-1), cutoffMs = MR.timestamp(cutoff);
  if (!last || !(lower < upper) || !Number.isFinite(cutoffMs)) throw Error('Invalid weight inputs');
  if (bars.some(b => MR.timestamp(b.date + 'T16:10:00+08:00') > cutoffMs)) throw Error('Weight inputs after cutoff');
  const d = TA.calculate(bars), i = bars.length - 1, atr = d.atr[i], ma20 = d.ma20[i], ma20prev = d.ma20[i - 5];
  if (![atr, ma20, ma20prev].every(Number.isFinite) || atr <= 0) throw Error('Insufficient history for weights');
  const c = model.coefficients, close = last.close;
  const pos = (close - lower) / (upper - lower), posTerm = clamp(2 * pos - 1, -1.5, 1.5);
  const distA = clamp((upper - close) / atr, 0, 4), distC = clamp((close - lower) / atr, 0, 4);
  const slope = clamp((ma20 - ma20prev) / atr, -1, 1), rel = clamp((close - ma20) / atr, -1, 1), trend = 0.5 * slope + 0.5 * rel;
  const breadthOK = !!participation && participation.as_of === last.date && Number.isFinite(MR.timestamp(participation.updated_at)) && MR.timestamp(participation.updated_at) <= cutoffMs && MP.validate(participation, last.date).ok;
  const breadth = breadthOK ? MP.signal(participation).score : 0, wBreadth = breadthOK ? c.breadth : 0;
  const tilt = c.position * posTerm + c.trend * trend + wBreadth * breadth;
  const logits = {A: tilt - c.distance * distA, B: c.range_base, C: -tilt - c.distance * distC};
  const mx = Math.max(logits.A, logits.B, logits.C), ex = ['A', 'B', 'C'].map(k => Math.exp(logits[k] - mx)), sum = ex.reduce((s, v) => s + v, 0);
  const raw = ex.map(v => v / sum), rounded = boundedRound(raw, model.bounds);
  const posLabel = pos >= 1 ? '收盘已在区间上沿之上' : pos < 0 ? '收盘已跌破区间下沿' : '收盘位于区间 ' + Math.round(pos * 100) + '% 分位（' + (pos >= 0.5 ? '偏上沿' : '偏下沿') + '）';
  const maLabel = (rel >= 0 ? '站上' : '低于') + ' MA20 ' + Math.abs(rel).toFixed(2) + 'ATR、MA20 5日' + (slope >= 0 ? '上行' : '下行');
  const brLabel = breadthOK ? '宽度信号 ' + (breadth >= 0 ? '+' : '') + breadth.toFixed(2) + '（' + participation.as_of + '）' : '宽度数据不可用，因子权重置0';
  const basis = {
    A: posLabel + '、距 A 触发 ' + distA.toFixed(2) + 'ATR；' + maLabel + '；' + brLabel + ' → ' + (tilt >= 0 ? '偏 A' : '不利 A'),
    B: '区间基准分 ' + c.range_base + '；A/C 两侧分别距 ' + distA.toFixed(2) + '/' + distC.toFixed(2) + 'ATR，越近边界 B 越弱',
    C: posLabel + '、距 C 触发 ' + distC.toFixed(2) + 'ATR；' + maLabel + '；' + brLabel + ' → ' + (tilt <= 0 ? '偏 C' : '不利 C')
  };
  return {version: model.version, probabilities: {A: rounded[0], B: rounded[1], C: rounded[2]}, raw: {A: r2(raw[0]), B: r2(raw[1]), C: r2(raw[2])}, basis,
    factors: {baseline_date: last.date, close, lower, upper, atr14: r2(atr), ma20: r2(ma20), position: r2(pos), dist_a_atr: r2(distA), dist_c_atr: r2(distC), ma20_slope_atr: r2(slope), close_vs_ma20_atr: r2(rel), trend: r2(trend), breadth: breadthOK ? r2(breadth) : null, breadth_status: breadthOK ? 'available' : 'unavailable', tilt: r2(tilt), logits: {A: r2(logits.A), B: r2(logits.B), C: r2(logits.C)}}};
}
const fmt = n => n.toLocaleString('en-US', {maximumFractionDigits:2});
function build({date, feed, seed, participation, generatedAt, backfill=false, provenance={}, ruleWeights=!backfill, scoredReviews=0}) {
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
  // Retrospective reconstructions keep probability null unless explicitly requested,
  // so frozen supplements remain byte-for-byte reproducible.
  const weights=ruleWeights?scoreScenarioWeights({bars,lower,upper,participation,cutoff}):null;
  const priceRules={A:{operator:'gte',value:upper},B:{operator:'range',lower,upper},C:{operator:'lt',value:lower}};
  const scenarios=['A','B','C'].map((key,i)=>{
    const dir=i===0?'long':'short', entry=i===2?lower:upper;
    const stop=i===0?last.low:i===1?(upTarget||upper):last.high;
    const target=i===0?upTarget:downTarget;
    const trigger=i===0?'收盘 ≥ '+fmt(upper):i===1?'收盘 ≥ '+fmt(lower)+' 且 < '+fmt(upper):'收盘 < '+fmt(lower);
    return {id:key,name:key+' · '+['收复最近摆动高点','摆动区间内整理','跌破最近摆动低点'][i],direction:dir,probability:weights?weights.probabilities[key]:null,...(weights?{probability_basis:weights.basis[key],...(weights.factors.breadth_status==='available'?{probability_includes_breadth:true}:{})}:{}),
      color:['#00d87f','#a78bfa','#ff8c42'][i],trigger:trigger+'；只看完整日K价格结构',price_rule:priceRules[key],
      invalidation:(dir==='long'?'收盘 < ':'收盘 ≥ ')+fmt(stop),
      rr:{entry,stop,target,direction:dir,entryHint:'条件确认之后再观察结构位回测；价格满足赔率不等于触发。'},
      risk:{structural_invalidation:{price:stop,confirmation:'completed_daily_close'},disaster_stop:{price:null,status:'not_configured'}},
      target:target==null?'缺少已观察到的目标结构，赔率不可用':fmt(target)+'（已观察到的结构位）',
      holding_period:'每日重新核验，不承诺固定持仓天数',note:weights?'规则生成的条件情景；权重为 '+WEIGHT_MODEL.version+' 规则打分，未经回测校准，不是历史胜率。':'规则生成的条件情景；未校准历史发生率，不提供概率百分比。',
      zone:target==null?{}:{upperBound:[{offset:0,price:last.close},{offset:5,price:Math.max(entry,target)}],lowerBound:[{offset:0,price:last.close},{offset:5,price:Math.min(entry,target)}]}};
  });
  const participantOK=participation?.metrics && [participation.metrics.equal_name_breadth,participation.metrics.weighted_breadth,participation.metrics.net_point_contribution].every(Number.isFinite) && participation?.status==='available' && participation.as_of===last.date && MR.timestamp(participation.updated_at)<=MR.timestamp(cutoff);
  const avg=bars.slice(-21,-1).filter(b=>Number.isFinite(b.turnover_yi));
  const ratio=avg.length===20 && Number.isFinite(last.turnover_yi)?last.turnover_yi/(avg.reduce((s,b)=>s+b.turnover_yi,0)/20):null;
  const narrative=last.date+' 收盘 '+fmt(last.close)+'；'+summary.structure.label+'；'+summary.structure.breakout+'。最近确认摆动边界 '+fmt(lower)+'–'+fmt(upper)+'。RSI14 '+summary.rsi.toFixed(1)+'、ATR14 '+fmt(summary.atr)+'、MA20 '+fmt(summary.ma20)+'。';
  const sourceHash=crypto.createHash('sha256').update(JSON.stringify(bars)).digest('hex');
  return {$schema_note:'每日规则分析：confirmed pivots(width=2) + 既有可追溯结构目标。价格结构决定核心触发，环境只提供证据。',
    meta:{symbol:'^HSI',updatedAt:time,analysis_id:id,latestClose:last.close,latestCloseDate:last.date,note:backfill?'事后补录，不是当时发布的预测':'自动生成的每日价格结构分析',dataSources:feed.source},
    publication:{kind:backfill?'retrospective_backfill':'daily_rule_analysis',session_date:date,generated_at:time,information_cutoff:cutoff,baseline_date:last.date,source_sha256:sourceHash,source_snapshot:provenance,eligible_as_new_prediction:!backfill,method:'confirmed-swing-structure-v1',probability_status:weights?'rule_based_uncalibrated':'uncalibrated'},
    disclaimer:'条件式价格结构分析；'+(weights?'权重为规则打分（'+WEIGHT_MODEL.version+'），未经回测校准。':'权重尚未校准。')+'补录不参与预测命中率、Brier或实时入场判断。',
    forecast:{applicable_date:date,updatedAt:time,baseDate:last.date,basePrice:last.close,bias:summary.structure.direction<0?'bearish':summary.structure.direction>0?'bullish':'neutral',biasLabel:summary.structure.label,
      summary:narrative,horizon:'未来5个交易日，每日重新核验',horizonEndDate:MR.horizon(date,5).end,horizonDesc:MR.horizon(date,5).description,
      reasoning:[narrative,'A/B/C 分别覆盖 ≥上边界、两边界之间、<下边界；盘中穿越不算正式触发。','夜期、IV、南向资金无截止前可信快照时不可用，不用于推断。',participantOK?'环境证据：'+participation.as_of+' 官方成分报告上涨家数占比 '+(participation.metrics.equal_name_breadth*100).toFixed(1)+'%、上涨权重占比 '+(participation.metrics.weighted_breadth*100).toFixed(1)+'%、净点数贡献 '+fmt(participation.metrics.net_point_contribution)+'；只描述环境，不改变价格触发。':'环境证据：无符合截止时间的官方成分报告，标记不可用。'],
      targetUpper:upTarget,targetLower:downTarget,confidence:'未校准',scenarios,
      ...(weights?{weight_model:WEIGHT_MODEL.version,weight_model_info:{version:WEIGHT_MODEL.version,calibration:'未经回测校准',scored_reviews:scoredReviews,coefficients:WEIGHT_MODEL.coefficients,factors:weights.factors,raw_probabilities:weights.raw}}:{}),
      card:{stateEmoji:'📋',stateLabel:backfill?date+' 事后补录分析':date+' 每日结构分析',structureLine:narrative,stateTone:'neutral',keyLines:[{price:lower,tag:'最近确认摆动低点',tf:'日线'},{price:upper,tag:'最近确认摆动高点',tf:'日线'}]},
      scenario_evidence:{analysis_id:id,last_bar:{...last,completed:true},timeframe:'1d',source:feed.source,scenarios:{}}},
    environment_evidence:{volume_ratio:{status:ratio==null?'unavailable':'available',value:ratio,basis:'previous_20_completed_sessions'},participation:{status:participantOK?'available':'unavailable',as_of:participantOK?participation.as_of:null,metrics:participantOK?participation.metrics:null,source:participantOK?participation.source:null},night_futures:{status:'unavailable'},options_risk:{status:'unavailable'},southbound:{status:'unavailable'}},
    intraday_playbook:{updatedAt:time,note:'仅用于区间定位，不是即时操作指令',zones:[{range:[upper,null],stance:'修复观察',action:'等待A收盘确认'},{range:[lower,upper],stance:'区间观察',action:'等待B收盘确认'},{range:[null,lower],stance:'破位观察',action:'等待C收盘确认'}]},
    levels:[{price:lower,type:'support',label:'最近确认摆动低点',reason:pivots.lows.at(-1).time+'，确认于 '+pivots.lows.at(-1).confirmedAt},{price:upper,type:'resistance',label:'最近确认摆动高点',reason:pivots.highs.at(-1).time+'，确认于 '+pivots.highs.at(-1).confirmedAt},...(downTarget==null?[]:[{price:downTarget,type:'support',label:'下方结构目标',reason:'截止日前的确认摆动低点或既有支撑'}]),...(upTarget==null?[]:[{price:upTarget,type:'resistance',label:'上方结构目标',reason:'截止日前的确认摆动高点或既有阻力'}])],markers:[],playbook:[],pathTree:null};
}
module.exports={build,judge:MR.priceCondition,scoreScenarioWeights,boundedRound,WEIGHT_MODEL};
