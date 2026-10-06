(function(root){
  'use strict';
  var TA=root.TechnicalAnalysis, MR=root.MarketRules;
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function num(n){return Number.isFinite(n)?n.toFixed(2):'—';}
  function time(t){return typeof t==='number'?new Date(t*1000).toISOString().slice(0,16).replace('T',' '):MR.dayString(t);}
  root.TechnicalPanel=function(main,load){
    var panes=[],state=null,others={},pending={};
    var summary=document.getElementById('technicalSummary'),rows=document.getElementById('timeframeRows');
    var details=document.getElementById('indicatorDetails');
    function historical(bars,iv){
      if(!state.date)return bars;
      bars=bars||[];
      var cutoff=state.annotations&&state.annotations.forecast&&state.annotations.forecast.baseDate||state.date;
      var frozenAt=MR.timestamp(cutoff+'T16:10:00');
      return bars.filter(function(b){return MR.dayString(b.time)<=cutoff && !MR.markBars([b],iv||state.iv,frozenAt)[0].partial;});
    }
    function selectedBars(){return historical(state.bars,state.iv);}
    function renderMetrics(){
      var bars=selectedBars(),s=TA.summary(bars),preview=bars.length&&bars[bars.length-1].partial;
      summary.innerHTML=['RSI14','MACD柱','ATR14'].map(function(label,i){
        var value=s?[s.rsi,s.hist,s.atr][i]:null;
        var note=i===0?'动量强弱，不等于反转信号':i===1?'DIF − DEA（不乘2）':'真实波幅，仅衡量波动';
        return '<div class="technical-metric"><span>'+label+'</span><b>'+num(value)+'</b><span>'+note+'</span></div>';
      }).join('');
      document.getElementById('technicalBasis').textContent=s?
        (state.date?'历史基准':'最近已收盘')+'：'+time(s.bar.time)+' · '+state.source+' · '+s.count+' 根已收盘K线'+(preview?' · 最新未收盘K线只作副图预览':''):'已收盘样本不足，等待数据';
      renderFrames();renderLevels();if(details.open)renderPlots();
    }
    function renderFrames(){
      var dirs=[];
      rows.innerHTML=['1wk','1d','60m'].map(function(iv){
        var data=iv===state.iv?{bars:state.bars,source:state.source}:others[iv];
        var s=data&&data.bars&&TA.summary(historical(data.bars,iv));
        if(!s)return '<tr><td>'+({'1wk':'周线背景','1d':'日线结构','60m':'60分钟节奏'})[iv]+'</td><td colspan="3">'+(data&&data.error?'行情获取失败，未生成判断':data?'已收盘样本不足，未生成判断':'加载已收盘数据…')+'</td></tr>';
        dirs.push(s.structure.direction);
        var st=s.structure,levels=(st.high?'高点 '+num(st.high.price)+'（'+time(st.high.time)+'）':'')+(st.low?' / 低点 '+num(st.low.price)+'（'+time(st.low.time)+'）':'');
        return '<tr><td>'+({'1wk':'周线背景','1d':'日线结构','60m':'60分钟节奏'})[iv]+'<small>'+esc(data.source)+' · '+time(s.bar.time)+'</small></td><td>'+esc(st.label)+'<small>'+esc(levels)+'</small></td><td>'+esc(st.breakout)+'</td><td>RSI '+num(s.rsi)+'<small>MA20 '+num(s.ma20)+' / MACD柱 '+num(s.hist)+'</small></td></tr>';
      }).join('');
      document.getElementById('timeframeConflict').textContent=dirs.length<3?'周期数据未齐，暂不评价共振':dirs.indexOf(1)>=0&&dirs.indexOf(-1)>=0?'周期结构冲突：背景与节奏不同向，不能合并为单一确认信号。':dirs.every(function(d){return d===1;})?'三个周期摆动结构同向抬高；这只描述结构，不代表已满足情景入场条件。':dirs.every(function(d){return d===-1;})?'三个周期摆动结构同向降低；仍需分别核对情景确认条件。':'部分周期结构分歧或摆动点不足，暂无一致结构。';
    }
    function renderLevels(){
      var daily=state.iv==='1d'?state.bars:others['1d']&&others['1d'].bars;
      var list=document.getElementById('levelLifecycle');
      if(!daily){list.textContent='日线数据加载中';return;}
      var bars=historical(daily,'1d').filter(function(b){return !b.partial;}),s=TA.summary(bars);
      var levels=state.annotations&&state.annotations.levels||[];
      list.innerHTML=levels.map(function(l){
        var st=TA.levelState(l,bars,s&&s.atr);if(!st)return '';
        var distance=s&&s.atr>0?Math.abs(l.price-s.bar.close)/s.atr:null;
        return '<li><b>'+esc(l.label||l.price)+'</b> · '+num(l.price)+' · '+esc(st.status)+'<br>独立触碰 '+st.touches+' 次 · 容差 '+num(st.tolerance)+' 点'+(distance!=null?' · 距基准 '+distance.toFixed(2)+' ATR':'')+'<br>'+esc(l.reason||'')+(l.formedAt?' · 形成 '+esc(l.formedAt):' · 未提供形成日期，统计覆盖已加载窗口，不用于判定正式失效')+'</li>';
      }).join('');
      var gaps=TA.gaps(bars).slice(-5).reverse();
      document.getElementById('gapLifecycle').innerHTML=gaps.length?gaps.map(function(g){return '<li>'+time(g.time)+' · '+g.direction+'缺口 '+num(g.lower)+'–'+num(g.upper)+' · '+g.status+(g.filledAt?'（'+time(g.filledAt)+'）':'')+'</li>';}).join(''):'当前窗口未检测到完整高低价跳空缺口';
    }
    function initPlots(){
      if(panes.length)return;
      ['rsi','macd','atr'].forEach(function(id){
        var host=document.getElementById('pane-'+id);
        var c=LightweightCharts.createChart(host,{width:host.clientWidth,height:host.clientHeight,
          layout:{background:{type:'solid',color:'#1c1c1e'},textColor:'#9299a7',fontSize:10},
          grid:{vertLines:{color:'#292a30'},horzLines:{color:'#292a30'}},
          rightPriceScale:{minimumWidth:70,borderColor:'#33343a'},timeScale:{borderColor:'#33343a',timeVisible:state.iv==='60m'||state.iv==='15m'},
          handleScroll:false,handleScale:false});
        var lines=id==='macd'?[c.addLineSeries({color:'#f5c842',lineWidth:1}),c.addLineSeries({color:'#0a84ff',lineWidth:1}),c.addHistogramSeries({priceLineVisible:false})]:[c.addLineSeries({color:id==='rsi'?'#bf5af2':'#32ade6',lineWidth:1})];
        if(id==='rsi')[30,70].forEach(function(v){lines[0].createPriceLine({price:v,color:'#626773',lineWidth:1,lineStyle:2,axisLabelVisible:true,title:''});});
        if(id==='macd')lines[0].createPriceLine({price:0,color:'#626773',lineWidth:1,lineStyle:2});
        panes.push({id:id,chart:c,lines:lines,host:host});
      });
    }
    function renderPlots(){
      if(!state)return;initPlots();var bars=selectedBars(),d=TA.calculate(bars);
      panes.forEach(function(p){
        p.chart.applyOptions({width:p.host.clientWidth,height:p.host.clientHeight,timeScale:{timeVisible:state.iv==='60m'||state.iv==='15m'}});
        var arrays=p.id==='macd'?[d.dif,d.dea,d.hist]:[d[p.id]];
        arrays.forEach(function(arr,i){p.lines[i].setData(bars.map(function(b,j){
          return arr[j]==null?{time:b.time}:{time:b.time,value:arr[j],color:p.id==='macd'&&i===2?(arr[j]>=0?'#ff453a':'#32d74b'):undefined};
        }));});
      });sync();
    }
    function sync(){if(!details.open)return;var range=main.timeScale().getVisibleRange();if(range)panes.forEach(function(p){if(p.lines[0].data().length)try{p.chart.timeScale().setVisibleRange(range);}catch(e){}});}
    main.timeScale().subscribeVisibleTimeRangeChange(sync);
    details.addEventListener('toggle',function(){if(details.open)renderPlots();});
    window.addEventListener('resize',function(){if(details.open)renderPlots();});
    function loadFrames(){
      ['1wk','1d','60m'].forEach(function(iv){
        if(iv===state.iv||pending[iv])return;
        if(others[iv]&&Date.now()-others[iv].fetchedAt<300000)return;
        pending[iv]=true;
        load(iv).then(function(data){others[iv]=Object.assign({},data,{fetchedAt:Date.now()});})
          .catch(function(){others[iv]={error:true,fetchedAt:Date.now()};})
          .finally(function(){pending[iv]=false;if(state){renderFrames();renderLevels();}});
      });
    }
    return {update:function(data){state=data;renderMetrics();loadFrames();},refresh:function(){others={};if(state)loadFrames();}};
  };
})(typeof self!=='undefined'?self:this);
