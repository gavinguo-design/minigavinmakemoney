'use strict';

const REQUIRED_MEMBERSHIP_FIELDS = [
  'index_id',
  'security_id',
  'effective_from',
  'effective_to',
  'constituent_status',
  'source',
  'source_updated_at',
  'as_of',
];
const REQUIRED_WEIGHT_FIELDS = [
  'index_id',
  'security_id',
  'weight',
  'effective_from',
  'effective_to',
  'weight_type',
  'source',
  'source_updated_at',
  'as_of',
];

function missingRequiredFields(row, fields) {
  return fields.filter((field) => row[field] === undefined || row[field] === null || row[field] === '');
}

function dateIsWithin(sessionDate, from, to) {
  return from <= sessionDate && (!to || sessionDate <= to);
}

function isPointInTimeMembership(row, indexId, sessionDate) {
  return missingRequiredFields(row, REQUIRED_MEMBERSHIP_FIELDS).length === 0
    && row.index_id === indexId
    && row.constituent_status === 'active'
    && dateIsWithin(sessionDate, row.effective_from, row.effective_to)
    && row.as_of <= sessionDate;
}

function isPointInTimeWeight(row, indexId, sessionDate) {
  return missingRequiredFields(row, REQUIRED_WEIGHT_FIELDS).length === 0
    && row.index_id === indexId
    && Number.isFinite(row.weight)
    && row.weight >= 0
    && dateIsWithin(sessionDate, row.effective_from, row.effective_to)
    && row.as_of <= sessionDate;
}

function unavailable(reason, details = {}) {
  return { status: 'missing', reason, ...details };
}

// Refuse partial/current-only constituent data before any breadth metric is calculated.
function calculateSession(input) {
  const { indexId, sessionDate, memberships, weights, prices, indexClose, roundingTolerance = 1e-6 } = input;
  const active = memberships.filter((row) => isPointInTimeMembership(row, indexId, sessionDate));
  if (active.length === 0) return unavailable('no point-in-time active membership for session');
  if (active.length !== memberships.length) return unavailable('membership contains non-point-in-time or inactive records');

  const activeIds = new Set(active.map((row) => row.security_id));
  const sessionWeights = weights.filter((row) => isPointInTimeWeight(row, indexId, sessionDate));
  if (sessionWeights.length !== active.length || new Set(sessionWeights.map((row) => row.security_id)).size !== active.length
      || sessionWeights.some((row) => !activeIds.has(row.security_id))) {
    return unavailable('missing or non-point-in-time matching weights');
  }
  const coverage = sessionWeights.reduce((total, row) => total + row.weight, 0);
  if (Math.abs(coverage - 1) > roundingTolerance) return unavailable('weight coverage is not one', { coverage });

  if (!indexClose || indexClose.session_status !== 'completed' || !Number.isFinite(indexClose.close)
      || !Number.isFinite(indexClose.previous_close)) {
    return unavailable('missing completed index close');
  }
  const priceById = new Map(prices.map((row) => [row.security_id, row]));
  const validPrices = [];
  for (const securityId of activeIds) {
    const price = priceById.get(securityId);
    if (!price || price.session_date !== sessionDate || price.close_status !== 'completed'
        || !price.corporate_action_version || !Number.isFinite(price.adjusted_close)
        || !Number.isFinite(price.previous_adjusted_close)) {
      return unavailable('missing completed adjusted price or corporate-action version', { security_id: securityId });
    }
    validPrices.push(price);
  }

  const weightsById = new Map(sessionWeights.map((row) => [row.security_id, row.weight]));
  const contributions = validPrices.map((price) => {
    const returnPct = price.adjusted_close / price.previous_adjusted_close - 1;
    return { security_id: price.security_id, return: returnPct, approximate_weighted_return_contribution: weightsById.get(price.security_id) * returnPct };
  });
  const advances = contributions.filter((row) => row.return > 0).length;
  const unchanged = contributions.filter((row) => row.return === 0).length;
  const denominator = contributions.reduce((total, row) => total + Math.abs(row.approximate_weighted_return_contribution), 0);
  const topFive = contributions.slice().sort((a, b) => Math.abs(b.approximate_weighted_return_contribution) - Math.abs(a.approximate_weighted_return_contribution)).slice(0, 5);

  return {
    status: 'available',
    session_date: sessionDate,
    equal_name_breadth: advances / contributions.length,
    weighted_breadth: contributions.filter((row) => row.return > 0).reduce((total, row) => total + weightsById.get(row.security_id), 0),
    advances,
    unchanged,
    declines: contributions.length - advances - unchanged,
    weight_coverage: coverage,
    approximate_weighted_return_contributions: contributions,
    concentration_hhi: denominator ? contributions.reduce((total, row) => total + (Math.abs(row.approximate_weighted_return_contribution) / denominator) ** 2, 0) : null,
    top_five_absolute_contribution_share: denominator ? topFive.reduce((total, row) => total + Math.abs(row.approximate_weighted_return_contribution), 0) / denominator : null,
    error_flags: ['NOT_OFFICIAL_INDEX_POINT_ATTRIBUTION'],
  };
}

module.exports = { calculateSession, isPointInTimeMembership, isPointInTimeWeight };
