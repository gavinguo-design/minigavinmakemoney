const assert = require('node:assert/strict');
const test = require('node:test');
const { calculateSession } = require('../research/breadth-weight/backtest');

const session = '2026-10-06';
function membership(securityId, extra = {}) {
  return { index_id: 'HSI', security_id: securityId, effective_from: '2026-10-01', effective_to: '9999-12-31', constituent_status: 'active', source: 'official', source_updated_at: session, as_of: session, ...extra };
}
function weight(securityId, value, extra = {}) {
  return { index_id: 'HSI', security_id: securityId, weight: value, effective_from: '2026-10-01', effective_to: '9999-12-31', weight_type: 'free_float_capped', source: 'official', source_updated_at: session, as_of: session, ...extra };
}
function price(securityId, close, previous) {
  return { security_id: securityId, session_date: session, adjusted_close: close, previous_adjusted_close: previous, close_status: 'completed', corporate_action_version: 'v1', source: 'licensed', source_updated_at: session, as_of: session };
}
function validPanel() {
  return {
    indexId: 'HSI', sessionDate: session,
    memberships: [membership('A'), membership('B')],
    weights: [weight('A', 0.6), weight('B', 0.4)],
    prices: [price('A', 101, 100), price('B', 98, 100)],
    indexClose: { session_date: session, close: 24280.56, previous_close: 24040.34, session_status: 'completed' },
  };
}

test('refuses current/non-point-in-time membership before calculation', () => {
  const panel = validPanel();
  delete panel.memberships[0].as_of;
  const result = calculateSession(panel);
  assert.equal(result.status, 'missing');
  assert.match(result.reason, /membership/);
});

test('refuses unknown weights before calculation', () => {
  const panel = validPanel();
  panel.weights[0].weight = null;
  const result = calculateSession(panel);
  assert.equal(result.status, 'missing');
  assert.match(result.reason, /weights/);
});

test('calculates descriptive breadth only for a complete point-in-time panel', () => {
  const result = calculateSession(validPanel());
  assert.equal(result.status, 'available');
  assert.equal(result.equal_name_breadth, 0.5);
  assert.equal(result.weighted_breadth, 0.6);
  assert.ok(Math.abs(result.approximate_weighted_return_contributions[0].approximate_weighted_return_contribution - 0.006) < 1e-12);
  assert.deepEqual(result.error_flags, ['NOT_OFFICIAL_INDEX_POINT_ATTRIBUTION']);
});
