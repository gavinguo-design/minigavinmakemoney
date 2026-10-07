/* HSI futures / liquidity / options-risk context.
 * Futures may tilt direction. Spread and VHSI only scale reliability. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MarketContext = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function finite(v) { return typeof v === 'number' && Number.isFinite(v); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function direction(sc) { return sc && sc.rr && sc.rr.direction === 'long' ? 1 : -1; }
  function evaluate(snapshot, scenarios, startingWeights) {
    var list = Array.isArray(scenarios) ? scenarios : [];
    var base = {}, total = 0;
    list.forEach(function (sc) { var w = startingWeights && finite(startingWeights[sc.id]) ? startingWeights[sc.id] : (finite(sc.probability) ? sc.probability : 0); base[sc.id] = Math.max(0,w); total += base[sc.id]; });
    if (total) Object.keys(base).forEach(function (k) { base[k] /= total; });
    if (!snapshot || snapshot.status !== 'available' || !list.length || !total) return { status:'unavailable', issue:snapshot && snapshot.issue || '夜盘/波动/流动性数据未通过门禁', weights:base, adjustments:{} };
    var f=snapshot.futures||{}, l=snapshot.liquidity||{}, o=snapshot.options_risk||{};
    if (!finite(f.return_from_previous_close) || !finite(f.basis_pct) || !finite(l.spread_points) || !finite(o.price)) return { status:'unavailable', issue:'市场环境字段不完整', weights:base, adjustments:{} };
    var futuresScore=clamp(0.75*(f.return_from_previous_close/0.015)+0.25*(f.basis_pct/0.006),-1,1);
    var liquidityReliability=clamp(1-Math.max(0,l.spread_points-2)/20,0.65,1);
    var volatilityReliability=clamp(28/o.price,0.65,1);
    var reliability=Math.min(liquidityReliability,volatilityReliability);
    var tilt=0.28*futuresScore*reliability, raw={}, sum=0;
    list.forEach(function(sc){var v=base[sc.id]*Math.exp(direction(sc)*tilt);raw[sc.id]=v;sum+=v;});
    var weights={},adjustments={}; list.forEach(function(sc){weights[sc.id]=raw[sc.id]/sum;adjustments[sc.id]=weights[sc.id]-base[sc.id];});
    return { status:'available',weights:weights,adjustments:adjustments,evidence:{futures_score:futuresScore,reliability:reliability,liquidity_reliability:liquidityReliability,volatility_reliability:volatilityReliability,label:futuresScore>0.2?'夜盘偏多':futuresScore<-.2?'夜盘偏空':'夜盘中性'},snapshot:snapshot };
  }
  return { evaluate:evaluate };
});
