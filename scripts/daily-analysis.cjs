// Rule-based daily structural analysis. No language model, future candles,
// assumed night futures or invented probabilities enter this contract.
const MR = require('../investment/chart/market-rules.js');
const TA = require('../investment/chart/technical-analysis.js');
const MP = require('../investment/chart/market-participation.js');
const crypto = require('node:crypto');
// Rule-based daily weights use completed bars only. These are research rules, not calibrated odds.
const WEIGHT_MODEL_V1 = Object.freeze({version:'rule-weights-v1',coefficients:Object.freeze({position:.8,distance:.35,trend:.5,breadth:.4,range_base:.5}),bounds:Object.freeze({min:.10,max:.70,step:.05})});
// Coefficients are deliberately small priors, frozen before retrospective comparison.
// Citations are to the supplied audits: Grimes PDF pp.37-49, 82-84; Nison Ch.4-8;
// Sakata Ch.2/6; Natenberg Ch.4 (PDF p.82); Harris Ch.5/6/20 (PDF pp.110-148,423-430).
const WEIGHT_MODEL_V2 = Object.freeze({version:'rule-weights-v2.1',coefficients:Object.freeze({
  position:.55,distance:.25,trend:.30,breadth:.25,range_base:.45,
  regime_range:.55,breakout_quality:.30,sakata_exhaustion:.15,candle:.20,
  volatility:.20,stale_shrink:.45,gap_shrink:.25
}),bounds:Object.freeze({min:.10,max:.70,step:.05})});
// Production default stays v1 until v2.x passes the two-year backtest (v2 failed independent review 2026-10-12: trend/sakata bugs; v2.1 fixes them but is unvalidated).
const WEIGHT_MODEL = WEIGHT_MODEL_V1;
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const r2=v=>Math.round(v*100)/100;
function boundedRound(raw,{min,max,step}) { let p=raw.slice(),fixed=p.map(()=>false);for(let k=0;k<5;k++){let changed=false;p=p.map((v,i)=>{if(fixed[i])return v;if(v<min){fixed[i]=changed=true;return min;}if(v>max){fixed[i]=changed=true;return max;}return v;});const free=p.reduce((s,v,i)=>s+(fixed[i]?0:v),0),left=1-p.reduce((s,v,i)=>s+(fixed[i]?v:0),0);if(free)p=p.map((v,i)=>fixed[i]?v:v*left/free);if(!changed)break;}const n=Math.round(1/step),lo=Math.round(min/step),hi=Math.round(max/step),u=p.map(v=>clamp(Math.floor(v*n+1e-9),lo,hi)),o=p.map((v,i)=>({i,f:v*n-Math.floor(v*n+1e-9)})).sort((a,b)=>b.f-a.f||a.i-b.i);for(let q=0;u.reduce((x,y)=>x+y,0)<n&&q<3*n;q++){const x=o[q%o.length];if(u[x.i]<hi)u[x.i]++;}for(let q=0;u.reduce((x,y)=>x+y,0)>n&&q<3*n;q++){const x=o[o.length-1-q%o.length];if(u[x.i]>lo)u[x.i]--;}return u.map(x=>Math.round(x*step*100)/100); }
function candlePattern(prev,last) {
  const body=b=>Math.abs(b.close-b.open), bull=b=>b.close>b.open, bear=b=>b.close<b.open;
  const range=Math.max(last.high-last.low,1), doji=body(last)<=range*.10;
  const engulfBull=bear(prev)&&bull(last)&&last.open<=prev.close&&last.close>=prev.open;
  const engulfBear=bull(prev)&&bear(last)&&last.open>=prev.close&&last.close<=prev.open;
  const dark=bull(prev)&&bear(last)&&last.open>=prev.close&&last.close<(prev.open+prev.close)/2&&last.close>prev.open;
  const piercing=bear(prev)&&bull(last)&&last.open<=prev.close&&last.close>(prev.open+prev.close)/2&&last.close<prev.open;
  const harami=body(last)<body(prev)&&Math.max(last.open,last.close)<=Math.max(prev.open,prev.close)&&Math.min(last.open,last.close)>=Math.min(prev.open,prev.close);
  const upper=last.high-Math.max(last.open,last.close),lower=Math.min(last.open,last.close)-last.low,star=body(last)<=range*.35&&(upper>=body(last)*2||lower>=body(last)*2);
  return {name:engulfBull?'bullish_engulfing':engulfBear?'bearish_engulfing':dark?'dark_cloud':piercing?'piercing':harami?'harami':doji?'doji':star?'star':'none',bullish:engulfBull||piercing,bearish:engulfBear||dark,neutral:harami||doji};
}
// Grimes: uptrend = higher highs AND higher lows; downtrend = lower highs AND lower lows; otherwise range.
function pivotState(bars) { const p=TA.pivots(bars,2),lo=p.lows.slice(-2),hi=p.highs.slice(-2),hasLo=lo.length===2,hasHi=hi.length===2;
 const higher_lows=hasLo&&lo[1].price>lo[0].price,lower_lows=hasLo&&lo[1].price<lo[0].price,higher_highs=hasHi&&hi[1].price>hi[0].price,lower_highs=hasHi&&hi[1].price<hi[0].price;
 const trend=higher_highs&&higher_lows?'up':lower_highs&&lower_lows?'down':'range';
 return {higher_lows,lower_lows,higher_highs,lower_highs,trend,pivots:p}; }
