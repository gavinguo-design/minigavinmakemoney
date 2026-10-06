# Option Volatility & Pricing - Full-Coverage Reading Audit

## Scope and provenance

- **Book:** *Option Volatility & Pricing: Advanced Trading Strategies and Techniques*
- **Author:** Sheldon Natenberg
- **Edition identified:** revised / second edition (the PDF includes separate prefaces to the first and second editions); copyright page lists 1994, Richard D. Irwin; ISBN `1-55738-486-X`.
- **PDF object:** 475 PDF pages, scanned image PDF; SHA-256 `4c5b39195314948d805ef49a3daba5625a26b8b1493a84bc65a2713b94992ada`.
- **Citation convention:** `PDF p.` means the scan page; `printed p.` means the book's visible Arabic/Roman page number when available. The scan starts with cover/front matter, so these are not always equal.
- **Audit boundary:** This document records what the author says and separately labels product implications. It does **not** validate a rule for HSI, recommend a trade, or change product code.

## Coverage verification

| Check | Result |
| --- | --- |
| PDF pages discovered | 475 |
| Pages rendered | 475 / 475 |
| Pages OCR-read in sequence | 475 / 475 |
| Page visual inventory reviewed | 475 / 475 |
| Unreadable/corrupt pages | None identified |
| Text extraction source | macOS Vision OCR from rendered scans; character recognition errors remain possible in formulas/numbers |

The machine-readable page manifest is [`option-volatility-pricing-coverage.json`](option-volatility-pricing-coverage.json). It records every PDF page, OCR character count, and a conservative visual/content tag. Render and OCR intermediates are intentionally not committed because they duplicate the supplied copyrighted source.

## Structure and visual inventory

- Contents occupy PDF pp. 4-9 (printed pp. v-x); prefaces are PDF pp. 10-12 (printed pp. xi-xiii). Main text is 18 chapters plus Appendices A-F, recommended reading, and index (contents, PDF pp. 4-9).
- Key subject chapters: Ch. 4 *Volatility* (printed p. 51); Ch. 6 Greeks (p. 95); Ch. 14 *Volatility Revisited* (p. 273); Ch. 15 *Stock Index Futures and Options* (p. 301); Ch. 17 *Position Analysis* (p. 353); Ch. 18 *Models and the Real World* (p. 385).
- The audit inspected all visual pages. Material includes probability-distribution diagrams, historical-versus-implied-volatility charts, option payoff graphs, Greek/risk tables, skew charts, index-volatility comparisons, position-analysis graphs, and mathematical appendix formulas. Examples: lognormal distribution (PDF p. 75 / printed p. 63); IV-vs-HV graphic (PDF p. 300 / printed p. 291); VIX/OEX comparison (PDF p. 337); payoff/Greek examples (PDF pp. 140, 165, 173, 190); skew graphics (PDF pp. 416-424); model-limit and distribution figures (PDF pp. 398-424).

## Traceable findings: author claims, not product rules

### Volatility definitions and price versus value

- Historical volatility depends on selected lookback and sampling interval; longer windows describe a characteristic average while short windows can expose extremes. The author explicitly says a trader may need multiple windows to understand a contract. **Citation:** PDF p. 82, printed p. 70; visual example at PDF p. 83, Figure 4-8.
- Implied volatility (IV) is the volatility input which makes a pricing model equal the observed option price; it is solved from option price rather than directly observed in the underlying. **Citation:** PDF pp. 84-85, printed pp. 72-73, Figure 4-9.
- An aggregate market IV can be weighted by traded volume, open interest, or preferably near-the-money options. This is a convention, not a direction signal. **Citation:** PDF p. 86, printed p. 74.
- The author frames option value around future volatility and option price around implied volatility. Comparing expected future volatility to IV can motivate an option buyer/seller preference, but it does not establish the future direction of the underlying. **Citation:** PDF p. 87, printed p. 75; PDF p. 304, printed p. 295.

### Term structure and realized/future volatility

- Volatility is presented as variable and often mean-reverting, not constant. The author argues that long-dated IV tends to stay closer to the underlying's mean volatility than short-dated IV when short-run historical volatility shifts. **Citation:** PDF p. 301, printed p. 292.
- The book compares implied and historical volatility explicitly and cautions that the eventual underlying volatility dominates a position's economics; IV still matters because it is the price paid/received. **Citation:** PDF pp. 290-304, especially PDF p. 304 / printed p. 295; Figure 14-7 at PDF p. 300.
- This is a pricing/risk claim, not evidence that an upward or downward IV term structure predicts HSI direction.

### Greeks and delta hedging limits

- Delta, gamma, theta, vega, and rho identify changing exposures; they are dynamic and do not remove risk. **Citation:** PDF p. 137, printed p. 126.
- A delta-neutral example must be rebalanced as delta changes; the realized result depends on the path and cash flows of those adjustments, not simply on an initial delta. **Citation:** PDF pp. 95 and 100, printed pp. 84 and 89; PDF p. 102 for a worked short-option hedge.
- The text later makes the important model caveat explicit: gap moves prevent continuous delta adjustment, breaking diffusion/continuous-hedging assumptions and potentially invalidating replication values. **Citation:** PDF p. 405, printed p. 397.
- Therefore a displayed Delta/Gamma/Vega field is risk exposure metadata, not a direct buy/sell prediction.

