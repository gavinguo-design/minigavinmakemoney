const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const validator = path.join(root, 'scripts/validate-research-registry.cjs');
const registryPath = path.join(root, 'research/governance/registry.json');
function run(file, production = false) {
  return spawnSync(process.execPath, [validator, file, ...(production ? ['--production'] : [])], { encoding: 'utf8' });
}
function copyRegistry() { return JSON.parse(fs.readFileSync(registryPath, 'utf8')); }
function tempRegistry(data) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hsi-registry-')), 'registry.json');
  fs.writeFileSync(file, JSON.stringify(data));
  return file;
}

test('research registry validates and contains the prioritized research-only roadmap', () => {
  const result = run(registryPath);
  assert.equal(result.status, 0, result.stderr);
  const ids = copyRegistry().rules.map((rule) => rule.module).sort();
  assert.deepEqual(ids, ['breadth_weight', 'event_calendar', 'futures_basis', 'liquidity', 'options_volatility']);
});

test('production admission rejects research-only cards with absent evidence', () => {
  const result = run(registryPath, true);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /research-only card is forbidden in production admission/);
  assert.match(result.stderr, /evidence\.is lacks required passing metrics/);
});

test('validator rejects a claimed pass when required metrics are missing', () => {
  const registry = copyRegistry();
  const card = registry.rules[0];
  card.evidence.is = { status: 'pass', sample_size: 10, win_rate: 0.5, average_rr: null, expectancy: null, max_drawdown: null };
  const result = run(tempRegistry(registry));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /evidence\.is pass needs all metrics/);
});

test('validator rejects source freshness status without required provenance when production is attempted', () => {
  const registry = copyRegistry();
  const card = registry.rules[0];
  card.research_only = false;
  card.lifecycle = 'research_complete';
  card.data_status = { status: 'available', as_of: '2026-10-06T16:10:00+08:00', source_updated_at: '2026-10-06T16:10:00+08:00' };
  card.source_inputs.forEach((input) => { input.status = 'available'; input.source_updated_at = null; input.as_of = null; });
  for (const split of ['is', 'oos', 'holdout']) card.evidence[split] = { status: 'pass', sample_size: 10, win_rate: 0.5, average_rr: 1, expectancy: 0.1, max_drawdown: -0.1 };
  const result = run(tempRegistry(registry), true);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /all source inputs must be available and timestamped/);
});