function realizedVolatility(bars,n){const r=[];for(let i=1;i<bars.length;i++)r.push(Math.log(bars[i].close/bars[i-1].close));if(r.length<n)return null;const x=r.slice(-n),m=x.reduce((s,v)=>s+v,0)/n;return Math.sqrt(x.reduce((s,v)=>s+(v-m)**2,0)/(n-1));}
// Sakata new values counted in chronological order: each close beyond the running extreme is one new value;
// an opposite-side new value resets the other count; non-new-value sessions pause but do not reset.
function sakataNewValues(bars,upper,lower) { let up=0,down=0,hi=upper,lo=lower;for(let i=Math.max(0,bars.length-8);i<bars.length;i++){const b=bars[i];if(b.close>hi){up++;down=0;hi=b.close;}else if(b.close<lo){down++;up=0;lo=b.close;}}return {up,down}; }
function sourceFactor(name,raw,contribution,citation){return {name,raw,contribution:typeof contribution==='number'?r2(contribution):contribution,citation};}
// Pure: bars are completed daily sessions filtered before cutoff. V1 stays callable for comparison.
function scoreScenarioWeights({bars,lower,upper,participation,cutoff,dataUpdatedAt,model=WEIGHT_MODEL}) {
 const last=bars.at(-1),cutoffMs=MR.timestamp(cutoff);if(!last||!(lower<upper)||!Number.isFinite(cutoffMs))throw Error('Invalid weight inputs');if(bars.some(b=>MR.timestamp(b.date+'T16:10:00+08:00')>cutoffMs))throw Error('Weight inputs after cutoff');
 const d=TA.calculate(bars),i=bars.length-1,atr=d.atr[i],ma=d.ma20[i],maPrev=d.ma20[i-5];if(![atr,ma,maPrev].every(Number.isFinite)||atr<=0)throw Error('Insufficient history for weights');
 const c=model.coefficients,close=last.close,pos=(close-lower)/(upper-lower),posTerm=clamp(2*pos-1,-1.5,1.5),distA=clamp((upper-close)/atr,0,4),distC=clamp((close-lower)/atr,0,4),slope=clamp((ma-maPrev)/atr,-1,1),rel=clamp((close-ma)/atr,-1,1),trend=.5*slope+.5*rel;
 const breadthOK=!!participation&&participation.as_of===last.date&&Number.isFinite(MR.timestamp(participation.updated_at))&&MR.timestamp(participation.updated_at)<=cutoffMs&&MP.validate(participation,last.date).ok,breadth=breadthOK?MP.signal(participation).score:0;
 if(model.version==='rule-weights-v1'){const tilt=c.position*posTerm+c.trend*trend+(breadthOK?c.breadth*breadth:0),logits={A:tilt-c.distance*distA,B:c.range_base,C:-tilt-c.distance*distC};return finish(logits,{baseline_date:last.date,close,lower,upper,atr14:r2(atr),position:r2(pos),breadth_status:breadthOK?'available':'unavailable'},[],model);}
 const ps=pivotState(bars),width=(upper-lower)/atr,range=ps.trend==='range';let a=c.position*posTerm+c.trend*trend+(breadthOK?c.breadth*breadth:0)-c.distance*distA,cc=-c.position*posTerm-c.trend*trend-(breadthOK?c.breadth*breadth:0)-c.distance*distC,b=c.range_base;
 const factors=[];const add=(name,raw,da,db,dc,citation)=>{a+=da;b+=db;cc+=dc;factors.push(sourceFactor(name,raw,{A:da,B:db,C:dc},citation));};
 add('regime_gate',{range,trend:ps.trend,width_atr:r2(width),higher_highs:ps.higher_highs,higher_lows:ps.higher_lows,lower_highs:ps.lower_highs,lower_lows:ps.lower_lows},range?-c.regime_range:0,range?c.regime_range:0,range?-c.regime_range:0,'Grimes《艺术与科学》Ch.1, PDF pp.37-49');
 const nearA=distA<=.75,nearC=distC<=.75;add('breakout_quality',{near_a:nearA,higher_lows:ps.higher_lows,near_c:nearC,lower_highs:ps.lower_highs},nearA?(ps.higher_lows?c.breakout_quality:-c.breakout_quality):0,0,nearC?(ps.lower_highs?c.breakout_quality:-c.breakout_quality):0,'Grimes Ch.1 PDF pp.47-49,82-84；《作手回忆录》关键位确认');
 const nv=sakataNewValues(bars,upper,lower),exUp=nv.up>=3,exDown=nv.down>=3;add('sakata_new_value',{up: nv.up,down:nv.down,exhaustion:exUp?'up':exDown?'down':'none'},exUp?-c.sakata_exhaustion:exDown?c.sakata_exhaustion:0,(exUp||exDown)?c.sakata_exhaustion:0,exDown?-c.sakata_exhaustion:exUp?c.sakata_exhaustion:0,'《定本酒田战法》Ch.2/Ch.6；3/5为经验节奏，非HSI概率');
 const pat=candlePattern(bars[i-1],last),middle=pos>.35&&pos<.65;add('candle_pattern',{pattern:pat.name,position:r2(pos)},pat.bullish?c.candle:pat.bearish?-c.candle:0,(pat.neutral&&middle)?c.candle:0,pat.bearish?c.candle:pat.bullish?-c.candle:0,'Nison《日本蜡烛图技术》Ch.4-8：形态须结合位置并待确认');
 const hv10=realizedVolatility(bars,10),hv20=realizedVolatility(bars,20),ratio=hv10&&hv20?hv10/hv20:null,contracted=ratio!=null&&ratio<.85,expanded=ratio!=null&&ratio>1.15;add('realized_volatility',{hv10:r2(hv10||0),hv20:r2(hv20||0),ratio:r2(ratio||0),iv_status:'unavailable'},expanded?c.volatility:0,contracted?c.volatility:0,expanded?c.volatility:0,'Natenberg《期权波动率》Ch.4 PDF p.82；仓库无IV，仅HV状态，非方向信号');
 const stale=dataUpdatedAt!=null&&(!Number.isFinite(MR.timestamp(dataUpdatedAt))||MR.timestamp(dataUpdatedAt)<MR.timestamp(last.date+'T16:10:00+08:00'));
 const previousDate=bars[i-1]?.date,gap=Math.abs(last.open-bars[i-1].close)/atr,holidayFirst=previousDate&&Math.round((new Date(last.date+'T12:00:00+08:00')-new Date(previousDate+'T12:00:00+08:00'))/86400000)>3,shrink=(stale||holidayFirst?c.stale_shrink:0)+(gap>1.5?c.gap_shrink:0);if(shrink){a=a*(1-shrink)+shrink/3;b=b*(1-shrink)+shrink/3;cc=cc*(1-shrink)+shrink/3;}factors.push(sourceFactor('market_state_gate',{holiday_first:holidayFirst,gap_atr:r2(gap),stale},shrink?{shrink:r2(shrink)}:{shrink:0},'Harris《交易与交易所》Ch.5/6/20 PDF pp.110-148,423-430'));
 return finish({A:a,B:b,C:cc},{baseline_date:last.date,close,lower,upper,atr14:r2(atr),position:r2(pos),dist_a_atr:r2(distA),dist_c_atr:r2(distC),trend:r2(trend),breadth:breadthOK?r2(breadth):null,breadth_status:breadthOK?'available':'unavailable',regime:range?'range':'trend'},factors,model);
}
function finish(logits,factors,weightFactors,model){const mx=Math.max(logits.A,logits.B,logits.C),ex=['A','B','C'].map(k=>Math.exp(logits[k]-mx)),sum=ex.reduce((a,b)=>a+b,0),raw=ex.map(x=>x/sum),p=boundedRound(raw,model.bounds),cite=weightFactors.map(f=>f.citation).join('；');const breadthNote=factors.breadth_status==='unavailable'?'；宽度数据不可用，因子权重置0':'';const basis={A:'仅完整日K；'+cite+breadthNote+'。A '+(factors.regime==='range'?'受区间门控压低':'按结构评分')+'。',B:'仅完整日K；'+cite+breadthNote+'。B '+(factors.regime==='range'?'获区间门控加权':'为区间基准')+'。',C:'仅完整日K；'+cite+breadthNote+'。C '+(factors.regime==='range'?'受区间门控压低':'按结构评分')+'。'};return {version:model.version,probabilities:{A:p[0],B:p[1],C:p[2]},raw:{A:r2(raw[0]),B:r2(raw[1]),C:r2(raw[2])},basis,factors:{...factors,logits:{A:r2(logits.A),B:r2(logits.B),C:r2(logits.C)}},weight_factors:weightFactors};}
// Production weights = rule-weights-v4 (from the 2026-10-13 pre-open; approved 2026-10-12): multinomial LR on v3's
// features + pre-open overnight US/FX inputs (scripts/v4-weights.cjs, frozen research/v4/model-v4.json).
// v3 and v1 are always computed on the same inputs as shadows (weight_model_info.shadow).
// Fail-closed: if the overnight snapshot is missing, fetched after the cutoff, stale, or inconsistent, v4 is NOT
// evaluated with blanks — production falls back to v3 and the fallback is annotated (weight_model_info.fallback,
// probability_basis, reasoning, environment_evidence.overnight).
const US_SERIES=['EWH','GSPC','IXIC','FXI','KWEB'];
const pct=v=>(v>=0?'+':'')+(v*100).toFixed(2)+'%';
function daysBetween(a,b){return Math.round((Date.parse(b+'T12:00:00Z')-Date.parse(a+'T12:00:00Z'))/864e5);}
// Validates the overnight snapshot and returns v4-ready bars (futu OHLC + Yahoo HSI share volume by date) or throws.
function prepareOvernight({bars,cutoff,overnight}) {
  if(!overnight)throw Error('未提供盘前隔夜数据');
  if(overnight.status!=='available')throw Error('盘前隔夜数据拉取失败：'+((overnight.errors||[]).join('；')||overnight.status));
  const fetched=MR.timestamp(overnight.fetched_at),cutoffMs=MR.timestamp(cutoff);
  if(!Number.isFinite(fetched)||fetched>cutoffMs)throw Error('隔夜数据快照晚于信息截止时间');
  const session=MR.hk(cutoffMs).date,S=overnight.series||{},last=bars.at(-1);
  const lastBefore=k=>{const rows=(S[k]||[]).filter(r=>r.date<session&&Number.isFinite(r.close)&&r.close>0);return rows.at(-1)||null;};
  for(const k of [...US_SERIES,'VIX','CNY','HSI'])if(!lastBefore(k))throw Error('缺少隔夜序列 '+k);
  const usDates=US_SERIES.map(k=>lastBefore(k).date);
  if(new Set(usDates).size!==1)throw Error('美股/ETF 最新收盘日期不一致（'+US_SERIES.map((k,i)=>k+' '+usDates[i]).join('，')+'）');
  if(daysBetween(usDates[0],session)>4)throw Error('美股最新收盘 '+usDates[0]+' 已过期');
  if(lastBefore('VIX').date<usDates[0])throw Error('VIX 最新收盘早于美股');
  if(daysBetween(lastBefore('CNY').date,session)>5)throw Error('USD/CNY 已过期');
  // HSI volume (Yahoo shares, same as research) joined by date; baseline close must agree with the production feed.
  const vol=new Map((S.HSI||[]).filter(r=>r.date<session).map(r=>[r.date,r]));
  const yb=vol.get(last.date);if(!yb)throw Error('Yahoo 恒指缺少基准日 '+last.date);
  if(Math.abs(yb.close-last.close)/last.close>0.001)throw Error('Yahoo 恒指基准日收盘与生产K线不一致');
  const out=bars.map(b=>({...b,volume:vol.get(b.date)?.volume}));
  if(!out.slice(-21).every(b=>Number.isFinite(b.volume)&&b.volume>0))throw Error('恒指近21日成交量不完整');
  return {bars:out,series:Object.fromEntries(Object.entries(S).filter(([k])=>k!=='HSI').map(([k,v])=>[k,v.map(r=>({date:r.date,close:r.close}))])),us_date:usDates[0]};
}
function productionWeights(args) {
  const V3=require('./weights-v3.cjs'),V4=require('./v4-weights.cjs'); // lazy: both require this module
  const v1=scoreScenarioWeights({...args,model:WEIGHT_MODEL_V1});
  const v3=V3.scoreScenarioWeightsV3({bars:args.bars,lower:args.lower,upper:args.upper,cutoff:args.cutoff});
  const zone={A:'收于A区',B:'收于B区',C:'收于C区'}[v3.factors.prev_zone]||'未知';
  const posPct=Math.round((args.bars.at(-1).close-args.lower)/Math.max(args.upper-args.lower,1)*100);
  const shadow={'rule-weights-v3':v3.probabilities,'rule-weights-v1':v1.probabilities};
  let v4=null,prep=null,fallbackReason=null;
  try {prep=prepareOvernight(args);v4=V4.scoreScenarioWeightsV4({bars:prep.bars,lower:args.lower,upper:args.upper,cutoff:args.cutoff,overnight:prep.series});}
  catch(e){fallbackReason=e.message;v4=null;}
  if(v4) {
    const x=v4.features;
    // Same differencing as featuresV4: last close before the session minus last close before the HK baseline.
    const mv=k=>{const rows=prep.series[k],s=MR.hk(MR.timestamp(args.cutoff)).date,b=args.bars.at(-1).date,lb=d=>rows.filter(r=>r.date<d).at(-1);return Math.log(lb(s).close/lb(b).close);};
    const ovn='EWH '+pct(mv('EWH'))+'、FXI '+pct(mv('FXI'))+'、KWEB '+pct(mv('KWEB'))+'、标普 '+pct(mv('GSPC'))+'、纳指 '+pct(mv('IXIC'))+'、VIX '+pct(mv('VIX'))+'、USD/CNY '+pct(mv('CNY'));
    const common='逻辑回归 v4（2014-03~2025-12 训练 n=2860；2016–2025 逐年滚动回测 Brier 0.259 vs v3重训 0.276，10/10 年胜出）；输入：v3 全部特征（前一日'+zone+'、区间位置 '+posPct+'%、ADX14 '+(v3.factors.adx14??'—')+'、'+(v3.factors.regime==='range'?'震荡':'趋势')+'结构）+ 盘前隔夜（截至美股 '+prep.us_date+' 收盘：'+ovn+'）、EWH 隐含开盘位置、距边界 ATR、前日量比；不含宽度/南向/夜期（无可靠历史）';
    const r=v4.raw;
    return {version:V4.WEIGHT_MODEL_V4.version,probabilities:v4.probabilities,raw:{A:r2(r[0]),B:r2(r[1]),C:r2(r[2])},
      basis:{A:common+'。',B:common+'。',C:common+'。'},
      factors:{...v1.factors,...v3.factors,breadth:null,breadth_status:'not_used',shadow_v1:v1.probabilities,shadow_v3:v3.probabilities,overnight_us_date:prep.us_date,v4_features:Object.fromEntries(Object.entries(x).map(([k,v])=>[k,Math.round(v*1e4)/1e4]))},
      shadow,fallback:null,
      overnight:{status:'available',source:args.overnight.source,fetched_at:args.overnight.fetched_at,us_close_date:prep.us_date,symbols:args.overnight.symbols||null},
      weight_factors:[{name:'logistic_v4',raw:Object.fromEntries(Object.entries(x).map(([k,v])=>[k,Math.round(v*1e4)/1e4])),contribution:null,citation:'research/v4/report.md（30e9c81）'}],
      calibration:'2016–2025 逐年滚动回测（n=2434）验证，未经实盘校准；ECE 0.079 略高于 v3（概率更敢）',
      model:{W:V4.WEIGHT_MODEL_V4.W,features:V4.WEIGHT_MODEL_V4.features,standardize:V4.WEIGHT_MODEL_V4.standardize,source:V4.WEIGHT_MODEL_V4.source}};
  }
  const common='v4 盘前隔夜数据不可用（'+fallbackReason+'），已回退 v3。逻辑回归 v3（2024-10~2025-12 训练、2026-05~10 保留集 Brier 0.344 vs v1 0.406）；输入：v1 打分、前一日'+zone+'、区间位置 '+posPct+'%、ADX14 '+(v3.factors.adx14??'—')+'、'+(v3.factors.regime==='range'?'震荡':'趋势')+'结构；不含宽度/南向（回测无增量）';
  return {version:V3.WEIGHT_MODEL_V3.version,probabilities:v3.probabilities,raw:v3.raw,
    basis:{A:common+'。',B:common+'。',C:common+'。'},
    factors:{...v1.factors,...v3.factors,breadth:null,breadth_status:'not_used',shadow_v1:v1.probabilities},
    shadow:{'rule-weights-v1':v1.probabilities},
    fallback:{intended:V4.WEIGHT_MODEL_V4.version,used:V3.WEIGHT_MODEL_V3.version,reason:fallbackReason},
    overnight:{status:'unavailable',reason:fallbackReason,source:args.overnight?.source||null,fetched_at:args.overnight?.fetched_at||null},
    weight_factors:[{name:'logistic_v3',raw:v3.factors.features,contribution:null,citation:'research/optimization/report.md（c692d60）'}],
    calibration:'回测保留集验证（n≈100），未经实盘校准；本次为 v4 数据缺失时的回退',
    model:V3.WEIGHT_MODEL_V3};
}
const fmt = n => n.toLocaleString('en-US', {maximumFractionDigits:2});
// Execution policy (round1 A1, 2026-10-19; tb-backtest-abc.md): A and C are display-only. With the real card levels,
// 2016–2025 triple-barrier E[R] after 0.15R cost: A −0.23R [−0.46,+0.02]; C −0.07R [−0.33,+0.21]; card RR≥2 C −0.39R [−0.68,−0.08].
// Live builds only (executionPolicy=!backfill) so frozen backfills/supplements stay byte-for-byte reproducible.
const DISPLAY_ONLY=Object.freeze(['A','C']);
const PROBABILITY_DEFINITION='次日收盘落在哪个区间（T+1 收盘落区：A ≥ 上边界 / B 区间内 / C < 下边界）；不是 5 日内先到目标的概率，也不是胜率。';
const EXECUTION_NOTE={A:'仅展示·不推荐执行：按真实卡片价位做三重屏障回测（2016–2025，次日开盘入场，5 日），A 扣 0.15R 成本后 E[R] −0.23R [−0.46,+0.02]；触发后 63% 次日开盘已越过目标。',
  C:'仅展示·不推荐执行：按真实卡片价位做三重屏障回测（2016–2025，次日开盘入场，5 日），C 扣 0.15R 成本后 E[R] −0.07R [−0.33,+0.21]；卡片赔率≥2 的 C 为 −0.39R [−0.68,−0.08]。赔率≥2:1 不等于可执行。'};
