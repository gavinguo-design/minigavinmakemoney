'use strict';

const HSI_WEIGHT_TYPE = 'hsi_free_float_adjusted_capped';
const HONG_KONG_OFFSET = '+08:00';
const DAY_MS = 24 * 60 * 60 * 1000;
const SHA256_RE = /^[a-f0-9]{64}$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const RECONCILIATION_METHODS = Object.freeze({
  hsi_weighted_adjusted_return_proxy_v1: Object.freeze({ version: '1.0.0', max_tolerance: 0.0001 }),
});
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
  'corporate_action_version', 'corporate_action_manifest_id', 'corporate_action_manifest_version',
  'corporate_action_manifest_sha256', 'corporate_action_sha256', 'source', 'source_updated_at', 'as_of',
];
const REQUIRED_INDEX_CLOSE_FIELDS = [
  'index_id', 'session_date', 'close', 'previous_close', 'session_status',
  'source', 'source_updated_at', 'as_of',
];

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

function sessionWindow(sessionDate) {
  const start = Date.parse(`${sessionDate}T00:00:00${HONG_KONG_OFFSET}`);
  return { start, end: start + (2 * DAY_MS) };
}

function sourceIsValidForSession(source, sourceUpdatedAt, asOf, sessionDate) {
  if (typeof source !== 'string' || source.trim() === '' || asOf !== sessionDate || !isIsoTimestampWithTimezone(sourceUpdatedAt)) return false;
  const timestamp = Date.parse(sourceUpdatedAt);
  const { start, end } = sessionWindow(sessionDate);
  // A daily source may publish after close or correct on the following HKT date, but never later.
  return timestamp >= start && timestamp < end;
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

function isValidIndexClose(row, indexId, sessionDate) {
  return row && missingRequiredFields(row, REQUIRED_INDEX_CLOSE_FIELDS).length === 0
    && row.index_id === indexId
    && row.session_date === sessionDate && isIsoDate(row.session_date)
    && row.session_status === 'completed'
    && Number.isFinite(row.close) && row.close > 0
    && Number.isFinite(row.previous_close) && row.previous_close > 0
    && sourceIsValidForSession(row.source, row.source_updated_at, row.as_of, sessionDate);
}

function isValidCorporateActionManifest(manifest, sessionDate) {
  if (!manifest || typeof manifest !== 'object'
      || typeof manifest.id !== 'string' || manifest.id === ''
      || typeof manifest.version !== 'string' || manifest.version === ''
      || !SHA256_RE.test(manifest.sha256)
      || !sourceIsValidForSession(manifest.source, manifest.source_updated_at, manifest.as_of, sessionDate)
      || !Array.isArray(manifest.versions)) return false;
  const ids = new Set();
  return manifest.versions.every((entry) => {
    if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || entry.id === '' || ids.has(entry.id)) return false;
    ids.add(entry.id);
    return typeof entry.version === 'string' && entry.version !== '' && SHA256_RE.test(entry.sha256)
      && entry.as_of === sessionDate && entry.source === manifest.source;
  });
}

function priceMatchesCorporateActionManifest(price, manifest, sessionDate) {
  if (!isValidCorporateActionManifest(manifest, sessionDate)) return false;
  if (price.corporate_action_manifest_id !== manifest.id
      || price.corporate_action_manifest_version !== manifest.version
      || price.corporate_action_manifest_sha256 !== manifest.sha256) return false;
  const version = manifest.versions.find((entry) => entry.id === price.corporate_action_version);
  return Boolean(version) && price.corporate_action_sha256 === version.sha256
    && price.source === version.source && price.as_of === version.as_of;
}

function isValidPrice(row, sessionDate, corporateActionManifest) {
  return missingRequiredFields(row, REQUIRED_PRICE_FIELDS).length === 0
    && typeof row.security_id === 'string' && row.security_id !== ''
    && row.session_date === sessionDate && isIsoDate(row.session_date)
    && row.close_status === 'completed'
    && Number.isFinite(row.adjusted_close) && row.adjusted_close > 0
    && Number.isFinite(row.previous_adjusted_close) && row.previous_adjusted_close > 0
    && sourceIsValidForSession(row.source, row.source_updated_at, row.as_of, sessionDate)
    && priceMatchesCorporateActionManifest(row, corporateActionManifest, sessionDate);
}

