#!/usr/bin/env node
/* Validates the research registry without external packages. */
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const production = args.includes('--production');
const registryPath = args.find((arg) => arg !== '--production') || path.join(root, 'research/governance/registry.json');
let failures = 0;
function fail(where, message) { failures++; console.error(`FAIL ${where}: ${message}`); }
function isIso(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
function resultComplete(result) {
  return result && result.status === 'pass' && Number.isInteger(result.sample_size) && result.sample_size > 0 &&
    ['win_rate', 'average_rr', 'expectancy', 'max_drawdown'].every((k) => typeof result[k] === 'number');
}
function requiredString(value) { return typeof value === 'string' && value.trim().length > 0; }

let registry;
try { registry = JSON.parse(fs.readFileSync(registryPath, 'utf8')); } catch (error) {
  console.error(`FAIL registry: ${error.message}`); process.exit(1);
}
if (registry.registry_version !== '1.0.0') fail('registry', 'unsupported registry_version');
if (!Array.isArray(registry.rules) || registry.rules.length === 0) fail('registry', 'rules must be a non-empty array');
const ids = new Set();
for (const [index, rule] of (registry.rules || []).entries()) {
  const where = `rules[${index}]`;
  if (!/^HSI-R-[A-Z0-9-]+-v[0-9]+$/.test(rule.rule_id || '')) fail(where, 'invalid rule_id');
  if (ids.has(rule.rule_id)) fail(where, 'duplicate rule_id'); ids.add(rule.rule_id);
  if (rule.schema_version !== '1.0.0') fail(where, 'unsupported schema_version');
  if (rule.research_only !== true) fail(where, 'research_only must be true');
  if (!['draft','data_pending','backtest_pending','holdout_pending','rejected','research_complete'].includes(rule.lifecycle)) fail(where, 'invalid lifecycle');
  if (!['breadth_weight','futures_basis','liquidity','options_volatility','event_calendar'].includes(rule.module)) fail(where, 'invalid module');
  if (!['premarket','intraday','postmarket','no-trade'].includes(rule.placement)) fail(where, 'invalid placement');
  for (const key of ['hypothesis','missing_data_handling','conflict_priority']) if (!requiredString(rule[key])) fail(where, `${key} required`);
  if (!Array.isArray(rule.source_inputs) || !rule.source_inputs.length) fail(where, 'source_inputs required');
  for (const [sourceIndex, input] of (rule.source_inputs || []).entries()) {
    const sourceWhere = `${where}.source_inputs[${sourceIndex}]`;
    if (!requiredString(input.name) || !requiredString(input.source)) fail(sourceWhere, 'name and source required');
    if (!['available','stale','missing'].includes(input.status)) fail(sourceWhere, 'invalid status');
    for (const timeKey of ['source_updated_at','as_of']) if (input[timeKey] !== null && !isIso(input[timeKey])) fail(sourceWhere, `${timeKey} must be ISO datetime or null`);
  }
  if (!rule.data_status || !['available','stale','missing'].includes(rule.data_status.status)) fail(where, 'data_status required');
  for (const timeKey of ['source_updated_at','as_of']) if (rule.data_status && rule.data_status[timeKey] !== null && !isIso(rule.data_status[timeKey])) fail(where, `data_status.${timeKey} invalid`);
  if (!rule.regimes || !Array.isArray(rule.regimes.applicable) || !Array.isArray(rule.regimes.disabled)) fail(where, 'regimes must contain applicable and disabled arrays');
  for (const key of ['trigger','confirmation','invalidation','exit']) if (!rule.definitions || !requiredString(rule.definitions[key])) fail(where, `definitions.${key} required`);
  for (const key of ['interval','sample_definition','cost_model','slippage_model','walk_forward','holdout']) if (!rule.backtest || !requiredString(rule.backtest[key])) fail(where, `backtest.${key} required`);
  for (const split of ['is','oos','holdout']) {
    const result = rule.evidence && rule.evidence[split];
    if (!result || !['not_run','pass','fail'].includes(result.status)) fail(where, `evidence.${split}.status invalid`);
    if (result && result.status === 'pass' && !resultComplete(result)) fail(where, `evidence.${split} pass needs all metrics`);
  }
  if (!rule.provenance || !isIso(rule.provenance.created_at) || !isIso(rule.provenance.last_updated_at) || !requiredString(rule.provenance.owner) || !Array.isArray(rule.provenance.change_log) || !rule.provenance.change_log.length) fail(where, 'incomplete provenance');
  if (production) {
    if (rule.research_only !== false) fail(where, 'research-only card is forbidden in production admission');
    if (rule.lifecycle !== 'research_complete') fail(where, 'lifecycle must be research_complete');
    if (rule.data_status.status !== 'available') fail(where, 'data_status must be available');
    for (const input of rule.source_inputs || []) if (input.status !== 'available' || !isIso(input.source_updated_at) || !isIso(input.as_of)) fail(where, 'all source inputs must be available and timestamped');
    for (const split of ['is','oos','holdout']) if (!resultComplete(rule.evidence && rule.evidence[split])) fail(where, `evidence.${split} lacks required passing metrics`);
  }
}
if (failures) process.exit(1);
console.log(`OK ${registryPath}: ${registry.rules.length} research-only rule cards validated${production ? ' for production admission' : ''}.`);
