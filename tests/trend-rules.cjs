const test = require('node:test'), assert = require('node:assert/strict');
const R = require('../investment/chart/trend/trend-rules.js');

test('classifyTrend: 四种状态', () => {
  assert.equal(R.classifyTrend(110, 105, 100, 90).state, 'up');
  assert.equal(R.classifyTrend(102, 105, 100, 90).state, 'pullback');   // 跌破MA20但在MA200上
  assert.equal(R.classifyTrend(95, 105, 100, 90).state, 'pullback');    // 跌破MA50仍在MA200上
  assert.equal(R.classifyTrend(80, 85, 90, 100).state, 'down');         // 空头排列
  assert.equal(R.classifyTrend(95, 92, 90, 100).state, 'range');        // 空头里反弹到MA50上方
  assert.equal(R.classifyTrend(105, 100, 98, 102).state, 'range');      // 价格在MA200上但MA50在下
  assert.equal(R.classifyTrend(100, null, 1, 1).state, 'unknown');
});

test('sma 与长度不足', () => {
  const s = R.sma([1, 2, 3, 4], 3);
  assert.deepEqual(s, [null, null, 2, 3]);
});

test('vixLevel 四档', () => {
  assert.equal(R.vixLevel(12).label, '低');
  assert.equal(R.vixLevel(17).label, '正常');
  assert.equal(R.vixLevel(25).label, '紧张');
  assert.equal(R.vixLevel(35).label, '恐慌');
});

test('港股空头：不抄底，只做反弹空；跌破月线前低顺势空', () => {
  const m = { price: 23000, ma20: 23800, ma50: 24500, ma200: 25000, low20: 22600 };
  const a = R.adviceHK({ state: 'down' }, m);
  assert.match(a.now, /不抄底/);
  assert.match(a.trigger, /24000/); // MA20+200 止损
  const b = R.adviceHK({ state: 'down' }, { ...m, price: 22400 });
  assert.match(b.now, /顺势轻仓空/);
  assert.ok(!/做多|抄底买/.test(a.now + b.now));
});

test('美股：200日线上方回调不追空，收复MA50做多，近200日线分批', () => {
  const m = { price: 690, ma20: 710, ma50: 700, ma200: 600 };
  const a = R.adviceUS({ state: 'pullback' }, m);
  assert.match(a.now, /不追空/); assert.match(a.trigger, /MA50/);
  const b = R.adviceUS({ state: 'pullback' }, { ...m, price: 610 });
  assert.match(b.now, /分批/);
});

test('关键位：恒指含月线前低，阻力在上支撑在下', () => {
  const lv = R.keyLevels(23000, { high20: 24000, low20: 22700, ma20: 23500, ma50: 24200, ma200: 25000, priorLow: 22518 });
  assert.equal(lv.resistance[0].v, 23500);
  assert.equal(lv.support[0].v, 22700);
  assert.equal(lv.support[1].name, '月线前低');
});

test('总判断文案', () => {
  assert.equal(R.summarize('down', R.combineUS('pullback', 'up')), '美股强、港股弱：港股只做反弹空，美股等回调结束做多');
  assert.equal(R.combineUS('up', 'down'), 'down');
});

test('analyze 端到端', () => {
  const bars = [];
  for (let i = 0; i < 260; i++) { const c = 100 + i * 0.5; bars.push({ t: i, o: c, h: c + 1, l: c - 1, c }); }
  const m = R.analyze(bars, { market: 'us' });
  assert.equal(m.trend.state, 'up');
  assert.ok(m.d200 > 0 && m.chg5 > 0);
  const hk = R.analyze(bars.map(b => ({ ...b, c: 30000 - b.c * 10, h: 30000 - b.c * 10 + 5, l: 30000 - b.c * 10 - 5 })), { market: 'hk' });
  assert.equal(hk.trend.state, 'down');
  assert.equal(hk.priorLow, 22518);
});

test('annotationLevels: 复用 annotations.json 的关键位', () => {
  const levels = [
    { price: 23737.14, type: 'support', label: '最近确认摆动低点' },
    { price: 24524.63, type: 'resistance', label: '最近确认摆动高点' },
    { price: 22518, type: 'support', label: '下方结构目标' },
    { price: 24934.06, type: 'resistance', label: '上方结构目标' }
  ];
  const lv = R.annotationLevels(23093.37, levels);
  assert.equal(lv.resistance[0].v, 23737.14);
  assert.equal(lv.support[0].v, 22518);
});

test('leadingScenario: 挑概率最高的情景', () => {
  const s = R.leadingScenario([{ id: 'A', probability: 0.1 }, { id: 'B', probability: 0.1 }, { id: 'C', probability: 0.8 }]);
  assert.equal(s.id, 'C');
  assert.equal(R.leadingScenario([]), null);
});

test('adviceHKFromAnnotations: 原文搬运触发/失效，不自己重新推导', () => {
  const a = R.adviceHKFromAnnotations({ name: 'C · 跌破最近摆动低点', direction: 'short', trigger: '收盘 < 23,737.14', invalidation: '收盘 ≥ 23,513.79' });
  assert.match(a.now, /偏空/);
  assert.equal(a.trigger, '收盘 < 23,737.14');
  assert.equal(a.invalid, '收盘 ≥ 23,513.79');
  assert.equal(R.adviceHKFromAnnotations(null), null);
});

test('analyze: 恒指传 annotationLevels+scenario 时优先复用，不自计关键位', () => {
  const bars = [];
  for (let i = 0; i < 260; i++) { const c = 30000 - i * 5; bars.push({ t: i, o: c, h: c + 5, l: c - 5, c }); }
  const levels = [{ price: bars[bars.length - 1].c - 500, type: 'support', label: '测试支撑' }, { price: bars[bars.length - 1].c + 500, type: 'resistance', label: '测试阻力' }];
  const scenario = { name: 'C · 测试', direction: 'short', trigger: 'T', invalidation: 'I' };
  const m = R.analyze(bars, { market: 'hk', annotationLevels: levels, scenario: scenario });
  assert.equal(m.levels.support[0].name, '测试支撑');
  assert.equal(m.advice.trigger, 'T');
});

test('cleanBars 剔除空值', () => {
  const b = R.cleanBars({ timestamp: [1, 2], open: [1, null], high: [2, 2], low: [0, 0], close: [1, 1] });
  assert.equal(b.length, 1);
});
