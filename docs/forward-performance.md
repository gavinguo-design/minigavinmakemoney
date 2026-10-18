# Forward performance ledger

`node scripts/score-performance.cjs` builds
`investment/chart/predictions/performance.json` from frozen evidence. It never
edits `daily-generated`, `daily-reviews`, `archive`, or `predictions/log.json`.
The `/chart/track/` page reads this ledger instead of calculating returns from
the old hand-written log.

## Daily samples

The observation is the **publication-day completed close partition**, not the
sign of the daily return, the five-session drawing, a triggered trade, or profit.
A is close >= upper, B is lower <= close < upper, C is close < lower.

Eligibility requires all three exhaustive non-overlapping frozen rules, valid
probabilities summing to one, the preceding completed session as the baseline,
preopen generation and information cutoff, and an original Git addition commit
before 09:30 HKT whose file hash still matches. Git commit times have second
precision; generation timestamps may have milliseconds. A subsequent edit,
backfill, copied archive, or missing provenance is excluded explicitly.

Only complete unique valid OHLC from a known timestamp is used. Review identity,
probabilities, version, OHLC, labels and Brier are cross-checked independently.
Missing/mismatched reviews are exposed; they cannot overwrite the recomputation.
Missing forecasts remain in the publication denominator, not the accuracy
denominator. Coverage starts at the first daily-generated file and ends at the
latest completed HKEX session. Earlier prose forecasts are a separate cohort.

The same samples and price boundaries are used for all baselines:

- Fixed B: probability (0, 1, 0).
- Previous close zone: probability one on the zone containing the frozen baseline close.
- Uniform: probability (1/3, 1/3, 1/3).

Multiclass Brier is sum((p - outcome)^2). Top-class ties receive 1/tie-count
credit only when the realized class is among the tied maxima. All denominators
are shown, even below 30; small samples do not establish predictive advantage.
Results are also grouped by the version actually published, including fallback.

## Older forecasts and trades

The old prose scenarios are not converted retrospectively into modern A/B/C
labels. The explicit frozen `horizonEndDate` determines the audit date; the
calendar-derived deadline is shown separately when they conflict. Expired
records get an independent sidecar audit, retaining their original status and
review. The endpoint index return is labelled market change, never trade return.
Neutral bias has no directional hit result. Full prose-scenario success stays
unverified. Price touches require every complete session in the window; a
publication-day bar already observed after close is excluded. Touches do not
establish fill order, entry, stop execution, or profitability.

Trade P&L remains unverified until a separately specified reconciler can validate
opening/closing fills, product direction and multiplier, fees, and forecast
attribution. Existing `pnl`/`pnlPct` fields are not accepted as this evidence.
There is no automatic order execution.

## Refresh and publication

The daily publication workflow refreshes the ledger after committing the frozen
forecast/review. A separate 18:10 HKT workflow runs independently of generator
success so missed publications are still recorded. Both use full Git history.
GitHub schedules can be delayed; the page detects an outdated through-session.

The analysis date picker merges archive dates, daily evidence dates from the
ledger, and the current annotations date. Original daily-generated records take
precedence over reconstructed archives. Reload/manual refresh chooses the latest
genuine available analysis, skipping carried-forward copies and future dates.
An older selected analysis remains explicitly historical and cannot gain current
trading eligibility. Background refresh preserves a deliberate historical choice.

Validation: `node --test tests/*.cjs`. Browser acceptance must separately verify
reload, manual date choice, refresh, and actual deployed scorecard rendering.
