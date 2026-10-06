const assert = require('node:assert/strict');
const test = require('node:test');
const { calculateSession, HSI_WEIGHT_TYPE } = require('../research/breadth-weight/backtest');

const session = '2026-10-06';
const timestamp = '2026-10-06T16:10:00+08:00';
const manifestChecksum = 'a'.repeat(64);
const actionChecksum = 'b'.repeat(64);
function membership(securityId, extra = {}) {
  return { index_id: 'HSI', security_id: securityId, effective_from: '2026-10-01', effective_to: '9999-12-31', constituent_status: 'active', source: 'hsi-official-daily-report', source_updated_at: timestamp, as_of: session, ...extra };
}
function weight(securityId, value, extra = {}) {
  return { index_id: 'HSI', security_id: securityId, weight: value, effective_from: '2026-10-01', effective_to: '9999-12-31', weight_type: HSI_WEIGHT_TYPE, source: 'hsi-official-daily-report', source_updated_at: timestamp, as_of: session, ...extra };
}
function corporateActionManifest(extra = {}) {
  return {
    id: 'licensed-ca-manifest', version: '2026-10-06.1', sha256: manifestChecksum,
    source: 'licensed-survivorship-safe-feed', source_updated_at: timestamp, as_of: session,
    versions: [{ id: 'ca-v1', version: '2026-10-06.1', sha256: actionChecksum, source: 'licensed-survivorship-safe-feed', as_of: session }],
    ...extra,
  };
}
function price(securityId, close, previous, extra = {}) {
  return {
    security_id: securityId, session_date: session, adjusted_close: close, previous_adjusted_close: previous,
    close_status: 'completed', corporate_action_version: 'ca-v1', corporate_action_manifest_id: 'licensed-ca-manifest',
    corporate_action_manifest_version: '2026-10-06.1', corporate_action_manifest_sha256: manifestChecksum,
    corporate_action_sha256: actionChecksum, source: 'licensed-survivorship-safe-feed', source_updated_at: timestamp,
    as_of: session, ...extra,
  };
}
function indexClose(extra = {}) {
  return { index_id: 'HSI', session_date: session, close: 24280.56, previous_close: 24040.34, session_status: 'completed', source: 'hsi-official-daily-report', source_updated_at: timestamp, as_of: session, ...extra };
}
function reconciliation(extra = {}) {
  const close = indexClose();
  return {
    index_id: 'HSI', session_date: session, as_of: session, source: close.source, source_updated_at: timestamp,
    official_close: close.close, official_previous_close: close.previous_close,
    official_return: close.close / close.previous_close - 1,
    method_id: 'hsi_weighted_adjusted_return_proxy_v1', method_version: '1.0.0', tolerance: 0.0001,
    ...extra,
  };
}
function validPanel() {
  const panel = {
    indexId: 'HSI', sessionDate: session,
    memberships: [membership('A'), membership('B')],
    weights: [weight('A', 0.6), weight('B', 0.4)],
    prices: [price('A', 101, 100), price('B', 98, 100)],
    indexClose: indexClose(), corporateActionManifest: corporateActionManifest(),
  };
  const aggregate = 0.6 * 0.01 + 0.4 * -0.02;
  panel.reconciliation = reconciliation({ official_close: 24000 + aggregate * 24000, official_previous_close: 24000, official_return: aggregate });
  panel.indexClose.close = panel.reconciliation.official_close;
  panel.indexClose.previous_close = panel.reconciliation.official_previous_close;
  return panel;
}
function missingResult(panel) {
  const result = calculateSession(panel);
  assert.equal(result.status, 'missing');
  return result;
}

test('refuses current/non-point-in-time membership before calculation', () => {
  const panel = validPanel();
  delete panel.memberships[0].as_of;
  assert.match(missingResult(panel).reason, /membership/);
});

test('refuses unknown weights before calculation', () => {
  const panel = validPanel();
  panel.weights[0].weight = null;
  assert.match(missingResult(panel).reason, /weights/);
});

