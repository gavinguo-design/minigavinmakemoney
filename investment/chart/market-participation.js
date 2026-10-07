/* HSI breadth / weight / contribution integration.
 * Descriptive market participation can tilt scenario weights, but never changes
 * trigger, invalidation, stop or target rules. Invalid or mismatched data fails closed. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MarketParticipation = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = '1.0.0';
  var BETA = 0.35;

  function finite(v) { return typeof v === 'number' && Number.isFinite(v); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function date(v) { return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null; }

  function validate(snapshot, requiredDate) {
    if (!snapshot || snapshot.status !== 'available') return { ok:false, issue:'宽度数据未提供' };
    if (snapshot.index_id !== 'HSI') return { ok:false, issue:'指数标识不匹配' };
    if (!date(snapshot.as_of)) return { ok:false, issue:'宽度数据日期无效' };
    if (requiredDate && snapshot.as_of !== requiredDate) return { ok:false, issue:'宽度数据与情景交易日不一致' };
    var q = snapshot.data_quality || {}, m = snapshot.metrics || {};
    if (q.reconciled !== true) return { ok:false, issue:'成分贡献未通过指数对账' };
    if (!finite(q.constituent_count) || q.constituent_count < 80) return { ok:false, issue:'成分覆盖不足' };
    if (!finite(q.quote_coverage) || q.quote_coverage < 0.95) return { ok:false, issue:'行情覆盖不足95%' };
    var expectedCoverage = finite(q.expected_weight_coverage) ? q.expected_weight_coverage : 1;
    if (!finite(q.weight_coverage) || Math.abs(q.weight_coverage - expectedCoverage) > (finite(q.weight_rounding_tolerance) ? q.weight_rounding_tolerance : 0.0005)) return { ok:false, issue:'权重覆盖不完整' };
    var total = m.advances + m.declines + m.unchanged;
    if (![m.advances,m.declines,m.unchanged].every(finite) || total !== q.constituent_count) return { ok:false, issue:'涨跌家数无法核对' };
    if (!finite(m.equal_name_breadth) || m.equal_name_breadth < 0 || m.equal_name_breadth > 1) return { ok:false, issue:'等权宽度无效' };
    if (!finite(m.weighted_breadth) || m.weighted_breadth < 0 || m.weighted_breadth > 1) return { ok:false, issue:'权重宽度无效' };
    if (!finite(m.contribution_direction) || m.contribution_direction < -1 || m.contribution_direction > 1) return { ok:false, issue:'贡献方向无效' };
    if (!finite(m.top_five_absolute_contribution_share) || m.top_five_absolute_contribution_share < 0 || m.top_five_absolute_contribution_share > 1) return { ok:false, issue:'贡献集中度无效' };
    return { ok:true, issue:null };
  }

  function signal(snapshot) {
    var m = snapshot.metrics;
    var equalTerm = clamp((m.equal_name_breadth - 0.5) * 2, -1, 1);
    var weightedTerm = clamp((m.weighted_breadth - 0.5) * 2, -1, 1);
    var contributionTerm = clamp(m.contribution_direction, -1, 1);
    var raw = 0.45 * equalTerm + 0.35 * weightedTerm + 0.20 * contributionTerm;
    var concentrationPenalty = clamp((m.top_five_absolute_contribution_share - 0.5) / 0.35, 0, 0.5);
    var reliability = 1 - concentrationPenalty;
    return {
      score: clamp(raw * reliability, -1, 1),
      raw_score: raw,
      reliability: reliability,
      label: raw >= 0.2 ? '广泛偏多' : raw <= -0.2 ? '广泛偏空' : '参与度中性',
      concentration: m.top_five_absolute_contribution_share >= 0.6 ? '集中' : '分散'
    };
  }

  function scenarioDirection(sc) {
    return sc && sc.rr && sc.rr.direction === 'long' ? 1 : -1;
  }

  function evaluate(snapshot, scenarios, requiredDate) {
    var check = validate(snapshot, requiredDate);
    var list = Array.isArray(scenarios) ? scenarios : [];
    var baseTotal = list.reduce(function (sum, sc) { return sum + (finite(sc.probability) && sc.probability > 0 ? sc.probability : 0); }, 0);
    var base = {};
    list.forEach(function (sc) { base[sc.id] = baseTotal ? sc.probability / baseTotal : 0; });
    if (!check.ok || !list.length || !baseTotal) return { status:'unavailable', issue:check.issue, base_weights:base, weights:base, adjustments:{}, evidence:null };
    var evidence = signal(snapshot), raw = {}, total = 0;
    list.forEach(function (sc) {
      var v = base[sc.id] * Math.exp(scenarioDirection(sc) * BETA * evidence.score);
      raw[sc.id] = v; total += v;
    });
    var weights = {}, adjustments = {};
    list.forEach(function (sc) {
      weights[sc.id] = raw[sc.id] / total;
      adjustments[sc.id] = weights[sc.id] - base[sc.id];
    });
    return { status:'available', issue:null, base_weights:base, weights:weights, adjustments:adjustments, evidence:evidence, as_of:snapshot.as_of, mode:snapshot.mode, metrics:snapshot.metrics, source:snapshot.source };
  }

  return { VERSION:VERSION, BETA:BETA, validate:validate, signal:signal, evaluate:evaluate };
});
