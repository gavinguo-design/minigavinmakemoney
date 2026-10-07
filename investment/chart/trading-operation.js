/* Versioned, display-only HSI operating contract. It consumes existing production
 * annotations, scenario-status, bars, and quote state; it never creates signals. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./market-rules.js'), require('./market-participation.js'));
  else root.TradingOperation = factory(root.MarketRules, root.MarketParticipation);
})(typeof self !== 'undefined' ? self : this, function (MarketRules, MarketParticipation) {
  'use strict';
  var VERSION = '1.5.0';
  var SECTION_IDS = ['market_regime','key_price_zones','scenario_paths','trigger_confirmation','no_trade_conditions','risk_controls','position_management','post_market_review'];
  var SOURCE = { annotations: 'annotations.json', status: 'scenario_status.json', quote: '/api/realtime', bars: 'loaded daily OHLCV' };

  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function timestamp(v) { return MarketRules && MarketRules.timestamp ? MarketRules.timestamp(v) : Date.parse(v); }
  function iso(now) { return new Date(now).toISOString(); }
  function fmt(v) { return typeof v === 'number' ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '--'; }
  function source(status, sourceName, asOf, updatedAt, note) {
    return { source: sourceName, as_of: asOf || null, source_updated_at: updatedAt || null, status: status, note: note || null };
  }
  function section(id, title, provenance, actionState, data) {
    return { id: id, title: title, provenance: provenance, action_state: actionState, data: data || {} };
  }
  function mapDate(a) {
    var f = a && a.forecast || {};
    return f.applicable_date || String(f.updatedAt || a && a.meta && a.meta.updatedAt || '').slice(0, 10) || null;
  }
  function lastCompletedDaily(bars) {
    var daily = (bars || []).filter(function (b) { return b && !b.partial; });
    return daily.length ? daily[daily.length - 1] : null;
  }
  function barDate(bar) {
    var time = bar && bar.time;
    if (typeof time === 'string') return time.slice(0, 10);
    if (typeof time === 'number') return new Date((time > 1e12 ? time : time * 1000)).toISOString().slice(0, 10);
    if (time && typeof time === 'object' && Number.isFinite(time.year) && Number.isFinite(time.month) && Number.isFinite(time.day)) {
      return time.year + '-' + String(time.month).padStart(2, '0') + '-' + String(time.day).padStart(2, '0');
    }
    return MarketRules && MarketRules.dayString ? MarketRules.dayString(time) : '';
  }
  function statusState(status, annotations, now) {
    if (!status) return { status: 'missing', issue: '情景状态数据未加载' };
    var issue = MarketRules.statusIssue(status, annotations, now);
    return issue ? { status: 'stale', issue: issue } : { status: 'available', issue: null };
  }
  function hasCompleteDailyForStatus(status, bars) {
    return !!(status && status.judgment_mode === 'close_final' && status.conditions_date && barDate(lastCompletedDaily(bars)) === status.conditions_date);
  }
  function scenarioId(sc) { return sc && (sc.id || String(sc.name || '').split(' ')[0]); }
  function matchStatus(status, id) {
    return (status && status.scenarios || []).filter(function (s) { return s && (s.id || s.name_prefix) === id; })[0] || null;
  }
  function statusForScenario(st, base, closeConfirmed) {
    if (base !== 'available') return base;
    if (!st || !Array.isArray(st.conditions) || typeof st.core_total !== 'number') return 'missing';
    if (st.triggered === true && !closeConfirmed) return 'unavailable';
    return 'available';
  }
  function scenarioRows(a, status, base, closeConfirmed) {
    var scenarios = a && a.forecast && a.forecast.scenarios || [];
    return scenarios.map(function (sc) {
      var id = scenarioId(sc), ss = matchStatus(status, id), risk = sc.risk || {};
      var rowStatus = statusForScenario(ss, base, closeConfirmed);
      return {
        id: id,
        label: sc.name || id,
        status: rowStatus,
        state: rowStatus !== 'available' ? 'not_actionable' : (ss.triggered ? 'triggered' : (ss.core_met > 0 ? 'confirming' : 'candidate')),
        trigger: sc.trigger || null,
        confirmation: ss ? clone(ss.conditions || []) : [],
        strength: ss && ss.strength || null,
        progress: ss ? { core_met: ss.core_met, core_total: ss.core_total, confirm_met: ss.confirm_met, confirm_total: ss.confirm_total } : null,
        rr: clone(sc.rr || null),
        structural_invalidation: clone(risk.structural_invalidation || null),
        disaster_stop: clone(risk.disaster_stop || null),
        source: source(rowStatus, SOURCE.annotations + ' + ' + SOURCE.status, mapDate(a), status && status.updated_at, rowStatus === 'unavailable' ? '收盘状态存在，但未加载同日完整日K，不能把它当作日线确认。' : null)
      };
    });
  }
  function gapFallback(a) {
    var zones = a && a.intraday_playbook && a.intraday_playbook.zones || [];
    var candidates = zones.filter(function (z) {
      return z && Array.isArray(z.range) && Number.isFinite(z.range[0]) && Number.isFinite(z.range[1])
        && /缺口/.test([z.action, z.entry_hint].filter(Boolean).join(' '));
    }).map(function (z) {
      var action = String(z.action || '').replace(/,/g, '');
      var ownsRange = action.indexOf(String(z.range[0])) >= 0 && action.indexOf(String(z.range[1])) >= 0;
      return { zone: z, score: (ownsRange ? 10 : 0) + (/缺口区/.test(z.action || '') ? 3 : 0) + (/反抽进入/.test(z.action || '') ? 2 : 0) };
    }).sort(function (a, b) { return b.score - a.score || (a.zone.range[1] - a.zone.range[0]) - (b.zone.range[1] - b.zone.range[0]); });
    var gap = candidates.length ? candidates[0].zone : null;
    if (!gap) return { status: 'missing', data: { label: '缺口回退路径未提供；不以价格触及替代确认。' } };
    return { status: 'available', data: { range: gap.range, stance: gap.stance || null, condition: gap.action || null, note: '盘中区间仅为回退观察；日线情景仍需收盘确认。' } };
  }
  function activeZone(a, price) {
    if (!Number.isFinite(price)) return null;
    var zones = a && a.intraday_playbook && a.intraday_playbook.zones || [];
    var zone = zones.filter(function (z) {
      if (!z || !Array.isArray(z.range)) return false;
      var low = z.range[0], high = z.range[1];
      return (low == null || price >= low) && (high == null || price < high);
    })[0];
    if (!zone) return null;
    return { range: clone(zone.range), stance: zone.stance || null, action: zone.action || null, invalidation: zone.invalid || null };
  }
  function tacticalWindow(a, price) {
    if (!Number.isFinite(price)) return null;
    var zones = a && a.intraday_playbook && a.intraday_playbook.zones || [];
    var index = zones.findIndex(function (z) {
      if (!z || !Array.isArray(z.range)) return false;
      var low = z.range[0], high = z.range[1];
      return (low == null || price >= low) && (high == null || price < high);
    });
    if (index < 0) return null;
    var zone = zones[index], low = zone.range[0], high = zone.range[1];
    var lowerDistance = Number.isFinite(low) ? Math.max(0, price - low) : null;
    var upperDistance = Number.isFinite(high) ? Math.max(0, high - price) : null;
    var nearest = upperDistance == null || (lowerDistance != null && lowerDistance <= upperDistance) ? 'lower' : 'upper';
    var above = index > 0 ? zones[index - 1] : null;
    var below = index + 1 < zones.length ? zones[index + 1] : null;
    return {
      range: clone(zone.range),
      width_points: Number.isFinite(low) && Number.isFinite(high) ? high - low : null,
      lower: Number.isFinite(low) ? { price: low, distance_points: lowerDistance, next_stance: below && below.stance || null } : null,
      upper: Number.isFinite(high) ? { price: high, distance_points: upperDistance, next_stance: above && above.stance || null } : null,
      nearest_boundary: nearest,
      stance: zone.stance || null,
      action: zone.action || null,
      invalidation: zone.invalid || null,
      scope: 'intraday_tactical'
    };
  }
  function keyLevelDistances(price, scenarios, playbook, fallback) {
    if (!Number.isFinite(price)) return [];
    var points = [];
    function add(label, value, kind) {
      if (!Number.isFinite(value)) return;
      points.push({ label: label, price: value, distance_points: value - price, kind: kind });
    }
    (Array.isArray(scenarios) ? scenarios : scenarios ? [scenarios] : []).forEach(function (sc) {
      var id = scenarioId(sc) || '情景', rr = sc && sc.rr || {};
      add(id + '触发', rr.entry, 'trigger');
      add(id + '失效', rr.stop, 'invalidation');
      if (sc && sc.structural_invalidation) add(id + '结构失效', sc.structural_invalidation.price, 'invalidation');
    });
    var zones = playbook && playbook.zones || [];
    zones.forEach(function (z) {
      if (!z || !Array.isArray(z.range)) return;
      add('区间下沿', z.range[0], 'zone_boundary');
      add('区间上沿', z.range[1], 'zone_boundary');
    });
    if (fallback && Array.isArray(fallback.range)) {
      add('兜底下沿', fallback.range[0], 'fallback_boundary');
      add('兜底上沿', fallback.range[1], 'fallback_boundary');
    }
    var seen = {};
    var priority = { trigger:0, invalidation:1, fallback_boundary:2, zone_boundary:3 };
    return points.sort(function (a, b) {
      return Math.abs(a.distance_points) - Math.abs(b.distance_points) || priority[a.kind] - priority[b.kind] || a.label.localeCompare(b.label);
    }).filter(function (p) {
      var key = String(p.price);
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    }).slice(0, 2);
  }
  function scenarioPointer(price, scenarios, atr, closeConfirmed) {
    var rows = (scenarios || []).filter(function (s) { return s && s.rr && Number.isFinite(s.rr.entry); });
    var weighted = rows.filter(function (s) { return Number.isFinite(s.effective_probability); }).sort(function (a,b) { return b.effective_probability-a.effective_probability; });
    var top = weighted.length ? { id:weighted[0].id, weight:weighted[0].effective_probability } : null;
    var confirmed = closeConfirmed ? rows.filter(function (s) { return s.status === 'available' && s.state === 'triggered'; }).map(function (s) { return s.id; }) : [];
    if (!Number.isFinite(price) || !rows.length || !Number.isFinite(atr) || atr <= 0) return { nearest:null, top_weight:top, confirmed:confirmed };
    var ranked = rows.map(function (s) { return { id:s.id, entry:s.rr.entry, distance_points:s.rr.entry-price, absolute_distance:Math.abs(s.rr.entry-price) }; })
      .sort(function (a,b) { return a.absolute_distance-b.absolute_distance; });
    var tied = ranked.length > 1 && Math.abs(ranked[0].absolute_distance-ranked[1].absolute_distance) < 0.000001;
    return { nearest:(!tied && ranked[0].absolute_distance <= atr) ? ranked[0] : null, top_weight:top, confirmed:confirmed };
  }
  function recentAtr(bars) {
    var rows=(bars||[]).filter(function(b){return b&&!b.partial&&[b.high,b.low,b.close].every(Number.isFinite);}).slice(-14);
    if(!rows.length) return null;
    var sum=0;
    rows.forEach(function(b,i){var prev=i?rows[i-1].close:b.close;sum+=Math.max(b.high-b.low,Math.abs(b.high-prev),Math.abs(b.low-prev));});
    return sum/rows.length;
  }
  function rangeText(range) {
    if (!Array.isArray(range)) return '未匹配';
    if (range[0] == null) return '< ' + fmt(range[1]);
    if (range[1] == null) return '\u2265 ' + fmt(range[0]);
    return fmt(range[0]) + '\u2013' + fmt(range[1]);
  }
  function build(input) {
    input = input || {};
    var now = input.now == null ? Date.now() : input.now;
    var annotations = input.annotations || null;
    var status = input.scenarioStatus || null;
    var bars = input.dailyBars || [];
    var quote = input.quote || null;
    var date = mapDate(annotations);
    var f = annotations && annotations.forecast || {};
    var statusInfo = statusState(status, annotations, now);
    var closeConfirmed = statusInfo.status === 'available' && hasCompleteDailyForStatus(status, bars);
    var quoteState = MarketRules.quoteState(quote, now);
    var quoteStatus = quoteState === 'missing' ? 'missing' : (MarketRules.validQuote(quote, now) ? 'available' : 'stale');
    var mapStatus = annotations && f && date ? 'available' : 'missing';
    var scenarioStatus = mapStatus === 'available' ? statusInfo.status : 'missing';
    var scenarios = scenarioRows(annotations, status, scenarioStatus, closeConfirmed);
    var participation = MarketParticipation && MarketParticipation.evaluate
      ? MarketParticipation.evaluate(input.participation || null, f.scenarios || [], status && status.conditions_date || date)
      : { status:'unavailable', issue:'参与度模块未加载', weights:{}, adjustments:{} };
    scenarios.forEach(function (row) {
      row.base_probability = (f.scenarios || []).filter(function (sc) { return scenarioId(sc) === row.id; })[0];
      row.base_probability = row.base_probability && row.base_probability.probability || null;
      row.effective_probability = participation.status === 'available' && Number.isFinite(participation.weights[row.id]) ? participation.weights[row.id] : row.base_probability;
      row.participation_adjustment = participation.status === 'available' && Number.isFinite(participation.adjustments[row.id]) ? participation.adjustments[row.id] : null;
    });
    var gap = gapFallback(annotations);
    var zone = quoteStatus === 'available' ? activeZone(annotations, quote && quote.price) : null;
    var tactical = quoteStatus === 'available' ? tacticalWindow(annotations, quote && quote.price) : null;
    var intradayGuidance = mapStatus === 'available' && quoteStatus === 'available' && !!zone && (scenarioStatus !== 'available' || !closeConfirmed);
    var levels = f.card && f.card.keyLines || [];
    var riskUnsupported = scenarios.some(function (s) { return !s.disaster_stop || s.disaster_stop.status === 'not_configured' || s.disaster_stop.price == null; });
    var riskBudget = input.riskBudget || null;
    var positionUnsupported = !riskBudget || !Number.isFinite(riskBudget.max_loss) || riskBudget.max_loss <= 0;
    var triggered = scenarios.filter(function (s) { return s.status === 'available' && s.state === 'triggered'; });
    var confirming = scenarios.filter(function (s) { return s.status === 'available' && s.state === 'confirming'; });
    var primary = triggered[0] || confirming[0] || scenarios.filter(function (s) { return s.status === 'available'; })[0] || null;
    var decisionCode = intradayGuidance ? 'INTRADAY_GUIDANCE'
      : scenarioStatus !== 'available' ? 'DATA_UNAVAILABLE'
      : !closeConfirmed ? 'WAIT_CLOSE'
      : !triggered.length ? 'WAIT_TRIGGER'
      : riskUnsupported ? 'TRIGGERED_RISK_INCOMPLETE'
      : positionUnsupported ? 'PLAN_WITHOUT_SIZE'
      : 'PLAN_READY';
    var decisionLabels = {
      INTRADAY_GUIDANCE: '盘中参考\u00b7待收盘', DATA_UNAVAILABLE: '数据待核对', WAIT_CLOSE: '等待收盘', WAIT_TRIGGER: '等待触发',
      TRIGGERED_RISK_INCOMPLETE: '已触发\u00b7风控未齐', PLAN_WITHOUT_SIZE: '计划成立\u00b7仓位未定', PLAN_READY: '计划要素齐全'
    };
    var actionState = decisionCode === 'PLAN_READY' ? 'observe_only' : 'no_trade';
    var noTrade = [];
    if (scenarioStatus !== 'available') noTrade.push(statusInfo.issue || '情景条件状态不可用。');
    if (!closeConfirmed) noTrade.push('未验证同日完整日K；盘中或孤立状态文件不能视为日线确认。');
    if (quoteStatus !== 'available') noTrade.push('当前报价' + (quoteState === 'missing' ? '缺失' : '已过期') + '，只观察，不以价格触及触发。');
    if (riskUnsupported) noTrade.push('独立灾难止损未配置；结构失效位不能替代灾难止损。');
    if (positionUnsupported) noTrade.push('未提供风险预算/仓位规模，不能给出或暗示仓位。');
    var nextAction = decisionCode === 'INTRADAY_GUIDANCE' ? (zone.action || '按当前价格战区观察；正式情景等待收盘确认。')
      : decisionCode === 'DATA_UNAVAILABLE' ? '先恢复同日情景状态与数据版本。'
      : decisionCode === 'WAIT_CLOSE' ? '等待同日完整日K与 close_final，盘中触及不算。'
      : decisionCode === 'WAIT_TRIGGER' ? '等待A/B/C核心条件按规则完成，不提前押方向。'
      : decisionCode === 'TRIGGERED_RISK_INCOMPLETE' ? '情景已触发；补齐独立灾难止损前不执行。'
      : decisionCode === 'PLAN_WITHOUT_SIZE' ? '计划条件已齐；补充风险预算后再确定仓位。'
      : '按已触发情景的入场确认执行，结构失效立即退出。';
    var primaryInvalidation = primary && primary.structural_invalidation && Number.isFinite(primary.structural_invalidation.price)
      ? primary.structural_invalidation.price : null;
    var decision = {
      code: decisionCode,
      label: decisionLabels[decisionCode],
      headline: intradayGuidance ? ('盘中位于 ' + rangeText(zone.range) + (zone.stance ? ' \u00b7 ' + zone.stance : ''))
        : primary ? (primary.id + '情景' + (primary.state === 'triggered' ? '已触发' : primary.state === 'confirming' ? '确认中' : '候选')) : '情景不可用',
      scenario_id: primary && primary.id || null,
      scenario_strength: primary && primary.strength || null,
      current_price: quoteStatus === 'available' && quote && Number.isFinite(quote.price) ? quote.price : null,
      reference_price: Number.isFinite(f.basePrice) ? f.basePrice : null,
      current_zone: zone ? { range: zone.range, range_text: rangeText(zone.range), stance: zone.stance, action: zone.action, invalidation: zone.invalidation } : null,
      tactical_window: tactical,
      key_level_distances: keyLevelDistances(quoteStatus === 'available' && quote ? quote.price : null, scenarios, annotations && annotations.intraday_playbook, gap.status === 'available' ? gap.data : null),
      gap_takeover: !!(intradayGuidance && gap.status === 'available' && gap.data && Array.isArray(gap.data.range) && quote && Number.isFinite(quote.price) && quote.price >= gap.data.range[0] && quote.price < gap.data.range[1]),
      close_confirmed: closeConfirmed,
      scenario_pointer: scenarioPointer(quoteStatus === 'available' && quote ? quote.price : null, scenarios, recentAtr(bars), closeConfirmed),
      intraday_guidance: intradayGuidance,
      gap_fallback: gap.status === 'available' ? clone(gap.data) : null,
      plan: primary && primary.rr ? clone(primary.rr) : null,
      next_action: nextAction,
      structural_invalidation: primaryInvalidation,
      blockers: clone(noTrade),
      steps: {
        data: scenarioStatus === 'available' || intradayGuidance ? 'complete' : 'blocked',
        close: closeConfirmed ? 'complete' : 'waiting',
        scenario: triggered.length ? 'complete' : confirming.length ? 'waiting' : 'waiting',
        risk: riskUnsupported ? 'blocked' : positionUnsupported ? 'waiting' : 'complete'
      }
    };
    var sections = [
      section('market_regime', '1. 市场状态', source(mapStatus, SOURCE.annotations, date, f.updatedAt || annotations && annotations.meta && annotations.meta.updatedAt, mapStatus === 'missing' ? '缺少当前地图。' : null), actionState, {
        bias: f.bias || null, label: f.biasLabel || null, completed_daily_confirmation: closeConfirmed,
        market_participation: clone(participation),
        current_quote: { value: quote && quote.price || null, quote_state: quoteState, provenance: source(quoteStatus, SOURCE.quote, quote && MarketRules.dayString(quote.ts), quote && new Date(quote.ts * 1000).toISOString(), null) }
      }),
      section('key_price_zones', '2. 关键价格区', source(levels.length ? 'available' : 'missing', SOURCE.annotations, date, f.updatedAt, levels.length ? null : '未提供显式关键价位。'), actionState, { levels: clone(levels), gap_fallback: gap.data, gap_fallback_status: gap.status }),
      section('scenario_paths', '3. A/B/C 与缺口回退', source(scenarioStatus, SOURCE.annotations + ' + ' + SOURCE.status, date, status && status.updated_at, statusInfo.issue), actionState, { scenarios: scenarios, gap_fallback: gap.data, gap_fallback_status: gap.status }),
      section('trigger_confirmation', '4. 触发与确认', source(scenarioStatus === 'available' && closeConfirmed ? 'available' : (scenarioStatus === 'available' ? 'unavailable' : scenarioStatus), SOURCE.status + ' + ' + SOURCE.bars, status && status.conditions_date, status && status.updated_at, closeConfirmed ? null : '只认可同日完整日K的 close_final；盘中价格不构成日线确认。'), actionState, { judgment_mode: status && status.judgment_mode || null, daily_confirmation: closeConfirmed ? 'completed_daily_bar' : 'not_confirmed', scenarios: scenarios.map(function (s) { return { id:s.id, state:s.state, status:s.status, confirmation:s.confirmation }; }) }),
      section('no_trade_conditions', '5. 禁止交易条件', source('available', 'contract gate', date, iso(now), null), 'no_trade', { conditions: noTrade, rule: '任一关键来源过期/缺失、无独立灾难止损或无仓位数据时，状态为 no_trade。' }),
      section('risk_controls', '6. 结构失效与灾难止损', source(scenarios.length ? 'available' : 'missing', SOURCE.annotations, date, f.updatedAt, riskUnsupported ? '独立灾难止损未配置，不能把结构失效位称为灾难止损。' : null), riskUnsupported ? 'no_trade' : actionState, { scenarios: scenarios.map(function (s) { return { id:s.id, structural_invalidation:s.structural_invalidation, disaster_stop:s.disaster_stop, disaster_stop_status: !s.disaster_stop || s.disaster_stop.price == null ? 'unavailable' : 'available' }; }) }),
      section('position_management', '7. 仓位/减仓/退出', source('unavailable', SOURCE.annotations, date, f.updatedAt, '现有数据仅有部分目标/结构位，没有风险预算、账户规模或具体仓位。'), 'no_trade', { position_sizing: null, status: 'unavailable', scenario_levels: scenarios.map(function (s) { return { id:s.id, rr:s.rr }; }), rule: '不得把 RR、目标或 interim 位转译为具体仓位建议。' }),
      section('post_market_review', '8. 盘后复盘', source('unavailable', SOURCE.annotations + ' + ' + SOURCE.status, date, status && status.updated_at, '无实际成交、MFE/MAE 或执行记录，不能虚构复盘结果。'), 'observe_only', { review_status: 'unavailable', checklist: ['核对同日完整日K与 close_final 是否一致', '记录已观察情景与结构失效，不记录虚构成交', 'MFE/MAE、成交和滑点等待真实交易数据'] })
    ];
    return { contract: 'trading_operation', schema_version: VERSION, generated_at: iso(now), as_of: date, action_state: actionState, decision: decision, disclaimer: '研究与观察界面，不是执行建议；no_trade 不等于正常或可忽略。', sections: sections };
  }
  function validate(contract) {
    if (!contract || contract.contract !== 'trading_operation' || !contract.schema_version) return false;
    var ids = (contract.sections || []).map(function (s) { return s.id; });
    return SECTION_IDS.every(function (id) { return ids.indexOf(id) >= 0; }) && ids.length === SECTION_IDS.length;
  }
  return { VERSION: VERSION, SECTION_IDS: SECTION_IDS, build: build, validate: validate, fmt: fmt, keyLevelDistances: keyLevelDistances, scenarioPointer: scenarioPointer };
});
