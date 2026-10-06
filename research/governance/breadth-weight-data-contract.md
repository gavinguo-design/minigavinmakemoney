# HSI Breadth And Weight Contribution Data Contract

Status: research-only; no inputs are connected and no result is a signal.

## Point-in-time input tables

All records use `Asia/Hong_Kong` timestamps. `as_of` is the market observation time; `source_updated_at` is the source's own update time, not a retrieval time.

| Table | Grain | Required fields |
| --- | --- | --- |
| `constituent_universe` | constituent, effective interval | `index_id`, `security_id`, `effective_from`, `effective_to`, `constituent_status`, `source`, `source_updated_at`, `as_of` |
| `constituent_weights` | constituent, effective interval | `index_id`, `security_id`, `weight`, `effective_from`, `effective_to`, `weight_type`, `source`, `source_updated_at`, `as_of` |
| `constituent_prices` | constituent, completed session | `security_id`, `session_date`, `adjusted_close`, `previous_adjusted_close`, `close_status`, `corporate_action_version`, `source`, `source_updated_at`, `as_of` |
| `index_close` | index, completed session | `index_id`, `session_date`, `close`, `previous_close`, `session_status`, `source`, `source_updated_at`, `as_of` |
| `corporate_actions` | security, effective interval | `security_id`, `action_type`, `ex_date`, `adjustment_factor`, `source`, `source_updated_at`, `as_of` |

Keys must be stable across ticker changes. A session is usable only where every active constituent has a point-in-time membership record, matching effective weight, valid adjusted prices, and a completed index close. Do not silently drop missing names.

## Calculations (descriptive, not predictive)

For each usable completed session `t` and active universe `U_t`:

- Constituent return: `r_i,t = adjusted_close_i,t / previous_adjusted_close_i,t - 1`.
- Index return: `r_index,t = index_close_t / previous_index_close_t - 1`.
- Weight coverage: `C_t = sum(weight_i,t for i with valid inputs)`. Require `C_t = 1` within a preregistered rounding tolerance; otherwise status is `missing`.
- Equal-name breadth: `B_eq,t = count(r_i,t > 0) / count(U_t)`; report unchanged and down counts separately. This is a descriptive participation statistic.
- Weighted breadth: `B_w,t = sum(weight_i,t * 1[r_i,t > 0])`.
- Approximate weighted return contribution: `c_i,t = weight_i,t * r_i,t`. This is not official index-point attribution unless divisor/capping methodology validates it.
- Concentration: `H_t = sum((c_i,t / sum(abs(c_j,t)))^2)` when denominator is positive. Also report top-5 absolute contribution share: `sum(top5 abs(c_i,t)) / sum(abs(c_j,t))`.
- Optional official point contribution: only compute after obtaining a versioned official divisor/capping methodology. Preserve the formula/version used and do not label `c_i,t` as index points.

All thresholds, z-score lookbacks, horizons, and any relation to next-session outcomes must be preregistered before the test dataset is examined. Current registry intentionally leaves them unset.

## Required official/vendor resolution

1. Hang Seng Indexes point-in-time constituent history, effective dates, free-float adjusted weights, capping/rebalance records, and methodology/divisor history.
2. A survivorship-bias-free constituent price history with corporate-action treatment; verify delistings, suspensions, ticker changes, and rights issues.
3. Official HSI close/session status and a reconciliation policy against the constituent panel.
4. Licensing and redistribution approval before writing any raw vendor data into this public repository. Prefer external secured storage plus immutable dataset manifests/checksums.

## Validation and failure states

- `available`: all required records are present, internally consistent, current for the intended completed session, and reconciliation checks pass.
- `stale`: records exist but source timestamps exceed the preregistered freshness limit. No carry-forward.
- `missing`: any required record, corporate-action mapping, history effective date, coverage, or reconciliation field is absent. Emit no metric.

A rebalance-effective day is `missing` until the exact effective constituent and weight files are verified. A suspension is not a zero return. Half-day and special-session treatment requires a separate preregistered test before inclusion.