### Skew/smile and strike differences

- A volatility skew is the tendency for different strikes to trade at different IVs (definition: PDF p. 438, printed p. 430). The book shows that flat Black-Scholes IV is rarely observed and attributes possible differences to market frictions, non-diffusion moves, changing volatility, or distributional mismatch, without claiming a single cause. **Citation:** PDF pp. 413-415, printed pp. 405-407.
- The author illustrates a skew surface/rule based on log moneyness and time and shows wing inflation/reduction as changes in perceived large-move odds. **Citation:** PDF pp. 418-422, printed pp. 410-414, Figures 18-8c through 18-10.
- For stock-index options, he notes richer downside strikes may reflect crash-risk expectations and/or demand to hedge long stock portfolios; he says the exact cause may not be determinable. **Citation:** PDF p. 424, printed p. 416.
- This directly supports treating skew as a risk-price/hedging-demand observation, **not** a deterministic bearish indicator.

### Volume, open interest, and strike concentrations

- The only direct aggregation instruction found states that single IV may be averaged using volume, OI, or ATM weighting (PDF p. 86). It does not state that high call OI is bullish or high put OI is bearish.
- A visible large OI/volume at a strike can arise from long or short positions, spreads, rolls, hedges, market-maker inventory, or closing activity; without trade-side and position-level data, its directional ownership is unidentified. This sentence is a **minigavin implementation inference**, not an author claim.
- Consequently `put/call volume`, `put/call OI`, and strike concentration may describe liquidity/positioning candidates but cannot independently supply an A/B/C directional state.

### Why a simple model or one options field is insufficient

- The book displays non-normal features such as skewness and excess kurtosis in observed return distributions (PDF pp. 409-412, printed pp. 401-404) and explicitly identifies non-frictionless markets, gaps, changing volatility, and imperfect distributions as model limits (PDF pp. 398-405 and 413).
- That is strong support for uncertainty labels, source timestamps, and event-aware risk states. It is not support for treating an old model output as a probability forecast.

## Explicitly unvalidated HSI options/futures hypotheses

These are research proposals only. Each must be specified before testing, use timestamp-correct data, include costs/slippage, use walk-forward out-of-sample evaluation, and permit a `no evidence` result.

1. **ATM IV minus matched-horizon realized-vol forecast:** At each HSI options timestamp, compare a standardized, liquidity-filtered ATM IV to an ex-ante realized-volatility forecast of the same calendar horizon. Test whether the spread improves *future realized-volatility calibration* and/or the probability of a predefined range break. Do not test it as an unsigned direction predictor by default.
2. **Term-structure state:** Define front/next maturity ATM IV after calendar-day normalization. Test whether contango/backwardation adds information about subsequent realized range, gap frequency, or event risk after controlling for time-to-expiry and scheduled events. It is not presumed bullish/bearish.
3. **Skew state:** Define 25-delta (or HKEX-available equivalent) put IV minus call IV, both matched on expiry and liquidity. Test separately whether it calibrates left-tail risk, realized downside semivariance, and next-session gaps. Do not infer direction merely because downside puts are expensive.
4. **Strike concentration:** Identify OI and turnover concentration by strike/expiry, separate near-expiry from later-expiry, and test only whether these levels coincide with liquidity, pinning, or realized volatility. A level is not support/resistance until that is demonstrated out of sample; side ownership is unknown.
5. **Futures basis/night session:** Combine HSI futures close, cash index close, next-session open, basis, OI, and overnight high/low; test predictive stability by regime and trading calendar. Do not use US market proxies as a substitute when actual HSI futures are available.

## HKEX-specific facts/mechanics that must be independently verified before any implementation

The book is general and largely US-market oriented. It does not validate these for HSI/HKEX:

- Current HSI options and futures contract multiplier, settlement style, strike intervals, expiries, final-settlement calculation, exercise/assignment process, margin, position limits, market-maker arrangements, and exchange trading/after-hours sessions.
- Exact source licensing, publication latency, timestamp time zone, quote versus trade fields, OI update cadence, corporate/action or index-methodology adjustments, and whether a data vendor includes after-hours activity.
- Futures cash-basis construction and usable carry/dividend input; near/next contract roll calendar; special arrangements for half days, severe weather, holidays, expiry, and index review/rebalance dates.
- Whether available HSI option data supports reliable delta-based or fixed-moneyness IV interpolation, and what liquidity/quote-quality filters are defensible.

Official HKEX and Hang Seng Index documentation, the current contract specifications, and the licensed data vendor schema must be recorded alongside any implementation.

## Product guardrails inferred from this reading

These are **minigavin implementation inferences**, not quotations or validated strategy rules:

- Keep options information as a dated `volatility/risk` evidence family distinct from price-action direction.
- Require per-field `source`, `source_updated_at`, `as_of`, `status`, calculation/moneyness convention, expiry, and liquidity filter. Missing means `unavailable`, not a directional default.
- Present ATM IV, term structure, skew, and OI/volume concentration as observations plus uncertainty; only let a pre-registered, validated model alter A/B/C probabilities.
- Make all delta-hedging/Greeks presentation conditional on model inputs and warn that gaps and discrete hedging break continuous replication assumptions.
- Preserve raw snapshots and generated feature versions for later audit and recalibration.
