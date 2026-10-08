/* HSI cash-index calendar and display guards. No order execution or mutation.
 * HKEX CT/075/25, 2026 securities holiday schedule (including half days):
 * https://www.hkex.com.hk/-/media/HKEX-Market/Services/Circulars-and-Notices/Participant-and-Members-Circulars/SEHK/2025/ce_SEHK_CT_075_2025.pdf
 * HKEX CT/077/26, 2027 securities holiday schedule:
 * https://www.hkex.com.hk/-/media/HKEX-Market/Services/Circulars-and-Notices/Participant-and-Members-Circulars/SEHK/2026/ce_SEHK_CT_077_2026.pdf
 * Unknown years fail closed: refresh the calendar before extending forecasts.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MarketRules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var holidays = new Set(['2026-01-01','2026-02-17','2026-02-18','2026-02-19',
    '2026-04-03','2026-04-06','2026-04-07','2026-05-01','2026-05-25',
    '2026-06-19','2026-07-01','2026-10-01','2026-10-19','2026-12-25',
    '2027-01-01','2027-02-08','2027-02-09','2027-03-26','2027-03-29',
    '2027-04-05','2027-05-13','2027-06-09','2027-07-01','2027-09-16',
    '2027-10-01','2027-10-08','2027-12-27']);
  var halfDays = new Set(['2026-02-16','2026-12-24','2026-12-31','2027-02-05','2027-12-24','2027-12-31']);
  function hk(now) {
    var d = new Date((now == null ? Date.now() : now) + 28800000);
    return { date: d.toISOString().slice(0,10), minute: d.getUTCHours()*60+d.getUTCMinutes() };
  }
  function dayString(time) {
    if (typeof time === 'string') return time.slice(0,10);
    // Chart intraday timestamps are already shifted +08:00 for axis labels.
    if (typeof time === 'number') return new Date(time*1000).toISOString().slice(0,10);
    return time ? time.year+'-'+String(time.month).padStart(2,'0')+'-'+String(time.day).padStart(2,'0') : '';
  }
  function shift(date, n) {
    var d = new Date(date+'T00:00:00Z'); d.setUTCDate(d.getUTCDate()+n);
    return d.toISOString().slice(0,10);
  }
  function known(date) { return /^202[67]-\d{2}-\d{2}$/.test(date); }
  function tradingDay(date) {
    if (!known(date)) return null;
    var wd = new Date(date+'T00:00:00Z').getUTCDay();
    return wd !== 0 && wd !== 6 && !holidays.has(date);
  }
  function closeMinute(date) { return halfDays.has(date) ? 730 : 970; }
  function lastTradeMinute(date) { return halfDays.has(date) ? 720 : 960; }
  function session(now) {
    var h = hk(now), open = tradingDay(h.date), m = h.minute;
    if (open == null) return { date:h.date, phase:'unknown', active:false, close:null };
    if (!open) return { date:h.date, phase:'closed', active:false, close:null };
    var close = closeMinute(h.date), lastTrade = lastTradeMinute(h.date);
    var phase = m < 570 ? 'preopen' : m >= close ? 'closed' : m >= lastTrade ? 'closing' :
      (!halfDays.has(h.date) && m >= 720 && m < 780) ? 'lunch' : 'open';
    return { date:h.date, phase:phase, active:phase==='open', close:close };
  }
  function latestDay(now, completed) {
    var h=hk(now), s=session(now), date=h.date;
    if (s.phase==='unknown') return null;
    if (!tradingDay(date) || h.minute<570 || (completed && h.minute<closeMinute(date))) date=shift(date,-1);
    for(var i=0;i<20;i++,date=shift(date,-1)) {
      var t=tradingDay(date); if(t==null) return null; if(t) return date;
    }
    return null;
  }
  function nextDays(time,n) {
    var date=dayString(time), out=[];
    for(var i=0;i<n*5+20 && out.length<n;i++) {
      date=shift(date,1); var t=tradingDay(date); if(t==null) break;
      if(t) { var p=date.split('-'); out.push({year:+p[0],month:+p[1],day:+p[2]}); }
    }
    return out;
  }
  function horizon(date, count) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date)) || !Number.isInteger(count) || count < 1 || count > 100 || !known(date)) return null;
    var parsed=new Date(date+'T00:00:00Z');
    if(!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10)!==date) return null;
    var days=nextDays(date,count);
    if(days.length!==count) return null;
    return { start:date, count:count, end:dayString(days[days.length-1]), description:'未来'+count+'个交易日（按港股日历至 '+dayString(days[days.length-1])+'，不含发布当日）' };
  }
  function auditHorizon(record) {
    var r=record||{}, start=String(r.createdAt||'').slice(0,10);
    var match=String(r.horizon||'').match(/(\d+)\s*个交易日/);
    var result=match?horizon(start,Number(match[1])):null;
    if(!result) return {status:'unavailable',issue:'发布日、交易日数量或支持范围不足'};
    var declared=String(r.horizonDesc||'').match(/至\s*(\d{4}-\d{2}-\d{2})/);
    var wrongHoliday=/10\/7\s*中秋翌日休市/.test(String(r.horizonDesc||''));
    return {status:declared && declared[1]===result.end && !wrongHoliday?'valid':'mismatch',expected:result,declared_end:declared?declared[1]:null};
  }
  function analysisAvailability(a, now) {
    var today=hk(now).date;
    var expected=tradingDay(today)===true?today:latestDay(now,true);
    var f=a&&a.forecast||{}, meta=a&&a.meta||{};
    var date=String(f.applicable_date||meta.updatedAt||f.updatedAt||'').slice(0,10);
    if(!expected) return {status:'unknown',date:date||null,expected:null};
    var parsed=new Date(date+'T00:00:00Z');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==date) return {status:'missing',date:null,expected:expected};
    return {status:date===expected?'current':date<expected?'stale':'future',date:date,expected:expected};
  }
  // Audit the published archive index only. Never manufacture a frozen analysis
  // from subsequently observed candles or mutate existing snapshots.
  function archiveCoverage(dates, now) {
    var end=latestDay(now,true);
    if(!end) return {status:'unknown',latest:null,through:null,missing:[]};
    var valid=(Array.isArray(dates)?dates:[]).filter(function(d){
      if(typeof d!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d)||d>end||tradingDay(d)!==true) return false;
      var parsed=new Date(d+'T00:00:00Z');
      return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===d;
    }).sort();
    if(!valid.length) return {status:'empty',latest:null,through:end,missing:[]};
    var saved=new Set(valid), missing=[], cursor=valid[0];
    for(var i=0;i<740&&cursor<=end;i++,cursor=shift(cursor,1)) {
      if(tradingDay(cursor)===true&&!saved.has(cursor)) missing.push(cursor);
    }
    return {status:missing.length?'missing':'complete',latest:valid[valid.length-1],through:end,missing:missing};
  }
  function timestamp(text) {
    if (typeof text==='number') return text;
    if (!text) return NaN;
    var s=String(text).replace(' ','T');
    if (!/(Z|[+-]\d\d:\d\d)$/.test(s)) s+='+08:00';
    return Date.parse(s);
  }
  function quoteState(rt,now) {
    now=now==null?Date.now():now;
    if(!rt || !Number.isFinite(rt.ts) || !Number.isFinite(rt.price) || rt.price<=0) return 'missing';
    var age=now-rt.ts*1000, s=session(now), q=hk(rt.ts*1000);
    if(age < -60000 || s.phase==='unknown' || q.date!==latestDay(now,false)) return 'stale';
    if(s.active) return age<=300000 ? 'live' : 'stale';
    if(s.phase==='lunch') return q.minute>=715 ? 'paused' : 'stale';
    if(s.phase==='closing') return age<=300000 ? 'closing-preview' : 'stale';
    return q.minute>=lastTradeMinute(q.date) ? 'last-close' : 'stale';
  }
  function validQuote(rt,now) { return ['live','paused','closing-preview','last-close'].indexOf(quoteState(rt,now))>=0; }
  function partial(bar,iv,now) {
    var date=dayString(bar.time), h=hk(now);
    if (bar.partial===true) return true;
    if (iv==='1d') return date===h.date && h.minute<closeMinute(date);
    if (iv==='1wk') {
      var start=date, end=shift(start,4), ms=timestamp(end+'T'+(halfDays.has(end)?'12:10':'16:10')+':00');
      // Weekly timestamps may be Monday or Tuesday after a holiday: use actual weekday.
      var dow=new Date(start+'T00:00:00Z').getUTCDay(); end=shift(start,(5-dow+7)%7);
      while(tradingDay(end)===false) end=shift(end,-1);
      if(tradingDay(end)==null && end>=h.date) return true;
      ms=timestamp(end+'T'+(halfDays.has(end)?'12:10':'16:10')+':00');
      return (now==null?Date.now():now)<ms;
    }
    if(typeof bar.time==='number') {
      var minutes=iv==='60m'?60:15, b=hk((bar.marketTime==null?bar.time-28800:bar.marketTime)*1000);
      var endMin=Math.min(b.minute+minutes,b.minute<720?720:closeMinute(b.date));
      return (now==null?Date.now():now)<timestamp(b.date+'T00:00:00')+endMin*60000;
    }
    return false;
  }
  function markBars(bars,iv,now) {
    return bars.map(function(b){ return Object.assign({},b,{partial:partial(b,iv,now)}); });
  }
  function statusIssue(status,a,now) {
    if(!status || !a || !a.forecast) return '条件数据未加载';
    if(status.data_stale || status.conditions_stale) return '条件数据或规则已过期';
    var f=a.forecast, date=f.applicable_date || (f.updatedAt||a.meta&&a.meta.updatedAt||'').slice(0,10);
    if(!date || status.conditions_date!==date) return '条件日期与地图不一致';
    if(a.meta && a.meta.analysis_id) {
      if(status.analysis_id!==a.meta.analysis_id) return '分析版本不一致';
    } else if(status.analysis_updated_at!==(f.updatedAt || a.meta&&a.meta.updatedAt)) return '待绑定分析版本';
    var ms=timestamp(status.updated_at), s=session(now), age=(now==null?Date.now():now)-ms;
    if(!Number.isFinite(ms) || age< -60000 || hk(ms).date!==latestDay(now,false)) return '条件时间无效或跨交易日';
    if(s.phase==='unknown') return '交易日历待更新';
    if(s.active && age>10*60000) return '条件数据超过10分钟未更新';
    if(s.phase==='lunch' && hk(ms).minute<710) return '午休条件数据未更新到午盘';
    if(s.phase==='closed' && status.judgment_mode==='intraday_preview') return '尚未收到收盘确认';
    if(['intraday_preview','close_final'].indexOf(status.judgment_mode)<0) return '判断口径未知';
    if(status.judgment_mode==='close_final' && (hk(ms).minute<closeMinute(hk(ms).date) || hk(ms).date!==latestDay(now,true))) return '收盘确认时间不成立';
    return null;
  }
  function sanitizeStatus(input,now) {
    if(!input) return null;
    var d=JSON.parse(JSON.stringify(input)), m=d.metrics||{}, date=d.conditions_date;
    // No current-day timestamp means funding is unknown, never a carry-forward confirmation.
    var fundMs=timestamp(m.southbound_updated_at);
    // HKEX Stock Connect calendar: Southbound closed during 2026 National Day break.
    var connectClosed=date>='2026-10-01' && date<='2026-10-07';
    var fundingValid=!connectClosed && Number.isFinite(fundMs) && hk(fundMs).date===date && m.southbound_available===true && fundMs<=(now==null?Date.now():now)+60000;
    if(!fundingValid) m.southbound_net_yi=null;
    var closeFinal=d.judgment_mode==='close_final';
    var ratioValid=closeFinal || m.volume_ratio_basis==='same_time';
    (d.scenarios||[]).forEach(function(sc){
      (sc.conditions||[]).forEach(function(c){
        if(/southbound|南向/.test(c.id+' '+c.label) && !fundingValid) {
          c.met=null; c.value_text='无同日资金时间戳，暂不确认';
        }
        if(/vol|量比|放量|缩量/.test(c.id+' '+c.label) && !ratioValid) {
          c.met=null; c.value_text='盘中量比未提供同时间段口径，待收盘确认';
        }
      });
      var core=(sc.conditions||[]).filter(function(c){return c.role!=='confirm';});
      var conf=(sc.conditions||[]).filter(function(c){return c.role==='confirm';});
      sc.core_total=core.length; sc.core_met=core.filter(function(c){return c.met===true;}).length;
      sc.confirm_total=conf.length; sc.confirm_met=conf.filter(function(c){return c.met===true;}).length;
      sc.triggered=core.length>0 && core.every(function(c){return c.met===true;});
      sc.strength=conf.some(function(c){return c.met==null;})?'待验证':sc.confirm_met===conf.length?'强':sc.confirm_met===0?'弱':'中';
    });
    d.metrics=m; return d;
  }
  function rr(entry,target,stop,direction) {
    if(![entry,target,stop].every(Number.isFinite)) return null;
    var short=direction==='short', reward=short?entry-target:target-entry, risk=short?stop-entry:entry-stop;
    if(reward<=0 || risk<=0) return null;
    var ratio=reward/risk, grade=ratio>=2?'good':ratio>=1?'mid':'bad';
    return {dir:short?'short':'long',entry:entry,reward:reward,risk:risk,ratio:ratio,grade:grade,
      executable:ratio>=2,status:ratio>=2?'executable':'insufficient_rr',
      emoji:grade==='good'?'🟢':grade==='mid'?'🟡':'🔴',verdict:ratio>=2?'具备可执行赔率':'不具备可执行赔率'};
  }
  function chaseBoundary(direction,stop,target,minRR) {
    minRR=Number.isFinite(minRR)?minRR:2;
    if(!Number.isFinite(stop)||!Number.isFinite(target)||!(minRR>0)) return null;
    var short=direction==='short';
    if(short && !(target<stop)) return null;
    if(!short && !(stop<target)) return null;
    var boundary=short?(minRR*stop+target)/(minRR+1):(target+minRR*stop)/(minRR+1);
    return {direction:short?'short':'long',boundary:boundary,min_rr:minRR,
      legal_min:short?boundary:stop,legal_max:short?stop:boundary,
      lower_inclusive:short,upper_inclusive:!short};
  }
  return {hk:hk,dayString:dayString,shift:shift,known:known,tradingDay:tradingDay,
    closeMinute:closeMinute,lastTradeMinute:lastTradeMinute,session:session,latestDay:latestDay,nextDays:nextDays,horizon:horizon,auditHorizon:auditHorizon,analysisAvailability:analysisAvailability,archiveCoverage:archiveCoverage,timestamp:timestamp,
    quoteState:quoteState,validQuote:validQuote,markBars:markBars,statusIssue:statusIssue,
    sanitizeStatus:sanitizeStatus,rr:rr,chaseBoundary:chaseBoundary};
});
