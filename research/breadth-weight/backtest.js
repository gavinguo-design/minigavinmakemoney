'use strict';

const HSI_WEIGHT_TYPE = 'hsi_free_float_adjusted_capped';
const HONG_KONG_OFFSET = '+08:00';
const REQUIRED_MEMBERSHIP_FIELDS = [
  'index_id', 'security_id', 'effective_from', 'effective_to', 'constituent_status',
  'source', 'source_updated_at', 'as_of',
];
const REQUIRED_WEIGHT_FIELDS = [
  'index_id', 'security_id', 'weight', 'effective_from', 'effective_to', 'weight_type',
  'source', 'source_updated_at', 'as_of',
];
const REQUIRED_PRICE_FIELDS = [
  'security_id', 'session_date', 'adjusted_close', 'previous_adjusted_close', 'close_status',
  'corporate_action_version', 'source', 'source_updated_at', 'as_of',
];
const REQUIRED_INDEX_CLOSE_FIELDS = [
  'index_id', 'session_date', 'close', 'previous_close', 'session_status',
  'source', 'source_updated_at', 'as_of',
];
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

function missingRequiredFields(row, fields) {
  return fields.filter((field) => row[field] === undefined || row[field] === null || row[field] === '');
}

function isIsoDate(value) {
  if (typeof value !== 'string') return false;
  const match = DATE_RE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isIsoTimestampWithTimezone(value) {
  return typeof value === 'string' && TIMESTAMP_RE.test(value) && Number.isFinite(Date.parse(value));
}

function sourceIsValidForSession(source, sourceUpdatedAt, asOf, sessionDate) {
  // Observation dates use the declared Hong Kong trading session; no freshness window is assumed.
  return typeof source === 'string' && source.trim() !== ''
    && asOf === sessionDate
    && isIsoTimestampWithTimezone(sourceUpdatedAt)
    && Date.parse(sourceUpdatedAt) >= Date.parse(`${sessionDate}T00:00:00${HONG_KONG_OFFSET}`);
}

function dateIsWithin(sessionDate, from, to) {
  return isIsoDate(sessionDate) && isIsoDate(from) && isIsoDate(to)
    && from <= sessionDate && sessionDate <= to;
}

function isPointInTimeMembership(row, indexId, sessionDate) {
  return missingRequiredFields(row, REQUIRED_MEMBERSHIP_FIELDS).length === 0
    && row.index_id === indexId
    && typeof row.security_id === 'string' && row.security_id !== ''
    && row.constituent_status === 'active'
    && dateIsWithin(sessionDate, row.effective_from, row.effective_to)
    && sourceIsValidForSession(row.source, row.source_updated_at, row.as_of, sessionDate);
}

function isPointInTimeWeight(row, indexId, sessionDate) {
  return missingRequiredFields(row, REQUIRED_WEIGHT_FIELDS).length === 0
    && row.index_id === indexId
    && typeof row.security_id === 'string' && row.security_id !== ''
    && Number.isFinite(row.weight) && row.weight > 0 && row.weight <= 1
    && row.weight_type === HSI_WEIGHT_TYPE
    && dateIsWithin(sessionDate, row.effective_from, row.effective_to)
    && sourceIsValidForSession(row.source, row.source_updated_at, row.as_of, sessionDate);
}

function isValidPrice(row, sessionDate) {
  return missingRequiredFields(row, REQUIRED_PRICE_FIELDS).length === 0
    && typeof row.security_id === 'string' && row.security_id !== ''
    && row.session_date === sessionDate && isIsoDate(row.session_date)
    && row.close_status === 'completed'
    && typeof row.corporate_action_version === 'string' && row.corporate_action_version !== ''
    && Number.isFinite(row.adjusted_close) && row.adjusted_close > 0
    && Number.isFinite(row.previous_adjusted_close) && row.previous_adjusted_close > 0
    && sourceIsValidForSession(row.source, row.source_updated_at, row.as_of, sessionDate);
}

function isValidIndexClose(row, indexId, sessionDate) {
  return row && missingRequiredFields(row, REQUIRED_INDEX_CLOSE_FIELDS).length === 0
    && row.index_id === indexId
    && row.session_date === sessionDate && isIsoDate(row.session_date)
    && row.session_status === 'completed'
    && Number.isFinite(row.close) && row.close > 0
    && Number.isFinite(row.previous_close) && row.previous_close > 0
    && sourceIsValidForSession(row.source, row.source_updated_at, row.as_of, sessionDate);
}

function unavailable(reason, details = {}) {
  return { status: 'missing', reason, ...details };
}

// Refuse partial/current-only constituent data before any breadth metric is calculated.
function calculateSession(input) {
  const { indexId, sessionDate, memberships, weights, prices, indexClose, roundingTolerance = 1e-6 } = input;
  if (typeof indexId !== 'string' || indexId === '' || !isIsoDate(sessionDate)
      || !Array.isArray(memberships) || !Array.isArray(weights) || !Array.isArray(prices)
      || !Number.isFinite(roundingTolerance) || roundingTolerance < 0) {
    return unavailable('invalid study session or input collections');
  }

  const active = memberships.filter((row) => isPointInTimeMembership(row, indexId, sessionDate));
  if (active.length === 0 || active.length !== memberships.length
      || new Set(active.map((row) => row.security_id)).size !== active.length) {
    return unavailable('membership contains non-point-in-time, inactive, or duplicate records');
  }

  const activeIds = new Set(active.map((row) => row.security_id));
  const sessionWeights = weights.filter((row) => isPointInTimeWeight(row, indexId, sessionDate));
  if (sessionWeights.length !== active.length || new Set(sessionWeights.map((row) => row.security_id)).size !== active.length
      || sessionWeights.some((row) => !activeIds.has(row.security_id))) {
    return unavailable('missing or non-point-in-time matching weights');
  }
  const coverage = sessionWeights.reduce((total, row) => total + row.weight, 0);
  if (Math.abs(coverage - 1) > roundingTolerance) return unavailable('weight coverage is not one', { coverage });

  if (!isValidIndexClose(indexClose, indexId, sessionDate)) {
    return unavailable('missing completed index close, source, or point-in-time provenance');
  }

  const priceById = new Map();
  for (const price of prices) {
    if (priceById.has(price.security_id)) return unavailable('duplicate constituent price record', { security_id: price.security_id });
    priceById.set(price.security_id, price);
  }
  if (priceById.size !== activeIds.size || [...priceById.keys()].some((id) => !activeIds.has(id))) {
    return unavailable('constituent prices do not exactly match active membership');
  }

  const validPrices = [];
  for (const securityId of activeIds) {
    const price = priceById.get(securityId);
    if (!isValidPrice(price, sessionDate)) {
      return unavailable('missing completed adjusted price or point-in-time provenance', { security_id: securityId });
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
    status: 'available', session_date: sessionDate,
    equal_name_breadth: advances / contributions.length,
    weighted_breadth: contributions.filter((row) => row.return > 0).reduce((total, row) => total + weightsById.get(row.security_id), 0),
    advances, unchanged, declines: contributions.length - advances - unchanged, weight_coverage: coverage,
    approximate_weighted_return_contributions: contributions,
    concentration_hhi: denominator ? contributions.reduce((total, row) => total + (Math.abs(row.approximate_weighted_return_contribution) / denominator) ** 2, 0) : null,
    top_five_absolute_contribution_share: denominator ? topFive.reduce((total, row) => total + Math.abs(row.approximate_weighted_return_contribution), 0) / denominator : null,
    error_flags: ['NOT_OFFICIAL_INDEX_POINT_ATTRIBUTION'],
  };
}

module.exports = { HSI_WEIGHT_TYPE, calculateSession, isIsoDate, isIsoTimestampWithTimezone, isPointInTimeMembership, isPointInTimeWeight };