function isValidReconciliation(reconciliation, indexClose, indexId, sessionDate, aggregateReturn) {
  if (!reconciliation || typeof reconciliation !== 'object') return false;
  const method = RECONCILIATION_METHODS[reconciliation.method_id];
  if (!method || reconciliation.method_version !== method.version
      || !Number.isFinite(reconciliation.tolerance) || reconciliation.tolerance < 0 || reconciliation.tolerance > method.max_tolerance
      || reconciliation.index_id !== indexId || reconciliation.session_date !== sessionDate || reconciliation.as_of !== sessionDate
      || !Number.isFinite(reconciliation.official_close) || reconciliation.official_close <= 0
      || !Number.isFinite(reconciliation.official_previous_close) || reconciliation.official_previous_close <= 0
      || !Number.isFinite(reconciliation.official_return)
      || !sourceIsValidForSession(reconciliation.source, reconciliation.source_updated_at, reconciliation.as_of, sessionDate)) return false;
  const officialReturn = reconciliation.official_close / reconciliation.official_previous_close - 1;
  return Math.abs(reconciliation.official_return - officialReturn) <= Number.EPSILON
    && reconciliation.official_close === indexClose.close
    && reconciliation.official_previous_close === indexClose.previous_close
    && reconciliation.source === indexClose.source
    && Math.abs(aggregateReturn - officialReturn) <= reconciliation.tolerance;
}

function unavailable(reason, details = {}) {
  return { status: 'missing', reason, ...details };
}

// Refuse partial/current-only constituent data before any breadth metric is calculated.
function calculateSession(input) {
  const {
    indexId, sessionDate, memberships, weights, prices, indexClose, corporateActionManifest,
    reconciliation, roundingTolerance = 1e-6,
  } = input;
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
  if (!isValidCorporateActionManifest(corporateActionManifest, sessionDate)) {
    return unavailable('missing or invalid controlled corporate-action manifest');
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
    if (!isValidPrice(price, sessionDate, corporateActionManifest)) {
      return unavailable('missing completed adjusted price or controlled corporate-action provenance', { security_id: securityId });
    }
    validPrices.push(price);
  }

  const weightsById = new Map(sessionWeights.map((row) => [row.security_id, row.weight]));
  const contributions = validPrices.map((price) => {
    const returnPct = price.adjusted_close / price.previous_adjusted_close - 1;
    return { security_id: price.security_id, return: returnPct, approximate_weighted_return_contribution: weightsById.get(price.security_id) * returnPct };
  });
  const aggregateReturn = contributions.reduce((total, row) => total + row.approximate_weighted_return_contribution, 0);
  if (!isValidReconciliation(reconciliation, indexClose, indexId, sessionDate, aggregateReturn)) {
    return unavailable('missing, invalid, or failed official index return reconciliation');
  }

  const advances = contributions.filter((row) => row.return > 0).length;
  const unchanged = contributions.filter((row) => row.return === 0).length;
  const denominator = contributions.reduce((total, row) => total + Math.abs(row.approximate_weighted_return_contribution), 0);
  const topFive = contributions.slice().sort((a, b) => Math.abs(b.approximate_weighted_return_contribution) - Math.abs(a.approximate_weighted_return_contribution)).slice(0, 5);

  return {
    status: 'available', session_date: sessionDate,
    equal_name_breadth: advances / contributions.length,
    weighted_breadth: contributions.filter((row) => row.return > 0).reduce((total, row) => total + weightsById.get(row.security_id), 0),
    advances, unchanged, declines: contributions.length - advances - unchanged, weight_coverage: coverage,
    approximate_weighted_return: aggregateReturn,
    approximate_weighted_return_contributions: contributions,
    concentration_hhi: denominator ? contributions.reduce((total, row) => total + (Math.abs(row.approximate_weighted_return_contribution) / denominator) ** 2, 0) : null,
    top_five_absolute_contribution_share: denominator ? topFive.reduce((total, row) => total + Math.abs(row.approximate_weighted_return_contribution), 0) / denominator : null,
    backtest_admission: 'blocked',
    error_flags: ['NOT_OFFICIAL_INDEX_POINT_ATTRIBUTION', 'OFFICIAL_DIVISOR_CAPPING_RECONCILIATION_REQUIRED_FOR_BACKTEST_ADMISSION'],
  };
}

module.exports = {
  HSI_WEIGHT_TYPE, RECONCILIATION_METHODS, calculateSession, isIsoDate, isIsoTimestampWithTimezone,
  isPointInTimeMembership, isPointInTimeWeight,
};
