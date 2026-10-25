(function () {
  'use strict';
  var UP = '#FF453A', DOWN = '#32D74B', GOLD = '#f5c842', ACCENT = '#0A84FF';
  var CASE = { symbol: '9992.HK', rangeLow: 147, rangeHigh: 153, invalidation: 147, breakDay: '2026-10-15', rangeFrom: '2026-09-22', entryDay: '2026-10-16', bars: 60 };

  function el(id) { return document.getElementById(id); }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmtTime(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d)) return esc(iso);
    return d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }
  function num(v, digits) { return Number.isFinite(v) ? v.toLocaleString('en-US', { maximumFractionDigits: digits == null ? 2 : digits }) : '—'; }
  function get(url) {
    return fetch(url + (url.indexOf('?') < 0 ? '?' : '&') + 't=' + Date.now(), { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw Error('HTTP ' + r.status);
      return r.json();
    });
  }
  var stamps = [];
  function noteTime(label, iso) { if (iso) stamps.push(label + ' ' + fmtTime(iso)); el('footTime').textContent = stamps.length ? '更新时间：' + stamps.join(' · ') : ''; }

  // ---------- 规则卡：全部展开 / 收起 ----------
  el('toggleAll').addEventListener('click', function () {
    var cards = document.querySelectorAll('.rule-card');
    var anyClosed = Array.prototype.some.call(cards, function (c) { return !c.open; });
    cards.forEach(function (c) { c.open = anyClosed; });
    this.textContent = anyClosed ? '全部收起' : '全部展开';
  });

  // ---------- 1. 状态条 ----------
  get('status.json').then(function (s) {
    el('sbName').textContent = s.strategy || '消息 + 价格确认';
    var badge = el('sbBadge');
    badge.textContent = s.badge || '状态未知';
    badge.className = 'sb-state ' + (s.state === 'live' ? 'ok' : s.state === 'paused' ? 'off' : 'weak');
    el('sbMsg').textContent = s.message || '';
    el('sbTime').textContent = '更新于 ' + fmtTime(s.updated_at);
    noteTime('策略状态', s.updated_at);
  }).catch(function (e) {
    el('sbBadge').textContent = '状态读取失败'; el('sbBadge').className = 'sb-state off';
    el('sbMsg').textContent = '规则未经验证，不构成投资建议（' + e.message + '）';
  });

  // ---------- 4. 回测 ----------
  get('backtest.json').then(function (b) {
    var st = el('btStatus');
    st.textContent = b.status_text || (b.status === 'done' ? '回测完成' : '回测进行中');
    st.className = 'sb-state ' + (b.status === 'done' ? 'ok' : 'weak');
    el('btTime').textContent = '更新于 ' + fmtTime(b.updated_at);
    el('btQuestions').innerHTML = (b.questions || []).map(function (q) { return '<li>' + esc(q) + '</li>'; }).join('');
    el('btLimits').innerHTML = (b.limitations || []).map(function (q) { return '<li>' + esc(q) + '</li>'; }).join('');
    var r = b.results;
    if (r) {
      // 结果由主控写入 json：{ summary: '人话结论', metrics: [{label, value, note}] }
      var html = '';
      if (r.summary) html += '<p class="bt-summary">' + esc(r.summary) + '</p>';
      if (Array.isArray(r.metrics) && r.metrics.length) {
        html += '<div class="bt-grid">' + r.metrics.map(function (m) {
          return '<div><small>' + esc(m.label) + '</small><b>' + esc(m.value) + '</b>' + (m.note ? '<small>' + esc(m.note) + '</small>' : '') + '</div>';
        }).join('') + '</div>';
      }
      el('btResults').innerHTML = html;
    } else {
      el('btResults').innerHTML = '<p class="muted bt-summary">结果还没出来。跑完后这里会直接显示结论，不会提前展示任何收益数字。</p>';
    }
    noteTime('回测', b.updated_at);
  }).catch(function (e) {
    el('btStatus').textContent = '回测数据读取失败'; el('btStatus').className = 'sb-state off';
    el('btResults').innerHTML = '<p class="muted">' + esc(e.message) + '</p>';
  });

  // ---------- 5. 信号区 ----------
  var TREND = { up: '<span class="up">向上</span>', down: '<span class="down">向下</span>', range: '<span class="gold">震荡</span>', flat: '<span class="gold">震荡</span>' };
  var COLS = 10, PENDING = '<span class="muted">待更新</span>';
  var GROUPS = [{ market: 'US', title: '美股' }, { market: 'HK', title: '港股' }];
  function distCell(dist, side) {
    if (!Number.isFinite(dist)) return '—';
    var broke = /^已破/.test(side || '');
    return (broke ? '<span class="hit">' + esc(side) + '</span> ' + num(dist, 2) + '%' : num(dist, 2) + '% <span class="muted">' + esc(side || '') + '</span>');
  }
  function rowHtml(x, d) {
    if (x.data_error) return '<tr><td class="mono">' + esc(x.code) + '</td><td>' + esc(x.name) + '</td><td colspan="' + (COLS - 2) + '" class="muted">数据缺失：' + esc(x.data_error) + '</td></tr>';
    var trig = d.triggered === true ? '<span class="hit">触发 ' + esc(d.direction === 'up' ? '↑' : d.direction === 'down' ? '↓' : '') + '</span>' : d.triggered === false ? '否' : '—';
    var range = Number.isFinite(x.range_20d_low) ? num(x.range_20d_low) + ' ~ ' + num(x.range_20d_high) : '—';
    var useToday = Number.isFinite(d.distance_to_break_pct);
    var dist = distCell(useToday ? d.distance_to_break_pct : x.distance_to_break_pct, useToday ? d.distance_side : x.distance_side);
    var vol = x.volume_surge === true ? '<span class="hit">放量</span> ' + num(x.volume_ratio, 2) + '×' : x.volume_surge === false ? '否 <span class="muted">' + num(x.volume_ratio, 2) + '×</span>' : '—';
    var news = d.latest_news || x.latest_news;
    return '<tr><td class="mono">' + esc(x.code) + '</td><td>' + esc(x.name) + '</td><td>' + (TREND[x.weekly_trend] || '—') + '</td><td class="mono">' + range + '</td><td class="mono">' + dist + '</td><td class="mono">' + vol + '</td><td>' + esc(x.option_liquidity || '—') + '</td><td class="mono">' + (x.next_event_date ? esc(x.next_event_date) : PENDING) + '</td><td class="news">' + (news ? esc(news) : PENDING) + '</td><td>' + trig + '</td></tr>';
  }
  Promise.all([get('watchlist.json'), get('today.json').catch(function () { return { items: [] }; })]).then(function (res) {
    var w = res[0], t = res[1];
    var today = {};
    (t.items || []).forEach(function (x) { today[x.code] = x; });
    var items = w.items || [];
    if (!items.length) {
      el('sigBody').innerHTML = '<tr><td colspan="' + COLS + '" class="empty">' + esc(w.note || '关注名单待潮伟哥提供') + '<br><span class="muted">名单就绪后，这里每天显示每只票离破位还有多远、有没有新消息、今天是否触发。</span></td></tr>';
    } else {
      var html = '';
      GROUPS.forEach(function (g) {
        var rows = items.filter(function (x) { return x.market === g.market; });
        if (!rows.length) return;
        html += '<tr class="sig-group"><td colspan="' + COLS + '">' + g.title + ' · ' + rows.length + ' 只</td></tr>';
        html += rows.map(function (x) { return rowHtml(x, today[x.code] || {}); }).join('');
      });
      var rest = items.filter(function (x) { return !GROUPS.some(function (g) { return g.market === x.market; }); });
      if (rest.length) html += '<tr class="sig-group"><td colspan="' + COLS + '">其他</td></tr>' + rest.map(function (x) { return rowHtml(x, today[x.code] || {}); }).join('');
      el('sigBody').innerHTML = html;
    }
    el('sigTime').textContent = '名单更新 ' + fmtTime(w.updated_at) + (w.data_through ? ' · 数据截至 ' + w.data_through + ' 收盘' : '') + ' · 今日信号 ' + (t.date ? t.date : '—');
    el('sigNote').textContent = [items.length ? w.note : '', t.note].filter(Boolean).join(' ');
    noteTime('名单', w.updated_at);
  }).catch(function (e) {
    el('sigBody').innerHTML = '<tr><td colspan="' + COLS + '" class="empty">名单读取失败：' + esc(e.message) + '</td></tr>';
  });

  // ---------- 3. 案例 K 线 ----------
  function fromApi(d) {
    var off = Number.isFinite(d.gmtoffset) ? d.gmtoffset : 28800, out = [];
    (d.timestamp || []).forEach(function (ts, i) {
      var o = d.open[i], h = d.high[i], l = d.low[i], c = d.close[i];
      if (![o, h, l, c].every(Number.isFinite)) return;
      out.push({ time: new Date((ts + off) * 1000).toISOString().slice(0, 10), open: o, high: h, low: l, close: c, volume: d.volume[i] || 0 });
    });
    return out;
  }
  function pickWindow(bars) {
    var bi = bars.findIndex(function (b) { return b.time === CASE.breakDay; });
    var end = bars.length;
    // 日后数据变多时，窗口不再一直向后滑：破位日前至少保留 20 根，破位区间始终可见
    if (bi >= 0 && end - bi > CASE.bars - 20) end = bi + CASE.bars - 20;
    return bars.slice(Math.max(0, end - CASE.bars), end);
  }
  function drawChart(bars, srcText) {
    var box = el('caseChart');
    if (!window.LightweightCharts) { box.innerHTML = '<div class="chart-fallback">图表库未加载</div>'; return; }
    var chart = LightweightCharts.createChart(box, {
      layout: { background: { type: 'solid', color: '#0D0D0F' }, textColor: 'rgba(235,235,245,0.6)', fontSize: 11 },
      grid: { vertLines: { color: 'rgba(255,255,255,0.03)' }, horzLines: { color: 'rgba(255,255,255,0.04)' } },
      rightPriceScale: { borderColor: 'rgba(255,255,255,0.08)' },
      timeScale: { borderColor: 'rgba(255,255,255,0.08)', timeVisible: false },
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
      handleScroll: { vertTouchDrag: false },
      handleScale: { axisPressedMouseMove: { time: true, price: false } }
    });
    var series = chart.addCandlestickSeries({ upColor: UP, downColor: DOWN, borderUpColor: UP, borderDownColor: DOWN, wickUpColor: UP, wickDownColor: DOWN });
    series.setData(bars.map(function (b) { return { time: b.time, open: b.open, high: b.high, low: b.low, close: b.close }; }));
    chart.priceScale('right').applyOptions({ scaleMargins: { top: 0.06, bottom: 0.18 } });
    var vol = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'volume', priceLineVisible: false, lastValueVisible: false });
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.84, bottom: 0 }, visible: false });
    vol.setData(bars.map(function (b) { return { time: b.time, value: b.volume, color: b.time === CASE.breakDay ? 'rgba(245,200,66,0.75)' : (b.close >= b.open ? 'rgba(255,69,58,0.35)' : 'rgba(50,215,75,0.35)') }; }));
    series.createPriceLine({ price: CASE.rangeHigh, color: GOLD, lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: true, title: '' });
    series.createPriceLine({ price: CASE.invalidation, color: ACCENT, lineWidth: 2, lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: true, title: '失效 147' });
    var markers = [];
    if (bars.some(function (b) { return b.time === CASE.breakDay; })) markers.push({ time: CASE.breakDay, position: 'aboveBar', color: GOLD, shape: 'arrowDown', text: '破位 145.5' });
    if (bars.some(function (b) { return b.time === CASE.entryDay; })) markers.push({ time: CASE.entryDay, position: 'belowBar', color: ACCENT, shape: 'arrowUp', text: '次日进场' });
    series.setMarkers(markers);

    // 横盘区间阴影带（147~153），随缩放重算位置
    var band = document.createElement('div');
    band.className = 'range-band';
    box.appendChild(band);
    function placeBand() {
      var y1 = series.priceToCoordinate(CASE.rangeHigh), y2 = series.priceToCoordinate(CASE.rangeLow);
      if (y1 == null || y2 == null) { band.style.display = 'none'; return; }
      band.style.display = 'block';
      band.style.top = Math.min(y1, y2) + 'px';
      band.style.height = Math.abs(y2 - y1) + 'px';
      var x1 = chart.timeScale().timeToCoordinate(CASE.rangeFrom), x2 = chart.timeScale().timeToCoordinate(CASE.breakDay);
      var paneW = box.clientWidth - (chart.priceScale('right').width() || 0);
      var left = x1 == null ? 0 : Math.max(0, x1), right = x2 == null ? paneW : Math.min(paneW, x2);
      band.style.left = left + 'px';
      band.style.right = 'auto';
      band.style.width = Math.max(0, right - left) + 'px';
    }
    chart.timeScale().fitContent();
    chart.timeScale().subscribeVisibleLogicalRangeChange(function () { requestAnimationFrame(placeBand); });
    function resize() { chart.applyOptions({ width: box.clientWidth, height: box.clientHeight }); requestAnimationFrame(placeBand); }
    window.addEventListener('resize', resize);
    resize();
    setTimeout(placeBand, 50);
    el('chartSrc').textContent = srcText;
  }

  function useStatic(reason) {
    return get('case-9992-kline.json').then(function (d) {
      drawChart(d.bars, '日 K：' + d.source + ' · 静态备份，截止 ' + d.through + ' 收盘 · 共 ' + d.bars.length + ' 根' + (reason ? '（实时接口不可用：' + reason + '）' : ''));
      noteTime('K 线备份', d.fetched_at);
    });
  }
  get('/api/kline?symbol=' + encodeURIComponent(CASE.symbol) + '&interval=1d&range=6mo').then(function (d) {
    var bars = pickWindow(fromApi(d));
    if (bars.length < 30 || !bars.some(function (b) { return b.time === CASE.breakDay; })) throw Error('接口数据不完整');
    drawChart(bars, '日 K：Yahoo Finance（站内 /api/kline 代理）· 最近 ' + bars.length + ' 根，最后一根 ' + bars[bars.length - 1].time);
    if (d.regularMarketTime) noteTime('K 线', new Date(d.regularMarketTime * 1000).toISOString());
  }).catch(function (e) {
    return useStatic(e.message);
  }).catch(function (e) {
    el('caseChart').innerHTML = '<div class="chart-fallback">K 线加载失败：' + esc(e.message) + '</div>';
    el('chartSrc').textContent = '';
  });
})();
