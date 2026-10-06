# Blocked HSI Breadth / Weight Backtest Specification

Status: **blocked pending data license and point-in-time dataset validation.** This document does not select a profitable rule, set thresholds, or authorize trading.

## Minimum Viable Dataset

Use `Asia/Hong_Kong` and completed cash-session dates. Store the raw data in secured, access-controlled storage; commit only manifests/checksums/aggregate outputs where licensing permits.

| Table | Required grain and fields | Minimum history / quality |
| --- | --- | --- |
| `constituent_universe` | HSI, stable security ID, effective-from/to, active status, source, source update, as-of timestamp | Every historical effective interval, including entrants, exits, delistings, ticker changes, and rebalance-effective days; no current-universe substitution |
| `constituent_weights` | HSI, stable security ID, weight, effective-from/to, `free_float_capped` (or fully documented alternate type), source, source update, as-of timestamp | Every matching interval, including cap/rebalance adjustments; active-session weights sum to 1 within preregistered tolerance |
| `constituent_prices` | stable security ID, session date, completed status, raw close and/or adjusted close, previous adjusted close, raw volume, turnover (if available), adjustment/corporate-action version, source timestamps | Every active name on every included regular full session; delisted names retained; suspension must be identifiable, never converted to zero return |
| `corporate_actions` | stable security ID, action type, ex-date, adjustment factor/version, source timestamps | Complete mapping of splits, rights, stock distributions, special dividends and ticker changes; source must document its adjusted-price policy |
| `index_close` | HSI, completed session date, close, previous close, session status, source timestamps | Same dates as constituent panel plus official cash-market calendar; reconcile observed weighted aggregate vs HSI return under documented tolerance |
| `index methodology / divisor ledger` | methodology version, cap rules, rebalance dates, divisor adjustments and reasons | Required before calling contribution "index points". Without it, retain only approximate weighted-return contribution. |

### Required Metadata and Validation

- License/use/redistribution terms, vendor dataset version, vendor delivery timestamp, source as-of timestamp, file hash, extraction query/code hash, and known corrections.
- Stable security ID crosswalk for old/new tickers and listings/delistings.
- Daily quality report: active-count match, weight coverage, missing price/action mapping, duplicate IDs, suspension classification, price outliers, index reconciliation, and exclusions.
- A session is `missing`, not neutral, if any active constituent lacks valid PIT membership, a matching weight, adjusted price/action version, or completed index close.
- No half days, special sessions, or rebalance-effective sessions until separately predeclared and validated.

## Source Options and Acquisition Order

1. **Preferred -- Hang Seng Indexes / licensed index data vendor**: obtain contractual historical constituent files, free-float/capped weights, rebalancing/capping history, methodology versioning, and divisor adjustment records. Ask specifically for historical point-in-time snapshots/effective dates rather than current constituents.
2. **Preferred -- licensed Hong Kong equity historical data vendor or HKEX-authorized distribution**: obtain delisting-inclusive daily OHLCV/turnover and a corporate-action-adjusted price history with documentation. Confirm treatment of suspended securities, rights issues, special dividends, and identifier changes.
3. **Official public supplementation only**: Hang Seng Indexes daily constituent reports and index report CSVs may be archived prospectively after terms review. They can independently verify selected dates but, based on the 2026-10-06 manifest probe, must not be assumed to supply a full historical archive. Exact discovered endpoints are recorded in `backtest-readiness-report.md`.
4. **Not sufficient alone**: Yahoo/Futu/current webpage constituents, index-only OHLCV, HKEX Stock Connect statistics, or any current portfolio list. They fail the survivorship and/or constituent-level requirements.

Before download: obtain written internal authorization for the licensed data purchase/use and vendor redistribution terms. Do not scrape, evade paywalls, or bypass API/access controls.

## Reproducible Acquisition Plan

1. Create a versioned dataset manifest outside the repository: vendor/source URL or product ID, contract/license reference, download UTC time, original filename, byte count, SHA-256, vendor as-of timestamp, and query/extract code hash.
2. Freeze an initial research interval before inspecting the full panel. Proposed minimum is long enough to include multiple regular reviews and stressed/calm regimes; select dates only in a new admission-card version.
3. Import exact vendor extracts into the five contract tables without overwriting source fields. Preserve raw symbols and map them to a stable ID table.
4. For every day, join active membership to exact effective weights and completed adjusted prices. Fail the entire session on mismatch; write an exclusions manifest.
5. Reconcile constituent aggregate return to official HSI close under a predeclared tolerance. Investigate discrepancies around corporate actions/rebalances; do not force-fit.
6. Generate an immutable panel manifest and run only descriptive metrics first. Keep turnover breadth disabled until the data source supplies a consistent constituent-level turnover/volume definition.
7. Only then create `HSI-R-BREADTH-WEIGHT-v2` with frozen thresholds, outcome horizon, execution assumptions (if any), and chronological train/validation/OOS/holdout partitions. The existing card cannot be used for performance testing because its threshold/window choices are unset.

## Calculation Boundary Once Data Is Available

For usable session `t` and active universe `U_t`:

- `r_i,t = adjusted_close_i,t / previous_adjusted_close_i,t - 1`
- Equal-name breadth: advances / active count, reported with unchanged/declines.
- Weighted breadth: sum of active weight for advancing names.
- Optional turnover breadth: define only after a consistent constituent `turnover` field and currency/unit rule are supplied. Do not substitute share volume for turnover or mix vendors.
- Approximate contribution: `weight_i,t * r_i,t`; report as a weighted-return contribution, not index points.
- Concentration: absolute-contribution HHI and top-five absolute contribution share.

No prediction, trade, or A/B/C map action is produced by these metrics. Separate event study/performance evaluation requires its own preregistered card and the protocol's chronological gates.