function build({date, feed, seed, participation, overnight=null, generatedAt, backfill=false, provenance={}, ruleWeights=!backfill, executionPolicy=!backfill, scoredReviews=0}) {
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
  const weights=ruleWeights?productionWeights({bars,lower,upper,participation,overnight,cutoff,dataUpdatedAt:feed.updated_at}):null;
  const priceRules={A:{operator:'gte',value:upper},B:{operator:'range',lower,upper},C:{operator:'lt',value:lower}};
  const scenarios=['A','B','C'].map((key,i)=>{
    const dir=i===0?'long':'short', entry=i===2?lower:upper;
    const stop=i===0?last.low:i===1?(upTarget||upper):last.high;
    const target=i===0?upTarget:downTarget;
    const trigger=i===0?'收盘 ≥ '+fmt(upper):i===1?'收盘 ≥ '+fmt(lower)+' 且 < '+fmt(upper):'收盘 < '+fmt(lower);
    return {id:key,name:key+' · '+['收复最近摆动高点','摆动区间内整理','跌破最近摆动低点'][i],direction:dir,probability:weights?weights.probabilities[key]:null,...(weights?{probability_basis:weights.basis[key],...(weights.factors.breadth_status==='available'?{probability_includes_breadth:true}:{}),...(weights.factors.breadth_status==='not_used'?{probability_locked:true,probability_model:weights.version}:{})}:{}),
      ...(executionPolicy?{execution_status:DISPLAY_ONLY.includes(key)?'display_only':'plan_candidate',...(DISPLAY_ONLY.includes(key)?{execution_note:EXECUTION_NOTE[key]}:{}),...(weights?{probability_definition:PROBABILITY_DEFINITION}:{})}:{}),
      color:['#00d87f','#a78bfa','#ff8c42'][i],trigger:trigger+'；只看完整日K价格结构',price_rule:priceRules[key],
      invalidation:(dir==='long'?'收盘 < ':'收盘 ≥ ')+fmt(stop),
      rr:{entry,stop,target,direction:dir,entryHint:'条件确认之后再观察结构位回测；价格满足赔率不等于触发。'},
      risk:{structural_invalidation:{price:stop,confirmation:'completed_daily_close'},disaster_stop:{price:null,status:'not_configured'}},
      target:target==null?'缺少已观察到的目标结构，赔率不可用':fmt(target)+'（已观察到的结构位）',
      holding_period:'每日重新核验，不承诺固定持仓天数',note:weights?(weights.fallback?'规则生成的条件情景；v4 盘前数据不可用，权重回退为 '+weights.version+' 模型输出（两年回测、约100天保留集验证），不是历史胜率。':'规则生成的条件情景；权重为 '+weights.version+' 模型输出，经 2016–2025 逐年滚动回测（n=2434）验证，未经实盘校准，不是历史胜率。'):'规则生成的条件情景；未校准历史发生率，不提供概率百分比。',
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
    disclaimer:'条件式价格结构分析；'+(weights?(weights.fallback?'权重为 '+weights.version+'（v4 盘前隔夜数据不可用，已回退；逻辑回归，回测保留集优于v1，样本有限）。':'权重为 '+weights.version+'（逻辑回归+盘前隔夜特征，2016–2025 逐年滚动回测优于v3，未经实盘校准）。'):'权重尚未校准。')+'补录不参与预测命中率、Brier或实时入场判断。',
    forecast:{applicable_date:date,updatedAt:time,baseDate:last.date,basePrice:last.close,bias:summary.structure.direction<0?'bearish':summary.structure.direction>0?'bullish':'neutral',biasLabel:summary.structure.label,
      summary:narrative,horizon:'未来5个交易日，每日重新核验',horizonEndDate:MR.horizon(date,5).end,horizonDesc:MR.horizon(date,5).description,
      reasoning:[narrative,'A/B/C 分别覆盖 ≥上边界、两边界之间、<下边界；盘中穿越不算正式触发。','夜期、IV、南向资金无截止前可信快照时不可用，不用于推断。',...(weights?[weights.fallback?'权重模型：v4 盘前隔夜数据不可用（'+weights.fallback.reason+'），本次回退 v3，不用空值或插值。':'权重模型：v4，使用截至美股 '+weights.overnight.us_close_date+' 收盘的隔夜数据（Yahoo），v3/v1 作为影子同时记录。']:[]),participantOK?'环境证据：'+participation.as_of+' 官方成分报告上涨家数占比 '+(participation.metrics.equal_name_breadth*100).toFixed(1)+'%、上涨权重占比 '+(participation.metrics.weighted_breadth*100).toFixed(1)+'%、净点数贡献 '+fmt(participation.metrics.net_point_contribution)+'；只描述环境，不改变价格触发。':'环境证据：无符合截止时间的官方成分报告，标记不可用。'],
      targetUpper:upTarget,targetLower:downTarget,confidence:'未校准',...(executionPolicy?{probability_definition:PROBABILITY_DEFINITION,execution_policy:{display_only:[...DISPLAY_ONLY],source:'tb-backtest-abc（三重屏障，真实卡片价位，2016–2025）',decided:'2026-10-19'}}:{}),scenarios,
      ...(weights?{weight_model:weights.version,weight_model_info:{version:weights.version,calibration:weights.calibration,scored_reviews:scoredReviews,shadow:weights.shadow,fallback:weights.fallback,coefficients:weights.model?{W:weights.model.W,features:weights.model.features,...(weights.model.standardize?{standardize:weights.model.standardize,source:weights.model.source}:{})}:WEIGHT_MODEL.coefficients,factors:weights.factors,raw_probabilities:weights.raw},weight_factors:weights.weight_factors}: {}),
      card:{stateEmoji:'📋',stateLabel:backfill?date+' 事后补录分析':date+' 每日结构分析',structureLine:narrative,stateTone:'neutral',keyLines:[{price:lower,tag:'最近确认摆动低点',tf:'日线'},{price:upper,tag:'最近确认摆动高点',tf:'日线'}]},
      scenario_evidence:{analysis_id:id,last_bar:{...last,completed:true},timeframe:'1d',source:feed.source,scenarios:{}}},
    environment_evidence:{volume_ratio:{status:ratio==null?'unavailable':'available',value:ratio,basis:'previous_20_completed_sessions'},participation:{status:participantOK?'available':'unavailable',as_of:participantOK?participation.as_of:null,metrics:participantOK?participation.metrics:null,source:participantOK?participation.source:null},...(weights?{overnight:weights.overnight}:{}),night_futures:{status:'unavailable'},options_risk:{status:'unavailable'},southbound:{status:'unavailable'}},
    intraday_playbook:{updatedAt:time,note:'仅用于区间定位，不是即时操作指令',zones:[{range:[upper,null],stance:'修复观察',action:'等待A收盘确认'},{range:[lower,upper],stance:'区间观察',action:'等待B收盘确认'},{range:[null,lower],stance:'破位观察',action:'等待C收盘确认'}]},
    levels:[{price:lower,type:'support',label:'最近确认摆动低点',reason:pivots.lows.at(-1).time+'，确认于 '+pivots.lows.at(-1).confirmedAt},{price:upper,type:'resistance',label:'最近确认摆动高点',reason:pivots.highs.at(-1).time+'，确认于 '+pivots.highs.at(-1).confirmedAt},...(downTarget==null?[]:[{price:downTarget,type:'support',label:'下方结构目标',reason:'截止日前的确认摆动低点或既有支撑'}]),...(upTarget==null?[]:[{price:upTarget,type:'resistance',label:'上方结构目标',reason:'截止日前的确认摆动高点或既有阻力'}])],markers:[],playbook:[],pathTree:null};
}
module.exports={DISPLAY_ONLY,PROBABILITY_DEFINITION,build,prepareOvernight,judge:MR.priceCondition,scoreScenarioWeights,boundedRound,candlePattern,pivotState,sakataNewValues,WEIGHT_MODEL,WEIGHT_MODEL_V1,WEIGHT_MODEL_V2};
