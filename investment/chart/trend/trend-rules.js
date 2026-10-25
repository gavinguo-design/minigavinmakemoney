// 趋势看板规则（纯函数，浏览器与 node 共用）
// 基于均线与关键位的规则判断，未经回测验证。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TrendRules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var HSI_MONTHLY_PRIOR_LOW = 22518; // 恒指月线前低（固定标注）
  var HSI_STOP_POINTS = 200;         // 恒指空单止损缓冲
  var CBBC_NOTE = '牛熊证持有超过10天，收回价距现价需≥1500点；看3-4周的仓位改用期权/ETF。';

  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  // 清洗 /api/kline 返回：剔除空值 K 线
  function cleanBars(d) {
    var out = [];
    if (!d || !d.timestamp) return out;
    for (var i = 0; i < d.timestamp.length; i++) {
      var o = d.open[i], h = d.high[i], l = d.low[i], c = d.close[i];
      if (isNum(o) && isNum(h) && isNum(l) && isNum(c)) out.push({ t: d.timestamp[i], o: o, h: h, l: l, c: c });
    }
    return out;
  }

  // 简单移动平均，长度不足返回 null
  function sma(values, n) {
    var out = new Array(values.length), sum = 0;
    for (var i = 0; i < values.length; i++) {
      sum += values[i];
      if (i >= n) sum -= values[i - n];
      out[i] = i >= n - 1 ? sum / n : null;
    }
    return out;
  }

  function pct(a, b) { return isNum(a) && isNum(b) && b !== 0 ? (a / b - 1) * 100 : null; }

  // 趋势状态：上涨 / 回调 / 震荡 / 下跌
  // 规则：
  //  - 长期多头（价格 > MA200 且 MA50 > MA200）：价格同时在 MA20、MA50 上方 → 上涨；否则 → 回调
  //  - 长期空头（价格 < MA200 且 MA50 < MA200）：空头排列(MA20<MA50<MA200) 或价格在 MA50 下方 → 下跌；否则 → 震荡（空头里的强反弹）
  //  - 其余（价格与长期均线方向不一致）→ 震荡
  function classifyTrend(price, ma20, ma50, ma200) {
    if (![price, ma20, ma50, ma200].every(isNum)) return { state: 'unknown', label: '数据不足', why: '均线数据不足' };
    var bullAlign = ma20 > ma50 && ma50 > ma200;
    var bearAlign = ma20 < ma50 && ma50 < ma200;
    if (price > ma200 && ma50 > ma200) {
      if (price >= ma20 && price >= ma50) return { state: 'up', label: '上涨', why: bullAlign ? '价格在三条均线上方，均线多头排列' : '价格在三条均线上方' };
      return { state: 'pullback', label: '回调', why: '长期仍在200日线上方，短线跌回' + (price < ma50 ? '50日线下方' : '20日线下方') };
    }
    if (price < ma200 && ma50 < ma200) {
      if (bearAlign || price < ma50) return { state: 'down', label: '下跌', why: bearAlign ? '均线空头排列，价格在长期均线下方' : '价格在50日、200日线下方' };
      return { state: 'range', label: '震荡', why: '长期偏弱，但短线反弹到50日线上方' };
    }
    return { state: 'range', label: '震荡', why: '价格与均线方向不一致，方向未定' };
  }

  // 关键位：上方阻力 / 下方支撑（取最近两档）
  function keyLevels(price, ctx) {
    var cands = [
      { name: '20日高点', v: ctx.high20 },
      { name: '20日低点', v: ctx.low20 },
      { name: 'MA20', v: ctx.ma20 },
      { name: 'MA50', v: ctx.ma50 },
      { name: 'MA200', v: ctx.ma200 }
    ];
    if (ctx.priorLow) cands.push({ name: '月线前低', v: ctx.priorLow });
    cands = cands.filter(function (x) { return isNum(x.v); });
    var above = cands.filter(function (x) { return x.v > price; }).sort(function (a, b) { return a.v - b.v; }).slice(0, 2);
    var below = cands.filter(function (x) { return x.v <= price; }).sort(function (a, b) { return b.v - a.v; }).slice(0, 2);
    return { resistance: above, support: below };
  }

  function fmt(v, dp) { return isNum(v) ? v.toFixed(dp == null ? 0 : dp) : '—'; }
  function near(price, level, tolPct) { return isNum(level) && Math.abs(pct(price, level)) <= tolPct; }

  // 港股（恒指）建议：空头里不抄底，只做反弹滞涨空；跌破月线前低可顺势轻仓空
  function adviceHK(t, m) {
    var p = m.price, low = HSI_MONTHLY_PRIOR_LOW, stop20 = m.ma20 + HSI_STOP_POINTS;
    if (t.state === 'down') {
      if (p < low) return {
        now: '已跌破月线前低，可顺势轻仓空，不追深、不抄底',
        trigger: '收盘仍在 ' + low + ' 下方 → 顺势轻仓空；反弹到 MA20(' + fmt(m.ma20) + ') 附近滞涨可加',
        invalid: '收盘重回 ' + (low + HSI_STOP_POINTS) + ' 上方 → 顺势空作废'
      };
      if (near(p, m.ma20, 1) || p > m.ma20) return {
        now: '反弹到20日线附近，盯滞涨信号，准备轻仓空',
        trigger: '在 MA20(' + fmt(m.ma20) + ') 附近收阴/冲高回落 → 轻仓空，止损：收盘站上 ' + fmt(stop20),
        invalid: '收盘站上 MA50(' + fmt(m.ma50) + ') → 空头思路作废，转观望'
      };
      return {
        now: '空头排列，不抄底；等反弹到20日线附近滞涨再空',
        trigger: '反弹至 MA20(' + fmt(m.ma20) + ') 附近滞涨 → 轻仓空，止损：收盘站上 ' + fmt(stop20) + '；收盘跌破 ' + low + ' → 顺势轻仓空',
        invalid: '收盘站上 MA50(' + fmt(m.ma50) + ') → 空头思路作废'
      };
    }
    if (t.state === 'range') return {
      now: '方向未定，轻仓或观望，不追涨杀跌',
      trigger: '收盘站上 MA200(' + fmt(m.ma200) + ') → 转多看；收盘跌破20日低点(' + fmt(m.low20) + ') → 回到做空思路',
      invalid: '—'
    };
    if (t.state === 'pullback') return {
      now: '长期向上的回调，不追空；等企稳再做多',
      trigger: '收盘站上 MA20(' + fmt(m.ma20) + ') → 可轻仓做多',
      invalid: '收盘跌破 MA200(' + fmt(m.ma200) + ') → 转为防守'
    };
    if (t.state === 'up') return {
      now: '趋势向上，持多为主，回踩20日线不破可加',
      trigger: '回踩 MA20(' + fmt(m.ma20) + ') 附近企稳 → 加仓',
      invalid: '收盘跌破 MA50(' + fmt(m.ma50) + ') → 减仓'
    };
    return { now: '数据不足，暂不判断', trigger: '—', invalid: '—' };
  }

  // 美股建议：200日线上方回调不追空，收复MA50才做多；跌到200日线附近为长线分批区
  function adviceUS(t, m) {
    var p = m.price;
    if (t.state === 'up') return {
      now: '趋势向上，持有为主，回踩20日线不破可加',
      trigger: '回踩 MA20(' + fmt(m.ma20, 2) + ') 附近企稳 → 加仓',
      invalid: '收盘跌破 MA50(' + fmt(m.ma50, 2) + ') → 进入回调，停止加仓'
    };
    if (t.state === 'pullback') {
      if (near(p, m.ma200, 3)) return {
        now: '回调到200日线附近，长线可分批买，不追空',
        trigger: '在 MA200(' + fmt(m.ma200, 2) + ') 附近分批；收盘站上 MA50(' + fmt(m.ma50, 2) + ') → 正式做多',
        invalid: '收盘跌破 MA200 超 3% → 停止分批，转防守'
      };
      if (p < m.ma50) return {
        now: '长期向上的回调，不追空；等收复50日线再做多',
        trigger: '收盘站上 MA50(' + fmt(m.ma50, 2) + ') → 可做多',
        invalid: '收盘跌破 MA200(' + fmt(m.ma200, 2) + ') → 转为防守'
      };
      return {
        now: '浅回调，仍在50日线上方，持有不追空',
        trigger: '收盘站回 MA20(' + fmt(m.ma20, 2) + ') → 回调结束，可加仓',
        invalid: '收盘跌破 MA50(' + fmt(m.ma50, 2) + ') → 等收复50日线再做多'
      };
    }
    if (t.state === 'range') return {
      now: '方向未定，观望或轻仓',
      trigger: '收盘站上 MA200(' + fmt(m.ma200, 2) + ') 且 MA50 拐头向上 → 做多',
      invalid: '—'
    };
    if (t.state === 'down') return {
      now: '跌在200日线下方，不抄底，等收复',
      trigger: '收盘站上 MA200(' + fmt(m.ma200, 2) + ') → 重新评估做多',
      invalid: '—'
    };
    return { now: '数据不足，暂不判断', trigger: '—', invalid: '—' };
  }

  // VIX 情绪：低 / 正常 / 紧张 / 恐慌
  function vixLevel(v) {
    if (!isNum(v)) return { state: 'unknown', label: '—' };
    if (v < 15) return { state: 'low', label: '低', desc: '市场放松，留意过度乐观' };
    if (v < 20) return { state: 'normal', label: '正常', desc: '情绪平稳' };
    if (v < 30) return { state: 'tense', label: '紧张', desc: '波动加大，控制仓位' };
    return { state: 'panic', label: '恐慌', desc: '恐慌抛售，长线留意分批机会' };
  }

  // 由一组 K 线算出整张卡所需数据
  function analyze(bars, opts) {
    opts = opts || {};
    var closes = bars.map(function (b) { return b.c; });
    var n = closes.length;
    if (n < 2) return null;
    var ma20 = sma(closes, 20), ma50 = sma(closes, 50), ma200 = sma(closes, 200);
    var price = closes[n - 1];
    var last20 = bars.slice(-20);
    var m = {
      price: price,
      chg5: n > 5 ? pct(price, closes[n - 6]) : null,
      ma20: ma20[n - 1], ma50: ma50[n - 1], ma200: ma200[n - 1],
      high20: Math.max.apply(null, last20.map(function (b) { return b.h; })),
      low20: Math.min.apply(null, last20.map(function (b) { return b.l; })),
      priorLow: opts.market === 'hk' ? HSI_MONTHLY_PRIOR_LOW : null,
      series: { ma20: ma20, ma50: ma50, ma200: ma200 }
    };
    m.d20 = pct(price, m.ma20); m.d50 = pct(price, m.ma50); m.d200 = pct(price, m.ma200);
    m.trend = classifyTrend(price, m.ma20, m.ma50, m.ma200);
    m.levels = keyLevels(price, m);
    m.advice = opts.market === 'hk' ? adviceHK(m.trend, m) : adviceUS(m.trend, m);
    return m;
  }

  var STRENGTH = { up: '强', pullback: '强势回调', range: '震荡', down: '弱', unknown: '待定' };
  var HK_ACTION = { down: '港股只做反弹空', range: '港股观望', pullback: '港股等企稳做多', up: '港股顺势做多', unknown: '港股待定' };
  var US_ACTION = { up: '美股持多', pullback: '美股等回调结束做多', range: '美股观望', down: '美股不抄底', unknown: '美股待定' };

  // 顶部一句话总判断
  function summarize(hkState, usState) {
    function head(s) { return STRENGTH[s] || '待定'; }
    var usHead = head(usState), hkHead = head(hkState);
    // 回调期美股仍按"强"描述（长期趋势在200日线上方）
    if (usState === 'pullback') usHead = '强';
    var text = '美股' + usHead + '、港股' + hkHead + '：' + (HK_ACTION[hkState] || HK_ACTION.unknown) + '，' + (US_ACTION[usState] || US_ACTION.unknown);
    return text;
  }

  // 美股整体状态：标普与纳指取更弱的一个（保守）
  var ORDER = { down: 0, range: 1, pullback: 2, up: 3 };
  function combineUS(a, b) {
    if (!(a in ORDER)) return b in ORDER ? b : 'unknown';
    if (!(b in ORDER)) return a;
    return ORDER[a] <= ORDER[b] ? a : b;
  }

  return {
    HSI_MONTHLY_PRIOR_LOW: HSI_MONTHLY_PRIOR_LOW, CBBC_NOTE: CBBC_NOTE,
    cleanBars: cleanBars, sma: sma, pct: pct, classifyTrend: classifyTrend, keyLevels: keyLevels,
    adviceHK: adviceHK, adviceUS: adviceUS, vixLevel: vixLevel, analyze: analyze,
    summarize: summarize, combineUS: combineUS
  };
});
