const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const MR = require('../investment/chart/market-rules.js');
const html = fs.readFileSync(path.join(__dirname, '../investment/chart/index.html'), 'utf8');

// 2026-10-22 preopen bands (based on the 10-21 close 23,651.87).
const bands = [{id:'A',lo:24524.63,hi:24934.06},{id:'B',lo:23500,hi:24524.63},{id:'C',lo:23500,hi:23737.14}];
const base = 23651.87;

function extract(name) {
  const start = html.indexOf('  function ' + name + '(');
  assert.ok(start >= 0, name);
  return html.slice(start, html.indexOf('\n  }', start) + 4);
}

test('price below every scenario band draws no fan and states the old map is finished', () => {
  const plan = MR.fanPlan(bands, 22934.68, base, {baseDate:'2026-10-21', live:true});
  assert.equal(plan.mode, 'below_all');
  assert.deepEqual(plan.draw, []);
  assert.deepEqual(plan.hidden, ['A','B','C']);
  assert.match(plan.message, /^今日已跌破 C 目标 23,500/);
  assert.match(plan.message, /原剧本（基于 10-21 收盘）已走完，等收盘后新剧本/);
});

test('after the close the message names the close date and waits for the next preopen map', () => {
  const plan = MR.fanPlan(bands, 22934.68, base, {baseDate:'2026-10-21', live:false, priceLabel:'10-22 收盘'});
  assert.match(plan.message, /^10-22 收盘已跌破 C 目标/);
  assert.match(plan.message, /等下一交易日盘前新剧本/);
});

test('price above every band is handled symmetrically', () => {
  const plan = MR.fanPlan(bands, 25010, base, {baseDate:'2026-10-21', live:true});
  assert.equal(plan.mode, 'above_all');
  assert.deepEqual(plan.draw, []);
  assert.match(plan.message, /^今日已升破 A 目标 24,934/);
});

test('partial exit hides only bands lying wholly against the realised move', () => {
  const down = MR.fanPlan(bands, 23520, base, {baseDate:'2026-10-21'});
  assert.equal(down.mode, 'partial');
  assert.deepEqual(down.draw, ['B','C']);
  assert.deepEqual(down.hidden, ['A']);
  const up = MR.fanPlan(bands, 24600, base, {baseDate:'2026-10-21'});
  assert.deepEqual(up.draw, ['A']);
  assert.deepEqual(up.hidden, ['B','C']);
  assert.match(up.message, /已升离 B\/C 价格带/);
});

test('small moves inside the dead zone and missing data keep the original fan', () => {
  assert.equal(MR.fanPlan(bands, 23600, base, {}).mode, 'normal'); // -0.2%
  assert.deepEqual(MR.fanPlan(bands, 23600, base, {}).draw, ['A','B','C']);
  assert.equal(MR.fanPlan(bands, NaN, base, {}).mode, 'normal');
  assert.equal(MR.fanPlan([], 22000, base, {}).mode, 'normal');
  // boundary: exactly at the lowest band edge is not "outside"
  assert.notEqual(MR.fanPlan(bands, 23500, base, {}).mode, 'below_all');
});

test('page wires the stale-fan guard: no fan series when price left every band; basis date on cards and badge', () => {
  const ctx = vm.createContext({MarketRules:MR, viewingDate:null,
    zonePoints:(sc)=>({upper:[{offset:0,price:base},{offset:5,price:sc._hi}],lower:[{offset:0,price:base},{offset:5,price:sc._lo}]}),
    shortName:(n)=>String(n||'').split('·')[0].trim()});
  vm.runInContext(extract('forecastFanPlan'), ctx);
  const a = {forecast:{baseDate:'2026-10-21', basePrice:base}};
  const scenarios = bands.map(b => ({id:b.id, _lo:b.lo, _hi:b.hi}));
  const bars = [{time:{year:2026,month:10,day:21},close:base},{time:{year:2026,month:10,day:22},close:22934.68,partial:true}];
  const plan = ctx.forecastFanPlan(a, bars, scenarios);
  assert.equal(plan.mode, 'below_all');
  assert.match(plan.message, /^今日已跌破 C 目标/);
  // the confirmed 10-22 close (not partial) labels the date
  const closed = ctx.forecastFanPlan(a, [bars[0], {...bars[1], partial:false}], scenarios);
  assert.match(closed.message, /^10-22 收盘已跌破/);
  // no newer bar than the baseline: unchanged fan
  assert.equal(ctx.forecastFanPlan(a, [bars[0]], scenarios).mode, 'normal');
  // history replay keeps the original fan for prediction-vs-outcome review
  ctx.viewingDate = '2026-10-22';
  assert.equal(ctx.forecastFanPlan(a, bars, scenarios).mode, 'normal');

  const zones = extract('renderForecastZones');
  assert.match(zones, /fanPlan\.mode === 'below_all' \|\| fanPlan\.mode === 'above_all'\) \{ scheduleGutterRefresh\(\); return; \}/);
  assert.ok(zones.indexOf("fanPlan.mode === 'below_all'") < zones.indexOf('chart.addHistogramSeries'), 'guard runs before any fan series is created');
  assert.match(zones, /fanPlan\.draw\.indexOf/);
  assert.match(zones, /基于 ' \+ basisDate \+ ' 收盘/);
  assert.match(html, /id="fcStaleNote"/);
  assert.match(html, /scenarioBasisHtml\(a\) \+ scenarioBadgeHtml\(sc, refPx\)/);
  assert.match(html, /holdingHtml \+ '<\/span>' \+ scenarioBasisHtml\(a\)/);
  assert.match(html, /refreshForecastFanIfChanged\(\);\n    refreshScenarioLive\(\);/);
});

test('basis label reads the frozen baseline date and stays model-parameter free', () => {
  const ctx = vm.createContext({escapeHtml:s=>String(s)});
  vm.runInContext(extract('scenarioBasisDate') + extract('scenarioBasisHtml'), ctx);
  assert.equal(ctx.scenarioBasisHtml({forecast:{baseDate:'2026-10-21'}}), '<span class="sc-basis">基于 10-21 收盘</span>');
  assert.equal(ctx.scenarioBasisHtml({forecast:{}, publication:{baseline_date:'2026-10-20'}}), '<span class="sc-basis">基于 10-20 收盘</span>');
  assert.equal(ctx.scenarioBasisHtml({forecast:{}}), '');
  assert.doesNotMatch(ctx.scenarioBasisHtml({forecast:{baseDate:'2026-10-21'}}), /v3|v4|Brier|ATR|RSI|权重/);
});
