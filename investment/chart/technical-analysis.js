/* Deterministic indicators, calculated from the chart's OHLC source.
 * RSI/ATR: Wilder smoothing, SMA seed. MACD: EMA12-EMA26, EMA9 signal,
 * each EMA seeded by its initial SMA; histogram=DIF-DEA (no x2).
 * References: TradingView support RSI, ATR, MACD. No future bars in indicators.
 */
(function(root,factory){
  if(typeof module==='object'&&module.exports) module.exports=factory();
  else root.TechnicalAnalysis=factory();
})(typeof self!=='undefined'?self:this,function(){
  'use strict';
  function mean(values,n){
    var out=values.map(function(){return null;}),sum=0,count=0;
    values.forEach(function(v,i){
      if(Number.isFinite(v)){sum+=v;count++;}
      if(i>=n && Number.isFinite(values[i-n])){sum-=values[i-n];count--;}
      if(i>=n-1 && count===n)out[i]=sum/n;
    });return out;
  }
  function smooth(values,n,alpha){
    var out=values.map(function(){return null;}),seed=[],prev=null;
    values.forEach(function(v,i){
      if(!Number.isFinite(v)){seed=[];prev=null;return;}
      if(prev==null){seed.push(v);if(seed.length===n)prev=seed.reduce(function(a,b){return a+b;},0)/n;}
      else prev+=alpha*(v-prev);
      out[i]=prev;
    });return out;
  }
  function calculate(bars){
    var c=bars.map(function(b){return b.close;}),gain=[null],loss=[null];
    for(var i=1;i<c.length;i++){gain.push(Math.max(0,c[i]-c[i-1]));loss.push(Math.max(0,c[i-1]-c[i]));}
    var g=smooth(gain,14,1/14),l=smooth(loss,14,1/14);
    var rsi=c.map(function(_,i){return g[i]==null?null:l[i]===0?(g[i]===0?50:100):100-100/(1+g[i]/l[i]);});
    var tr=bars.map(function(b,i){return i===0?b.high-b.low:Math.max(b.high-b.low,Math.abs(b.high-c[i-1]),Math.abs(b.low-c[i-1]));});
    var atr=smooth(tr,14,1/14),fast=smooth(c,12,2/13),slow=smooth(c,26,2/27);
    var dif=c.map(function(_,i){return fast[i]==null||slow[i]==null?null:fast[i]-slow[i];});
    var dea=smooth(dif,9,2/10),hist=dif.map(function(v,i){return v==null||dea[i]==null?null:v-dea[i];});
    return {rsi:rsi,atr:atr,dif:dif,dea:dea,hist:hist,ma20:mean(c,20),ma60:mean(c,60)};
  }
  function pivots(bars,width){
    width=width||2;var highs=[],lows=[];
    for(var i=width;i<bars.length-width;i++){
      var high=true,low=true;
      for(var j=i-width;j<=i+width;j++)if(j!==i){
        high=high&&bars[i].high>bars[j].high;low=low&&bars[i].low<bars[j].low;
      }
      if(high)highs.push({index:i,price:bars[i].high,time:bars[i].time,confirmedAt:bars[i+width].time});
      if(low)lows.push({index:i,price:bars[i].low,time:bars[i].time,confirmedAt:bars[i+width].time});
    }return {highs:highs,lows:lows};
  }
  function structure(bars){
    var p=pivots(bars,2),h=p.highs.slice(-2),l=p.lows.slice(-2),label='摆动点不足',direction=0;
    if(h.length===2&&l.length===2){
      if(h[1].price>h[0].price&&l[1].price>l[0].price){label='高点抬高 / 低点抬高';direction=1;}
      else if(h[1].price<h[0].price&&l[1].price<l[0].price){label='高点降低 / 低点降低';direction=-1;}
      else label='结构分歧 / 区间';
    }
    var last=bars[bars.length-1];
    return {label:label,direction:direction,high:h[h.length-1]||null,low:l[l.length-1]||null,
      breakout:!last?'':h.length&&last.close>h[h.length-1].price?'收盘突破前摆动高点':
        l.length&&last.close<l[l.length-1].price?'收盘跌破前摆动低点':'未突破最近摆动边界'};
  }
  function summary(bars){
    var confirmed=bars.filter(function(b){return !b.partial;}),d=calculate(confirmed),i=confirmed.length-1;
    if(i<0)return null;
    return {bar:confirmed[i],count:confirmed.length,rsi:d.rsi[i],atr:d.atr[i],dif:d.dif[i],dea:d.dea[i],hist:d.hist[i],
      ma20:d.ma20[i],ma60:d.ma60[i],structure:structure(confirmed)};
  }
  function gaps(bars){
    var out=[];
    for(var i=1;i<bars.length;i++){
      var prev=bars[i-1],b=bars[i],up=b.low>prev.high,down=b.high<prev.low;
      if(!up&&!down)continue;
      var lower=up?prev.high:b.high,upper=up?b.low:prev.low,edge=up?upper:lower,status='未回补',filledAt=null;
      for(var j=i+1;j<bars.length;j++){
        edge=up?Math.min(edge,bars[j].low):Math.max(edge,bars[j].high);
        if(up?edge<=lower:edge>=upper){status='完全回补';filledAt=bars[j].time;break;}
        if(up?edge<upper:edge>lower)status='部分回补';
      }
      out.push({time:b.time,lower:lower,upper:upper,direction:up?'向上':'向下',status:status,filledAt:filledAt});
    }return out;
  }
  function levelState(level,bars,atr){
    if(!bars.length||!Number.isFinite(level.price))return null;
    var tolerance=Number.isFinite(atr)?atr*0.1:level.price*0.001;
    var near=false,touches=0,broken=null,retest=null;
    var resistance=level.type==='resistance';
    bars.forEach(function(b){
      var date=typeof b.time==='string'?b.time:typeof b.time==='object'?b.time.year+'-'+String(b.time.month).padStart(2,'0')+'-'+String(b.time.day).padStart(2,'0'):'';
      if(level.formedAt && date<level.formedAt)return;
      var touch=b.low<=level.price+tolerance&&b.high>=level.price-tolerance;
      if(touch&&!near)touches++;near=touch;
      if(broken&&touch&& (resistance?b.close>level.price+tolerance:b.close<level.price-tolerance))retest=b.time;
      if(resistance?b.close>level.price+tolerance:b.close<level.price-tolerance){if(!broken)broken=b.time;}
    });
    return {touches:touches,tolerance:tolerance,brokenAt:broken,retestAt:retest,
      status:!level.formedAt?'观察统计（形成日期未提供）':retest?'突破后回踩保持':broken?'曾收盘突破':'尚未收盘突破'};
  }
  return {calculate:calculate,summary:summary,pivots:pivots,structure:structure,gaps:gaps,levelState:levelState};
});