test('calculates descriptive breadth only for a complete point-in-time panel', () => {
  const result = calculateSession(validPanel());
  assert.equal(result.status, 'available');
  assert.equal(result.equal_name_breadth, 0.5);
  assert.equal(result.weighted_breadth, 0.6);
  assert.ok(Math.abs(result.approximate_weighted_return + 0.002) < 1e-12);
  assert.ok(Math.abs(result.approximate_weighted_return_contributions[0].approximate_weighted_return_contribution - 0.006) < 1e-12);
  assert.deepEqual(result.error_flags, ['NOT_OFFICIAL_INDEX_POINT_ATTRIBUTION', 'OFFICIAL_DIVISOR_CAPPING_RECONCILIATION_REQUIRED_FOR_BACKTEST_ADMISSION']);
  assert.equal(result.backtest_admission, 'blocked');
});

test('rejects malformed point-in-time dates and timestamps rather than comparing strings', () => {
  for (const mutation of [
    (panel) => { panel.memberships[0].as_of = '0'; },
    (panel) => { panel.memberships[0].effective_from = '2026-02-30'; },
    (panel) => { panel.weights[0].source_updated_at = 'not-a-date'; },
    (panel) => { panel.prices[0].source_updated_at = '2026-10-06T16:10:00'; },
    (panel) => { panel.indexClose.source_updated_at = '2099-01-01T00:00:00+08:00'; },
  ]) {
    const panel = validPanel();
    mutation(panel);
    missingResult(panel);
  }
});

test('rejects unsupported or inconsistent weight records', () => {
  for (const mutation of [
    (panel) => { panel.weights[0].weight_type = 'random'; },
    (panel) => { delete panel.weights[0].weight_type; },
    (panel) => { panel.weights[0].weight = 0; },
    (panel) => { panel.weights[1].security_id = 'A'; },
  ]) {
    const panel = validPanel();
    mutation(panel);
    assert.match(missingResult(panel).reason, /weights/);
  }
});

test('rejects a mixed-date panel and mismatched completed sessions', () => {
  for (const mutation of [
    (panel) => { panel.memberships[0].as_of = '1999-01-01'; },
    (panel) => { panel.indexClose.session_date = '1999-01-01'; panel.indexClose.as_of = '1999-01-01'; panel.indexClose.source_updated_at = '1999-01-01T16:10:00+08:00'; },
    (panel) => { panel.prices[0].session_date = '2026-10-05'; panel.prices[0].as_of = '2026-10-05'; panel.prices[0].source_updated_at = '2026-10-05T16:10:00+08:00'; },
  ]) {
    const panel = validPanel();
    mutation(panel);
    missingResult(panel);
  }
});

test('requires source and provenance for the index close and every constituent price', () => {
  for (const mutation of [
    (panel) => { delete panel.indexClose.source; },
    (panel) => { delete panel.indexClose.source_updated_at; },
    (panel) => { panel.indexClose.as_of = '2026-10-05'; },
    (panel) => { delete panel.prices[0].source; },
    (panel) => { delete panel.prices[0].source_updated_at; },
    (panel) => { panel.prices[0].source_updated_at = '2026-10-05T23:59:59+08:00'; },
  ]) {
    const panel = validPanel();
    mutation(panel);
    missingResult(panel);
  }
});

test('requires a controlled checksummed corporate-action manifest', () => {
  for (const mutation of [
    (panel) => { panel.prices[0].corporate_action_version = 'arbitrary'; },
    (panel) => { panel.prices[0].corporate_action_sha256 = 'f'.repeat(64); },
    (panel) => { panel.corporateActionManifest.sha256 = 'invalid'; },
    (panel) => { delete panel.corporateActionManifest; },
  ]) {
    const panel = validPanel();
    mutation(panel);
    assert.match(missingResult(panel).reason, /corporate-action/);
  }
});

test('requires a sourced, aligned reconciliation within the declared proxy tolerance', () => {
  for (const mutation of [
    (panel) => { delete panel.reconciliation; },
    (panel) => { panel.reconciliation.tolerance = 0.1; },
    (panel) => { panel.reconciliation.official_return = 0.01; },
    (panel) => { panel.reconciliation.source = 'different-source'; },
  ]) {
    const panel = validPanel();
    mutation(panel);
    assert.match(missingResult(panel).reason, /reconciliation/);
  }
});
