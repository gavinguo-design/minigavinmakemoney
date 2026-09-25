/* ============================================================
 * 蜡烛图形态自动识别模块（纯函数，无 DOM 依赖，可在 Node 中单测）
 *
 *   CandlePatterns.detect(bars, opts) ->
 *     [{ index, id, name, short, direction('bull'|'bear'|'neutral'),
 *        strength('strong'|'weak'), note(数值依据), explain(教科书一句话) }]
 *
 *   bars: [{ open, high, low, close, time }]，按时间升序
 *   opts: { intraday: true 时跳过缺口检测（分钟线午休/隔夜缺口无意义） }
 *
 * 规则全部按教科书标准定义（Nison《日本蜡烛图技术》），阈值偏保守：
 * 宁可漏检、不可错标。所有阈值集中在 CFG，可调。
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { root.CandlePatterns = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CFG = {
    AVG_WIN: 20,          // 实体/振幅均值窗口：近20根（不含当前根）
    EXT_WIN: 20,          // 位置加权窗口：近20根极值
    EXT_PCT: 0.015,       // 极值区容差 ±1.5%（形态落在此区域 = 强信号）
    TREND_BARS: 5,        // 趋势上下文：形态前5根净涨跌
    markWeakSignals: true,   // false = 只输出强信号（发生在极值区的形态）
    dojiOnlyAtExtreme: true, // 十字星过于常见，仅在极值区标注（可配置）

    // --- 单根形态 ---
    HAMMER_SHADOW_BODY: 2.0,   // 锤子类：主影线 ≥ 2倍实体（教科书 2~3 倍）
    HAMMER_SHADOW_RANGE: 0.55, // 主影线 ≥ 全幅 55%（确保影线是K线主体）
    HAMMER_OPP_SHADOW: 0.12,   // 反向影线 ≤ 全幅 12%（“几乎没有”）
    HAMMER_BODY_MAX: 0.33,     // 实体 ≤ 全幅 1/3（小实体）
    HAMMER_MIN_RANGE: 0.8,     // 全幅 ≥ 0.8×近20根均幅（过滤微小噪音K线）
    DOJI_BODY: 0.10,           // 十字星：实体 ≤ 全幅 10%
    DOJI_MIN_RANGE: 0.8,       // 全幅 ≥ 0.8×均幅（长腿十字才有信号意义，过滤停滞小K线）
    MARU_BODY: 0.85,           // 光头光脚：实体 ≥ 全幅 85%
    MARU_MIN_RANGE: 1.3,       // 且全幅 ≥ 1.3×均幅（“振幅显著大于近20根均值”）
    MARU_STRONG_RANGE: 1.8,    // 全幅 ≥ 1.8×均幅 → 视为强信号

    // --- 双根形态 ---
    ENGULF_MIN_PREV_BODY: 0.3, // 被吞没实体 ≥ 0.3×均实体（吞掉一根小星线意义不大）
    ENGULF_MIN_CUR_BODY: 0.8,  // 吞没实体 ≥ 0.8×均实体（本身要有力度）
    CLOUD_MIN_BODY: 1.0,       // 乌云盖顶/曙光初现：前一根实体 ≥ 1×均实体（大实体）

    // --- 三根形态 ---
    STAR_BIG_BODY: 1.0,        // 星线组合：首根实体 ≥ 1×均实体
    STAR_SMALL_BODY: 0.5,      // 中间星线实体 ≤ 0.5×首根实体
    STAR_THIRD_BODY: 0.6,      // 第三根实体 ≥ 0.6×均实体
    SOLDIER_BODY: 1.0,         // 红三兵/三乌鸦：每根实体 ≥ 1×均实体（大实体）
    SOLDIER_SHADOW: 0.35,      // 顺势方向影线 ≤ 0.35×实体（收在极端附近）

    // --- 缺口 ---
    GAP_MIN_RANGE: 0.5,        // 缺口 ≥ 0.5×均幅（恒指隔夜跳空是常态，小缺口不标）
    GAP_STRONG_RANGE: 1.0      // 缺口 ≥ 1×均幅 → 强信号
  };

  // 形态元信息：短名（图上标签）+ 教科书一句话解释
  var META = {
    hammer:        { name: '锤子线',   short: '锤子',   dir: 'bull',
      explain: '下跌后出现的长下影小实体K线：空方盘中大力打压，但买盘强力承接收回，潜在见底反转信号。' },
    hangingMan:    { name: '上吊线',   short: '上吊',   dir: 'bear',
      explain: '上涨后出现的长下影K线：盘中一度深跌说明获利盘开始出逃，虽被拉回仍是见顶警示。' },
    invHammer:     { name: '倒锤子线', short: '倒锤',   dir: 'bull',
      explain: '下跌后出现的长上影小实体K线：多方尝试反攻的试探信号，若次日收阳确认则反转概率提升。' },
    shootingStar:  { name: '射击之星', short: '射击星', dir: 'bear',
      explain: '上涨后冲高大幅回落留长上影：多方力竭、空方在高位反击成功，潜在见顶反转信号。' },
    doji:          { name: '十字星',   short: '十字',   dir: 'neutral',
      explain: '开盘收盘几乎相同，多空力量暂时均衡；出现在趋势末端时预示原趋势动能衰减。' },
    maruBull:      { name: '光头光脚大阳线', short: '大阳', dir: 'bull',
      explain: '几乎无上下影线的超大阳线：多方全程压制、以最高价附近收盘，动能极强。' },
    maruBear:      { name: '光头光脚大阴线', short: '大阴', dir: 'bear',
      explain: '几乎无上下影线的超大阴线：空方全程压制、以最低价附近收盘，抛压极重。' },
    bullEngulf:    { name: '看涨吞没', short: '吞没↑', dir: 'bull',
      explain: '阳线实体完全包住前一根阴线实体：买方力量压倒性逆转，经典底部反转形态。' },
    bearEngulf:    { name: '看跌吞没', short: '吞没↓', dir: 'bear',
      explain: '阴线实体完全包住前一根阳线实体：卖方力量压倒性逆转，经典顶部反转形态。' },
    darkCloud:     { name: '乌云盖顶', short: '乌云',   dir: 'bear',
      explain: '高开后深跌进前一根大阳线实体50%以下收盘：多头士气受挫，见顶警示形态。' },
    piercing:      { name: '曙光初现', short: '曙光',   dir: 'bull',
      explain: '低开后强力收复前一根大阴线实体50%以上：空头动能被消化，见底信号。' },
    morningStar:   { name: '早晨之星', short: '晨星',   dir: 'bull',
      explain: '长阴 + 向下跳空小实体星线 + 收复过半的长阳，三段式完成空转多，可靠的底部反转形态。' },
    eveningStar:   { name: '黄昏之星', short: '黄昏星', dir: 'bear',
      explain: '长阳 + 向上跳空小实体星线 + 跌破过半的长阴，三段式完成多转空，可靠的顶部反转形态。' },
    threeSoldiers: { name: '红三兵',   short: '红三兵', dir: 'bull',
      explain: '连续三根依次走高、收于高位的大阳线：多方持续发力，强势上攻信号。' },
    threeCrows:    { name: '三只乌鸦', short: '三乌鸦', dir: 'bear',
      explain: '连续三根依次走低、收于低位的大阴线：空方持续发力，强势下杀信号。' },
    gapUp:         { name: '向上跳空缺口', short: '跳空↑', dir: 'bull',
      explain: '今日最低价高于昨日最高价、全天未回补：多方跳空主动进攻，缺口常成后续支撑。' },
    gapDown:       { name: '向下跳空缺口', short: '跳空↓', dir: 'bear',
      explain: '今日最高价低于昨日最低价、全天未回补：空方跳空压制，缺口常成后续阻力。' }
  };

  // 同一根K线只保留优先级最高的一个形态，避免重复堆标
  var PRIORITY = {
    morningStar: 7, eveningStar: 7, threeSoldiers: 6, threeCrows: 6,
    bullEngulf: 5, bearEngulf: 5, darkCloud: 5, piercing: 5,
    maruBull: 4, maruBear: 4,
    hammer: 3, hangingMan: 3, invHammer: 3, shootingStar: 3,
    gapUp: 2, gapDown: 2, doji: 1
  };

  function rp(x) { return Math.round(x); } // 恒指点位取整用于展示

  function detect(bars, opts) {
    opts = opts || {};
    var n = bars.length;
    var out = [];
    if (n < CFG.AVG_WIN + 6) return out; // 历史不足，均值/趋势判断不可靠

    // ---- 预计算 ----
    var o = [], h = [], l = [], c = [], body = [], rng = [], upSh = [], loSh = [], bull = [];
    for (var i = 0; i < n; i++) {
      var b = bars[i];
      o.push(b.open); h.push(b.high); l.push(b.low); c.push(b.close);
      body.push(Math.abs(b.close - b.open));
      rng.push(b.high - b.low);
      upSh.push(b.high - Math.max(b.open, b.close));
      loSh.push(Math.min(b.open, b.close) - b.low);
      bull.push(b.close > b.open);
    }
    function avgOf(arr, idx) { // 近20根均值（不含当前根）
      var s = 0, k = 0;
      for (var j = Math.max(0, idx - CFG.AVG_WIN); j < idx; j++) { s += arr[j]; k++; }
      return k ? s / k : 0;
    }
    function hh20(idx) { var m = -Infinity; for (var j = Math.max(0, idx - CFG.EXT_WIN + 1); j <= idx; j++) if (h[j] > m) m = h[j]; return m; }
    function ll20(idx) { var m = Infinity; for (var j = Math.max(0, idx - CFG.EXT_WIN + 1); j <= idx; j++) if (l[j] < m) m = l[j]; return m; }

    // 位置加权：看涨形态出现在近20根最低点±1.5%内 / 看跌形态在最高点附近 → 强信号
    function atLow(idx) { return l[idx] <= ll20(idx) * (1 + CFG.EXT_PCT); }
    function atHigh(idx) { return h[idx] >= hh20(idx) * (1 - CFG.EXT_PCT); }

    // 趋势上下文（教科书：反转形态必须有前置趋势）：
    // 下跌 = 形态前5根净下跌，或形态K线创近10根新低；上涨镜像
    function downBefore(idx) {
      if (idx < CFG.TREND_BARS + 1) return false;
      if (c[idx - 1] < c[idx - 1 - CFG.TREND_BARS]) return true;
      var m = Infinity; for (var j = Math.max(0, idx - 10); j < idx; j++) if (l[j] < m) m = l[j];
      return l[idx] <= m;
    }
    function upBefore(idx) {
      if (idx < CFG.TREND_BARS + 1) return false;
      if (c[idx - 1] > c[idx - 1 - CFG.TREND_BARS]) return true;
      var m = -Infinity; for (var j = Math.max(0, idx - 10); j < idx; j++) if (h[j] > m) m = h[j];
      return h[idx] >= m;
    }

    var byIndex = {}; // index -> candidate（保留优先级最高者）
    function push(idx, id, strength, note) {
      if (strength === 'weak' && !CFG.markWeakSignals) return;
      var prev = byIndex[idx];
      if (prev && PRIORITY[prev.id] >= PRIORITY[id]) return;
      var meta = META[id];
      byIndex[idx] = { index: idx, id: id, name: meta.name, short: meta.short,
        direction: meta.dir, strength: strength, note: note, explain: meta.explain };
    }
    // 反转形态的强弱：按方向对应的极值位置判定
    function strengthFor(dir, idx) {
      if (dir === 'bull') return atLow(idx) ? 'strong' : 'weak';
      if (dir === 'bear') return atHigh(idx) ? 'strong' : 'weak';
      return 'weak';
    }

    for (i = CFG.AVG_WIN; i < n; i++) {
      var aR = avgOf(rng, i), aB = avgOf(body, i);
      if (aR <= 0 || aB <= 0 || rng[i] <= 0) continue;

      // ============ 三根形态（优先级最高） ============
      if (i >= CFG.AVG_WIN + 2) {
        var i1 = i - 2, i2 = i - 1, i3 = i;
        var mid1 = (o[i1] + c[i1]) / 2;

        // --- 早晨之星：长阴 → 实体向下跳空的小星线 → 收复长阴实体一半以上的阳线，且前置下跌 ---
        if (!bull[i1] && body[i1] >= CFG.STAR_BIG_BODY * aB &&
            body[i2] <= CFG.STAR_SMALL_BODY * body[i1] &&
            Math.max(o[i2], c[i2]) < c[i1] &&            // 星线实体整体低于长阴收盘（实体跳空）
            bull[i3] && body[i3] >= CFG.STAR_THIRD_BODY * aB &&
            c[i3] >= mid1 &&                              // 第三根收进长阴实体50%以上
            downBefore(i1)) {
          push(i3, 'morningStar', strengthFor('bull', i2),
            '长阴实体' + rp(body[i1]) + '点 → 星线实体' + rp(body[i2]) + '点(=' + (body[i2] / body[i1] * 100).toFixed(0) + '%长阴) → 阳线收' + rp(c[i3]) + '收复长阴中点' + rp(mid1) + '以上');
        }
        // --- 黄昏之星：镜像 ---
        if (bull[i1] && body[i1] >= CFG.STAR_BIG_BODY * aB &&
            body[i2] <= CFG.STAR_SMALL_BODY * body[i1] &&
            Math.min(o[i2], c[i2]) > c[i1] &&            // 星线实体整体高于长阳收盘
            !bull[i3] && body[i3] >= CFG.STAR_THIRD_BODY * aB &&
            c[i3] <= mid1 &&
            upBefore(i1)) {
          push(i3, 'eveningStar', strengthFor('bear', i2),
            '长阳实体' + rp(body[i1]) + '点 → 星线实体' + rp(body[i2]) + '点 → 阴线收' + rp(c[i3]) + '跌破长阳中点' + rp(mid1));
        }

        // --- 红三兵：三根大阳，逐根新高收盘，开盘在前实体内，上影很短 ---
        var sol = true, k;
        for (k = i - 2; k <= i; k++) {
          if (!(bull[k] && body[k] >= CFG.SOLDIER_BODY * aB && upSh[k] <= CFG.SOLDIER_SHADOW * body[k])) { sol = false; break; }
          if (k > i - 2 && !(c[k] > c[k - 1] && o[k] > o[k - 1] && o[k] < c[k - 1])) { sol = false; break; }
        }
        if (sol) {
          push(i, 'threeSoldiers', atLow(i - 2) ? 'strong' : 'weak',
            '三连阳实体 ' + rp(body[i - 2]) + '/' + rp(body[i - 1]) + '/' + rp(body[i]) + '点（均值' + rp(aB) + '点），收盘逐根抬高');
        }
        // --- 三只乌鸦：镜像 ---
        var crow = true;
        for (k = i - 2; k <= i; k++) {
          if (!(!bull[k] && body[k] >= CFG.SOLDIER_BODY * aB && loSh[k] <= CFG.SOLDIER_SHADOW * body[k])) { crow = false; break; }
          if (k > i - 2 && !(c[k] < c[k - 1] && o[k] < o[k - 1] && o[k] > c[k - 1])) { crow = false; break; }
        }
        if (crow) {
          push(i, 'threeCrows', atHigh(i - 2) ? 'strong' : 'weak',
            '三连阴实体 ' + rp(body[i - 2]) + '/' + rp(body[i - 1]) + '/' + rp(body[i]) + '点（均值' + rp(aB) + '点），收盘逐根走低');
        }
      }

      // ============ 双根形态 ============
      if (i >= CFG.AVG_WIN + 1) {
        var p = i - 1;

        // --- 看涨吞没：前阴后阳，阳线实体完全包住前阴实体，且前置下跌 ---
        if (!bull[p] && bull[i] &&
            o[i] <= c[p] && c[i] >= o[p] && body[i] > body[p] &&
            body[p] >= CFG.ENGULF_MIN_PREV_BODY * aB &&
            body[i] >= CFG.ENGULF_MIN_CUR_BODY * aB &&
            downBefore(i)) {
          push(i, 'bullEngulf', strengthFor('bull', i),
            '阳线实体' + rp(body[i]) + '点完全包住前阴实体' + rp(body[p]) + '点（' + (body[i] / body[p]).toFixed(1) + '倍）');
        }
        // --- 看跌吞没：镜像 ---
        if (bull[p] && !bull[i] &&
            o[i] >= c[p] && c[i] <= o[p] && body[i] > body[p] &&
            body[p] >= CFG.ENGULF_MIN_PREV_BODY * aB &&
            body[i] >= CFG.ENGULF_MIN_CUR_BODY * aB &&
            upBefore(i)) {
          push(i, 'bearEngulf', strengthFor('bear', i),
            '阴线实体' + rp(body[i]) + '点完全包住前阳实体' + rp(body[p]) + '点（' + (body[i] / body[p]).toFixed(1) + '倍）');
        }

        var midP = (o[p] + c[p]) / 2;
        // --- 乌云盖顶：前一根大阳，今开高于前高，收进前阳实体50%以下但未完全吞没，且前置上涨 ---
        if (bull[p] && body[p] >= CFG.CLOUD_MIN_BODY * aB &&
            !bull[i] && o[i] > h[p] && c[i] < midP && c[i] > o[p] &&
            upBefore(i)) {
          push(i, 'darkCloud', strengthFor('bear', i),
            '高开' + rp(o[i] - h[p]) + '点于前高上方，收' + rp(c[i]) + '插入前阳实体' + ((o[p] + body[p] - c[i]) / body[p] * 100).toFixed(0) + '%（>50%）');
        }
        // --- 曙光初现：前一根大阴，今开低于前低，收复前阴实体50%以上但未完全吞没，且前置下跌 ---
        if (!bull[p] && body[p] >= CFG.CLOUD_MIN_BODY * aB &&
            bull[i] && o[i] < l[p] && c[i] > midP && c[i] < o[p] &&
            downBefore(i)) {
          push(i, 'piercing', strengthFor('bull', i),
            '低开' + rp(l[p] - o[i]) + '点于前低下方，收' + rp(c[i]) + '收复前阴实体' + ((c[i] - c[p]) / body[p] * 100).toFixed(0) + '%（>50%）');
        }

        // --- 缺口（仅日线/周线；分钟线的午休/隔夜缺口无分析意义） ---
        if (!opts.intraday) {
          var gapU = l[i] - h[p]; // 全天最低仍高于昨高 = 未回补
          if (o[i] > h[p] && gapU >= CFG.GAP_MIN_RANGE * aR) {
            push(i, 'gapUp', gapU >= CFG.GAP_STRONG_RANGE * aR ? 'strong' : 'weak',
              '跳空' + rp(gapU) + '点（=' + (gapU / aR).toFixed(1) + '倍均幅），全天未回补');
          }
          var gapD = l[p] - h[i];
          if (o[i] < l[p] && gapD >= CFG.GAP_MIN_RANGE * aR) {
            push(i, 'gapDown', gapD >= CFG.GAP_STRONG_RANGE * aR ? 'strong' : 'weak',
              '跳空' + rp(gapD) + '点（=' + (gapD / aR).toFixed(1) + '倍均幅），全天未回补');
          }
        }
      }

      // ============ 单根形态 ============
      var bodyPct = body[i] / rng[i];

      // --- 光头光脚大阳/大阴：实体 ≥ 85% 全幅，且全幅显著大于均值 ---
      if (bodyPct >= CFG.MARU_BODY && rng[i] >= CFG.MARU_MIN_RANGE * aR) {
        push(i, bull[i] ? 'maruBull' : 'maruBear',
          rng[i] >= CFG.MARU_STRONG_RANGE * aR ? 'strong' : 'weak',
          '实体' + rp(body[i]) + '点=全幅的' + (bodyPct * 100).toFixed(0) + '%，全幅' + rp(rng[i]) + '点=近20根均幅的' + (rng[i] / aR).toFixed(1) + '倍');
      }

      // --- 锤子线/上吊线：长下影(≥2倍实体且≥55%全幅) + 极短上影 + 小实体 ---
      if (rng[i] >= CFG.HAMMER_MIN_RANGE * aR &&
          loSh[i] >= CFG.HAMMER_SHADOW_BODY * Math.max(body[i], rng[i] * 0.03) && // 实体近0时用3%全幅兜底，避免除零放大
          loSh[i] >= CFG.HAMMER_SHADOW_RANGE * rng[i] &&
          upSh[i] <= CFG.HAMMER_OPP_SHADOW * rng[i] &&
          bodyPct <= CFG.HAMMER_BODY_MAX) {
        var hNote = '下影' + rp(loSh[i]) + '点=' + (body[i] > 0 ? '实体的' + (loSh[i] / body[i]).toFixed(1) + '倍' : '全幅的' + (loSh[i] / rng[i] * 100).toFixed(0) + '%') + '，上影仅' + rp(upSh[i]) + '点';
        if (downBefore(i)) push(i, 'hammer', strengthFor('bull', i), hNote);
        else if (upBefore(i)) push(i, 'hangingMan', strengthFor('bear', i), hNote);
        // 无明确趋势上下文 → 不标（教科书要求反转形态必须有前置趋势）
      }

      // --- 倒锤子/射击之星：长上影 + 极短下影 + 小实体（镜像） ---
      if (rng[i] >= CFG.HAMMER_MIN_RANGE * aR &&
          upSh[i] >= CFG.HAMMER_SHADOW_BODY * Math.max(body[i], rng[i] * 0.03) &&
          upSh[i] >= CFG.HAMMER_SHADOW_RANGE * rng[i] &&
          loSh[i] <= CFG.HAMMER_OPP_SHADOW * rng[i] &&
          bodyPct <= CFG.HAMMER_BODY_MAX) {
        var sNote = '上影' + rp(upSh[i]) + '点=' + (body[i] > 0 ? '实体的' + (upSh[i] / body[i]).toFixed(1) + '倍' : '全幅的' + (upSh[i] / rng[i] * 100).toFixed(0) + '%') + '，下影仅' + rp(loSh[i]) + '点';
        if (upBefore(i)) push(i, 'shootingStar', strengthFor('bear', i), sNote);
        else if (downBefore(i)) push(i, 'invHammer', strengthFor('bull', i), sNote);
      }

      // --- 十字星：实体 ≤ 10% 全幅（默认仅在近期高低点区域标注，太常见） ---
      if (bodyPct <= CFG.DOJI_BODY && rng[i] >= CFG.DOJI_MIN_RANGE * aR) {
        var extreme = atLow(i) || atHigh(i);
        if (!CFG.dojiOnlyAtExtreme || extreme) {
          push(i, 'doji', 'weak',
            '实体仅' + rp(body[i]) + '点=全幅' + rp(rng[i]) + '点的' + (bodyPct * 100).toFixed(0) + '%' + (extreme ? '，且处于近20根极值区' : ''));
        }
      }
    }

    var res = [];
    Object.keys(byIndex).forEach(function (k) { res.push(byIndex[k]); });
    res.sort(function (x, y) { return x.index - y.index; });
    return res;
  }

  return { detect: detect, CFG: CFG, META: META };
});
