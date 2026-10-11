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
unavailable. Probabilities stay null; no confidence percentages are invented.

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
