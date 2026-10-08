const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Participation = require('../investment/chart/market-participation.js');
const snapshot = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/hsi-participation-2026-10-06.json'), 'utf8'));
const annotations = JSON.parse(fs.readFileSync(path.join(__dirname, '../investment/chart/annotations.json'), 'utf8'));

test('official HSI snapshot has complete breadth, weight and contribution coverage', () => {
  const check = Participation.validate(snapshot, '2026-10-06');
  assert.equal(check.ok, true);
  assert.equal(snapshot.data_quality.constituent_count, 95);
  assert.equal(snapshot.metrics.advances + snapshot.metrics.declines + snapshot.metrics.unchanged, 95);
  assert.ok(Math.abs(snapshot.data_quality.weight_coverage - 1) <= snapshot.data_quality.weight_rounding_tolerance);
  assert.ok(Math.abs(snapshot.data_quality.reconciliation_difference) <= 0.02);
});

test('broad positive participation raises long A and reduces short B/C without changing triggers', () => {
  const scenarios = annotations.forecast.scenarios;
  const result = Participation.evaluate(snapshot, scenarios, '2026-10-06');
  assert.equal(result.status, 'available');
  assert.equal(result.evidence.label, '广泛偏多');
  assert.ok(result.weights.A > result.base_weights.A);
  assert.ok(result.weights.B < result.base_weights.B);
  assert.ok(result.weights.C < result.base_weights.C);
  assert.ok(Math.abs(Object.values(result.weights).reduce((a,b) => a+b, 0) - 1) < 1e-12);
});

test('date mismatch, incomplete coverage and failed reconciliation all fail closed', () => {
  const scenarios = annotations.forecast.scenarios;
  assert.equal(Participation.evaluate(snapshot, scenarios, '2026-10-07').status, 'unavailable');
  const incomplete = JSON.parse(JSON.stringify(snapshot));
  incomplete.data_quality.quote_coverage = 0.90;
  assert.equal(Participation.evaluate(incomplete, scenarios, '2026-10-06').status, 'unavailable');
  const unreconciled = JSON.parse(JSON.stringify(snapshot));
  unreconciled.data_quality.reconciled = false;
  assert.equal(Participation.evaluate(unreconciled, scenarios, '2026-10-06').status, 'unavailable');
});

test('chart visibly distinguishes base weight from participation-adjusted weight', () => {
  const html = fs.readFileSync(path.join(__dirname, '../investment/chart/index.html'), 'utf8');
  assert.match(html, /恒指宽度 · 权重 · 点数贡献/);
  assert.match(html, /MarketParticipation\.evaluate/);
  assert.match(html, /参与度校正权重；基础权重/);
  assert.match(html, /\/api\/hsi-participation/);
});

test('live participation endpoint requires quote coverage and index reconciliation', () => {
  const source = fs.readFileSync(path.join(__dirname, '../functions/api/hsi-participation.js'), 'utf8');
  assert.match(source, /quoteCoverage >= 0\.95/);
  assert.match(source, /reconciled && baselineFresh \? 'available' : 'unavailable'/);
  assert.match(source, /baselineAgeDays >= 0 && baselineAgeDays <= 4/);
  assert.match(source, /approximate_point_contribution/);
});
