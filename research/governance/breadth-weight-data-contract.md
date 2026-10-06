# HSI Breadth And Weight Contribution Data Contract

Status: research-only; no inputs are connected and no result is a signal.

## Point-in-time input tables

All records use `Asia/Hong_Kong` timestamps. `as_of` is the market observation session date; `source_updated_at` is the source's own update time, not a retrieval time.

| Table | Grain | Required fields |
| --- | --- | --- |
| `constituent_universe` | constituent, effective interval | `index_id`, `security_id`, `effective_from`, `effective_to`, `constituent_status`, `source`, `source_updated_at`, `as_of` |
| `constituent_weights` | constituent, effective interval | `index_id`, `security_id`, `weight`, `effective_from`, `effective_to`, `weight_type`, `source`, `source_updated_at`, `as_of` |
| `constituent_prices` | constituent, completed session | `security_id`, `session_date`, `adjusted_close`, `previous_adjusted_close`, `close_status`, `corporate_action_version`, `corporate_action_manifest_id`, `corporate_action_manifest_version`, `corporate_action_manifest_sha256`, `corporate_action_sha256`, `source`, `source_updated_at`, `as_of` |
| `index_close` | index, completed session | `index_id`, `session_date`, `close`, `previous_close`, `session_status`, `source`, `source_updated_at`, `as_of` |
| `corporate_actions` | security, effective interval | `security_id`, `action_type`, `ex_date`, `adjustment_factor`, `source`, `source_updated_at`, `as_of` |

Keys must be stable across ticker changes. A session is usable only where every active constituent has a point-in-time membership record, matching effective weight, valid adjusted prices, and a completed index close. Do not silently drop missing names.

## Strict completed-session provenance rules

The calculation gate accepts only one declared study session. `session_date`, every `as_of`, `effective_from`, and `effective_to` value must be a real ISO calendar date in `YYYY-MM-DD` form. `source_updated_at` must be a valid ISO-8601 timestamp with an explicit `Z` or numeric timezone offset. A source identifier must be a nonempty string.

For a completed session `t`, every membership, weight, constituent-price, and index-close record must declare `as_of = t`; price and index-close `session_date` must equal `t`; and membership/weight effective intervals must contain `t`. A daily record's `source_updated_at` must fall in `[t 00:00:00+08:00, t+2 days 00:00:00+08:00)`: this permits a source's normal next-Hong-Kong-day correction cycle, but rejects timestamps before the claimed observation or from any later day. This is a provenance window, not an invented seconds-level freshness SLA. The input collection must contain exactly one membership, weight, and price record for each active security, and the index close must have the requested `index_id` and `session_date`.

The only accepted `weight_type` is `hsi_free_float_adjusted_capped`, meaning the source explicitly identifies the weights as HSI free-float-adjusted and capped weights. Weights must be finite and in `(0, 1]`, be one-to-one with active constituents, and sum to one within the declared rounding tolerance. Other labels (including generic `free_float_capped`) are rejected because they do not identify the required HSI-specific methodology.

`corporate_action_version` is not trusted as a free string. The input must include a controlled corporate-action manifest with nonempty `id` and `version`, a SHA-256 `sha256`, source, source timestamp, and `as_of = t`, plus one unique version entry per ID. Each entry must carry `id`, `version`, SHA-256, identical source, and `as_of = t`. Every price must bind exactly to the manifest ID/version/checksum and to a listed action-version ID/checksum. The manifest is an externally controlled, checksummed artifact; this in-memory gate validates its declared identity and bindings, not the artifact's bytes.

## Calculations (descriptive, not predictive)

For each usable completed session `t` and active universe `U_t`:

- Constituent return: `r_i,t = adjusted_close_i,t / previous_adjusted_close_i,t - 1`.
- Index return: `r_index,t = index_close_t / previous_index_close_t - 1`.
- Weight coverage: `C_t = sum(weight_i,t for i with valid inputs)`. Require `C_t = 1` within a preregistered rounding tolerance; otherwise status is `missing`.
- Equal-name breadth: `B_eq,t = count(r_i,t > 0) / count(U_t)`; report unchanged and down counts separately. This is a descriptive participation statistic.
- Weighted breadth: `B_w,t = sum(weight_i,t * 1[r_i,t > 0])`.
- Approximate weighted return contribution: `c_i,t = weight_i,t * r_i,t`. This is not official index-point attribution unless divisor/capping methodology validates it.
- Concentration: `H_t = sum((c_i,t / sum(abs(c_j,t)))^2)` when denominator is positive. Also report top-5 absolute contribution share: `sum(top5 abs(c_i,t)) / sum(abs(c_j,t))`.
- Required aggregate reconciliation: input must include a sourced, session-aligned `index_reconciliation` record containing official close, prior close, return, source, source timestamp, `as_of`, a method ID/version, and a tolerance. The gate currently accepts only `hsi_weighted_adjusted_return_proxy_v1@1.0.0`, with tolerance at most `0.0001`; it checks the declared official return against official closes, requires those closes/source to equal `index_close`, and checks `abs(sum(c_i,t) - official_return) <= tolerance`.
- The proxy reconciliation validates only the aggregate adjusted-return approximation. It cannot validate official HSI points, divisor changes, intraday capping, free-float changes, or corporate-action treatment beyond the controlled manifest. Therefore it must not be represented as official point attribution or a valid backtest admission. Official point reconciliation may be added only after a versioned official divisor/capping methodology and its own contract are supplied.

All thresholds, z-score lookbacks, horizons, and any relation to next-session outcomes must be preregistered before the test dataset is examined. Current registry intentionally leaves them unset.

## Required official/vendor resolution

1. Hang Seng Indexes point-in-time constituent history, effective dates, free-float adjusted weights, capping/rebalance records, and methodology/divisor history.
2. A survivorship-bias-free constituent price history with corporate-action treatment; verify delistings, suspensions, ticker changes, and rights issues.
3. Official HSI close/session status and a reconciliation policy against the constituent panel.
4. Licensing and redistribution approval before writing any raw vendor data into this public repository. Prefer external secured storage plus immutable dataset manifests/checksums.

## Validation and failure states

- `available`: all required records are present, internally consistent, and satisfy the strict completed-session provenance rules, controlled corporate-action binding, and aggregate proxy-reconciliation checks. It remains research-only and has `backtest_admission: blocked` until official divisor/capping point reconciliation is separately implemented.
- `stale`: records exist but source timestamps exceed a separately preregistered freshness limit. No carry-forward. The calculation gate does not infer a freshness SLA.
- `missing`: any required record, malformed date/timestamp, source/provenance field, corporate-action mapping, history effective date, coverage, or reconciliation field is absent or invalid. Emit no metric.

A rebalance-effective day is `missing` until the exact effective constituent and weight files are verified. A suspension is not a zero return. Half-day and special-session treatment requires a separate preregistered test before inclusion.
