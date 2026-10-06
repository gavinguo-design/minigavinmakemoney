#!/usr/bin/env node
/* Generate an auditable daily price-action snapshot from the frozen OHLCV file. */
const fs = require('node:fs');
const path = require('node:path');
const CandlePatterns = require('../patterns.js');

const root = path.resolve(__dirname, '..');
const annotationsPath = path.join(root, 'annotations.json');
const statusPath = path.join(root, 'scenario_status.json');
const candlesPath = path.join(root, 'kline_futu.json');
const annotations = JSON.parse(fs.readFileSync(annotationsPath, 'utf8'));
const status = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
const feed = JSON.parse(fs.readFileSync(candlesPath, 'utf8'));
const bars = (feed.candles || []).map(c => ({
  time: c.date, open: c.open, high: c.high, low: c.low, close: c.close
}));
if (!bars.length) throw new Error('No OHLCV candles available');
const last = bars.at(-1);
const hits = CandlePatterns.detect(bars, { intraday: false });
const hit = hits.find(item => item.index === bars.length - 1) || null;
const analysisId = annotations.meta.analysis_id || 'HSI-' + last.time.replaceAll('-', '') + '-price-action-v1';
annotations.meta.analysis_id = analysisId;
const observed = hit ? {
  id: hit.id, name: hit.name, direction: hit.direction, strength: hit.strength,
  explanation: hit.explain, basis: hit.note
} : {
  id: 'no_valid_pattern', name: '无有效形态证据', direction: 'neutral', strength: 'none',
  explanation: '最新完整日K未识别出符合规则的强蜡烛图形态；普通K线不被强行解释为信号。',
  basis: 'CandlePatterns.detect returned no eligible pattern for the latest completed daily bar.'
};
const ids = ['A', 'B', 'C'];
const scenarios = annotations.forecast.scenarios || [];
const perScenario = {};
scenarios.forEach((sc, index) => {
  const id = sc.id || ids[index] || String(index + 1);
  const direction = sc.direction || (sc.rr && sc.rr.direction) || 'neutral';
  sc.id = id;
  sc.direction = direction;
  sc.risk = sc.risk || {};
  sc.risk.structural_invalidation = sc.risk.structural_invalidation || {
    price: sc.rr && Number.isFinite(sc.rr.stop) ? sc.rr.stop : null,
    confirmation: 'completed_daily_close',
    note: sc.invalidation || '未提供结构失效条件'
  };
  sc.risk.disaster_stop = sc.risk.disaster_stop || {
    price: null,
    status: 'not_configured',
    note: '未配置独立灾难止损；不得将结构失效自动称为灾难止损。'
  };
  const aligns = observed.direction === direction && observed.direction !== 'neutral';
  perScenario[id] = {
    scenario_id: id,
    scenario_direction: direction,
    state: 'observed',
    direction_alignment: aligns ? 'aligned' : (observed.direction === 'neutral' ? 'no_directional_evidence' : 'conflicts'),
    observation: observed,
    confirmation: sc.trigger || '未提供确认条件',
    structural_invalidation: sc.risk.structural_invalidation,
    disaster_stop: sc.risk.disaster_stop
  };
});
annotations.forecast.scenario_evidence = {
  schema_version: '1.0', analysis_id: analysisId,
  generated_at: feed.updated_at || annotations.meta.updatedAt,
  timeframe: '1d', source: feed.source || 'unknown',
  last_bar: { date: last.time, open: last.open, high: last.high, low: last.low, close: last.close, completed: true },
  observation: observed, scenarios: perScenario
};
const note = ' forecast.scenario_evidence=由冻结OHLCV生成的逐情景价格行为证据契约；risk.structural_invalidation与risk.disaster_stop语义独立。';
annotations.$schema_note = annotations.$schema_note.split(note).join('') + note;
status.analysis_id = analysisId;
status.evidence_ref = {
  analysis_id: analysisId, schema_version: '1.0', timeframe: '1d', last_bar_date: last.time,
  generated_at: annotations.forecast.scenario_evidence.generated_at
};
(status.scenarios || []).forEach(item => {
  const id = item.id || item.name_prefix;
  item.id = id;
  item.evidence_ref = { scenario_id: id, state: perScenario[id] ? perScenario[id].state : 'unavailable' };
});
fs.writeFileSync(annotationsPath, JSON.stringify(annotations, null, 2) + '\n');
fs.writeFileSync(statusPath, JSON.stringify(status, null, 2) + '\n');
console.log(JSON.stringify({ analysis_id: analysisId, last_bar: last.time, pattern: observed.id }, null, 2));
