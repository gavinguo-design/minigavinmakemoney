# Daily analysis publication contract

This is a deterministic price-structure baseline, not a claim that all seven
books have been implemented or that outcome probabilities are calibrated.
The latest confirmed two-sided swing pivots (two bars on each side) define
the A/B/C partition. Only completed daily closes satisfy those conditions.
Observed historical levels provide structural targets. Sub-2:1 or incomplete
odds remain observation-only and never receive a complete entry ruler.

## Schedules (Hong Kong time, HKEX calendar checked in scripts)

- 08:45: generate analysis for that session from the previous completed session.
- 09:05: retry; preserve an already frozen same-day analysis.
- 09:15 and 09:25: independent publication/deployment deadline checks.
- 16:20 and 16:40: confirm the day's close in a separate review, without editing
  the morning analysis. Missing complete OHLC makes the job fail.
- 16:50: independent close-review and deployed-commit check.
- Existing 16:45 archival task preserves the actually published analysis.

GitHub scheduled jobs can start late. Preopen generation at/after 09:30 is
rejected; a delayed job must not backdate itself. Failed checks are visible in
GitHub Actions. Account notification delivery depends on GitHub preferences.
The current UI disables expired maps independently of whether Actions runs.

## Data and failure behavior

The previous HKEX session must be present, with valid OHLC and a known source
timestamp. Missing sessions may be retrieved from Yahoo's daily chart API;
existing confirmed candles are not overwritten by the alternate source.
Official participation is usable only for the matching baseline session and
only if its publication timestamp precedes the information cutoff. Night
futures, option risk and Southbound data without a verified snapshot stay
unavailable. Daily scenario weights are versioned rule scores, explicitly
uncalibrated; they are not historical win rates. Frozen supplements retain
their original values.

The independent watchdog verifies the applicable date, baseline, publication
kind and the exact content commit's successful Cloudflare Pages check. The
postclose watchdog additionally verifies review identity and date, and checks
the deployment containing the close status/review. An archival run alone is
not considered a successful new-analysis publication.

## October 9 reconstruction

`archive/supplements/2026-10-09.json` is a retrospective reconstruction using
the October 8 OHLC snapshot committed on October 8 and the October 8 official
participation report committed before the October 9 preopen cutoff. The
original `archive/2026-10-09.json` stays byte-for-byte frozen. The history UI
prefers the supplement for that date and labels it as a retrospective record.
It cannot become the current online map and is not appended to predictions/log
or counted in Brier, hit rates or claimed original prediction samples.

## Verification

`node --test tests/*.cjs` runs the full suite. Generator tests also rehearse
preopen publication, idempotent retry and a separate close review in an
isolated temporary project. Tests use dated fixtures rather than mutable live
analysis, so tomorrow's generated annotations cannot invalidate old test
expectations. The next scheduled production run still requires observation;
a rehearsal does not prove a future scheduled job has already succeeded.

## Intraday display refresh

The deployed page evaluates the frozen `daily_rule_analysis` A/B/C price
partition against valid same-session quotes. It refreshes with the existing
quote polling (30 seconds in continuous trading and closing auction; 60
seconds otherwise) and on return to a visible tab. The fetched status file is
stored separately, so an old external writer cannot replace this preview
with October 6 conditions. Unsupported legacy rule formats are not guessed.

`updated_at` remains the quote's source timestamp. Stale/future quotes,
expired analysis, hindsight supplements and incomplete/overlapping price
partitions cannot produce a live preview. Lunch and half-day behavior uses
the shared HKEX calendar. After the close, quotes cannot generate a
`close_final`: the independent published close review is still required.
No intraday refresh writes to annotations, archives, prediction scores or
trade records. Observation-only A/B/C cards retain their condition checklist
without gaining an executable risk/reward ruler.

Repository audit on October 12 HKT: all 509 reachable commits and the sole
`main` branch were checked. External snapshot-writer source was not present;
its October 9 commits update the two static JSON snapshots about every 30
minutes. The latest status had `conditions_date: 2026-10-06` and no analysis
identity. This display fix does not claim to have changed that external job.

Regression coverage: `tests/intraday-refresh.cjs` verifies source timestamp
expiry, exact A/B/C boundaries, map identity, non-trading periods, rejected
requests, continued polling, checklist rendering and refresh completion.
Local tests and CI are separate from a real trading-session acceptance run.

## Stale scenario fan guard (October 22)

On October 22 the HSI closed at 22,934.68, below every band of the 08:40
preopen map (based on the October 21 close). The chart still drew three fans
from the latest candle back up into the old bands, which read as "all three
cases rebound". Display rule (`MarketRules.fanPlan`, latest mode only; history
replay is unchanged so prediction-vs-outcome review still works):

- Price below the lowest band edge or above the highest: no fan is drawn. A
  plain status line says the old map (with its basis close date) is finished
  and a new one is pending.
- Otherwise, if price moved at least 0.3% from the baseline close, any band
  lying wholly on the opposite side of price from that move is not drawn
  (fall: band low above price; rise: band high below price). Bands still
  containing or ahead of price keep the original geometry.
- Every scenario card, the range badge and fan endpoints show "基于 MM-DD 收盘".

Tests: `tests/scenario-fan.cjs`.
