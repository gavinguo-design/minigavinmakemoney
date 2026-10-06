# Trading and Exchanges: full-coverage reading audit

## Scope and identity

- **Book:** *Trading and Exchanges: Market Microstructure for Practitioners*.
- **Author:** Larry Harris.
- **Edition inspected:** Oxford University Press, copyright 2003; ISBN `0-19-514470-8`. The copyright page does not state a separate edition number.
- **Source file:** `Trading_and_Exchanges_Market_Microstructure_for_Practitioner---2b408297-3ef3-4d35-b26b-47471b6fa92a.pdf`.
- **File SHA-256:** `f222769f84db515cb154a678517f3d585b30c7a1dea22be360e847d4ed69f437`.
- **PDF pagination:** 657 PDF pages, including cover, front matter, 29 chapters, bibliography, and index. Book body printed pagination begins at 3 on PDF 16 and ends at 599 on PDF 612; bibliography is PDF 614-631 and index PDF 632-657.
- **Companion manifest:** `docs/research/audits/trading-exchanges-microstructure-coverage.json`.

This is an evidence and coverage record, not an implementation specification. Author claims are distinguished from **HSI/HKEX research hypotheses**. No US-market structure in this 2003 book is presumed to describe current HKEX practice.

## Coverage check

| Check | Result |
|---|---:|
| Expected PDF pages | 657 |
| Sequential text extraction completed | 657 / 657 |
| PNG pages rendered | 657 / 657 |
| Rendered pages visually inspected | 657 / 657 |
| Pages recorded as unreadable | 0 |
| Extracted text characters | 2,126,191 |
| Figure/table/caption candidate pages | 125 |

- Each page has one manifest record containing its PDF page, text count, rendering/visual flags, and figure/table caption candidates.
- Visual inspection found recurring `http://trott.tv` watermarks, occasional thin dark lower-edge scan artifacts, a prominent right-edge stripe on PDF 106, rotated table pages (PDF 119 and 419), and occasional encoding/OCR glyph errors. These do not obscure the body, table, chart, or caption content enough to prevent coverage.
- The high-resolution direct visual pass covered PDF 1-20. The entire 657-page rendered set was also inspected in 20-page contact-sheet batches, while all figure/table candidates were cross-checked against extracted caption text. Treat fine numerical labels in scanned chart images as visually reviewed but not transcription-grade unless cited from the page text. PDF 405 is a sparse separator/page-break rather than an omitted-content error.

## Reading map and visual inventory

Chapter ranges below use **PDF pages**. Figure/table counts are caption candidates detected in the complete manifest; inspect the cited pages when an exact visual or table value matters.

| Chapters / focus | PDF pages | Visual inventory cue |
|---|---:|---|
| Front matter and contents | 1-15 | Cover; contents; no analytical figures/tables |
| 1. Introduction | 16-23 | No numbered visuals |
| 2. Trading Stories | 24-43 | Figures 2-1, 2-2, 2-3; Table 2-1; quote montages and execution stories |
| 3. The Trading Industry | 45-80 | Tables 3-1 through 3-11; market, instrument, exchange, and regulatory comparisons |
| 4. Orders and Order Properties | 81-103 | Figure 4-1, Figure 4-2; Tables 4-1 through 4-4; book/order instructions |
| 5. Market Structures | 104-124 | Tables 5-1 through 5-8; transparency, data, routing, market classifications |
| 6. Order-driven Markets | 125-152 | Figures 6-1, 6-2; Tables 6-1 through 6-10; call/continuous-auction mechanics |
| 7. Brokers | 153-186 | Tables 7-1, 7-2; broker roles, order exposure, execution |
| 8. Why People Trade | 188-214 | Figure 8-1; Tables 8-1 through 8-4; trader motives/taxonomy |
| 9. Good Markets | 215-233 | No numbered visual identified |
| 10. Informed Traders and Market Efficiency | 235-257 | Tables 10-1 through 10-3; information and price formation |
| 11. Order Anticipators | 258-272 | No numbered visual identified |
| 12. Bluffers and Market Manipulation | 273-288 | Figures 12-1 through 12-3; Tables 12-1 through 12-3 |
| 13. Dealers | 290-309 | Figure 13-1; Tables 13-1 through 13-4 |
| 14. Bid/Ask Spreads | 310-334 | Figures 14-1, 14-2; Tables 14-1, 14-2 |
| 15. Block Traders | 335-350 | Tables 15-1 through 15-3 |
| 16. Value Traders | 351-361 | No numbered visual identified |
| 17. Arbitrageurs | 362-393 | Figure 17-1; Tables 17-1 through 17-3; carry/basis/index-arbitrage examples |
| 18. Buy-Side Traders | 394-406 | No numbered visual identified |
| 19. Liquidity | 407-422 | Tables 19-1 through 19-3; liquidity dimensions and suppliers |
| 20. Volatility | 423-432 | Formula/model discussion; no numbered visual identified |
| 21. Liquidity and Transaction Cost Measurement | 433-454 | Table 21-1 and formulas/benchmark examples |
| 22. Performance Evaluation and Prediction | 455-496 | Tables 22-1 through 22-8; statistical power and benchmarks |
| 23. Index and Portfolio Markets | 497-506 | Table/figure material on index construction/reconstitution |
| 24. Specialists | 507-526 | Figure/table material on specialist obligations and opening |
| 25. Internalization, Preferencing, and Crossing | 527-537 | No numbered visual identified |
| 26. Competition Within and Among Markets | 538-555 | One identified visual/table candidate; fragmentation/market competition |
| 27. Floor Versus Automated Trading Systems | 556-567 | One identified visual/table candidate |
| 28. Bubbles, Crashes, and Circuit Breakers | 568-597 | Figures 28-1 through 28-9; Table 28-1; historical price charts and controls |
| 29. Insider Trading | 598-612 | No numbered visual identified |
| Bibliography and index | 613-657 | Separator, bibliography, index |

## Traceable author claims relevant to an HSI trading map

These are descriptions or arguments from Harris, not claims validated for HSI/HKEX.

- **Markets solve a search and matching problem; trading rules determine who can trade, when, and at what cost.** The opening overview frames orders, quotes, and market organization as information-processing mechanisms (printed pp. 3-10; PDF 16-23).
- **A market order buys/sells at the best currently available price; a limit order constrains price but can fail to execute.** The book explicitly treats market orders as immediacy-demanding and limit orders as liquidity-providing trading options (printed pp. 68-86; PDF 81-99). Figure 4-1 and Tables 4-1 to 4-4 show order-book placement, contingent orders, expiry, and order properties (PDF 86-100).
- **Opening/call auction mechanics must be separated from continuous trading.** A single-price auction ranks orders by precedence and clears eligible demand/supply at a uniform price; a continuous auction can create different trades and surplus outcomes from the same orders (printed pp. 112-135; PDF 125-148). See Tables 6-1 to 6-9 and Figures 6-1 to 6-2 (PDF 131-144). The book also notes market-on-open and market-on-close orders in its order discussion (printed p. 83; PDF 96).
- **Transparency, latency, and data definitions change what can be inferred.** The market-structure chapter distinguishes quote/trade reporting, pre-trade versus post-trade transparency, and real-time versus delayed data (printed pp. 97-111; PDF 110-124), especially Tables 5-2 and 5-7 (PDF 111 and 115). A displayed book is not necessarily total available liquidity.
- **Price discovery is conditional on who supplies/takes liquidity and what information they have.** Harris describes dealers and order-driven systems as seeking prices that balance supply/demand, while informed traders make prices more informative (printed pp. 223-243 and 279-295; PDF 236-256 and 292-309). Table 10-3 classifies value, news, technical, and arbitrage information specialties (PDF 248).
- **Bid/ask spread is an immediacy cost, not a pure directional signal.** Spread components include normal transaction costs, inventory risk, and adverse-selection risk (printed pp. 297-321; PDF 310-334); Figures 14-1/14-2 and Tables 14-1/14-2 provide the decomposition/determinants (PDF 314-324).
- **Liquidity has multiple dimensions.** The book identifies width (cost), depth (size), and immediacy (time), and explains displayed versus undisclosed liquidity (printed pp. 394-409; PDF 407-422; Tables 19-1 to 19-3 at PDF 410, 411, 418). A high turnover number alone does not establish liquidity quality.
- **Volatility has fundamental and transitory components.** Harris distinguishes unanticipated value changes from trading-related effects such as bid/ask bounce (printed pp. 410-417; PDF 423-430). A noisy short-horizon price change should not automatically be treated as new fundamental information.
- **Futures/spot and related-instrument spreads require a carry and implementation model.** The book explains basis/carrying-cost logic and warns that apparent arbitrage can contain execution, financing, and volatility risk (printed pp. 347-379; PDF 362-393), including stock-index futures arbitrage at PDF 366-367 and carrying-cost factors in Table 17-3 (PDF 385).
- **Index construction/reconstitution can itself move constituent prices.** The index-market chapter describes index portfolio trading and reconstitution effects (printed pp. 484-493; PDF 497-506). This supports treating index review/rebalance dates as event-state metadata, not as directional certainty.
- **Performance claims need benchmarks, statistical power, and realistic data properties.** Chapter 22 highlights luck/skill confusion, benchmark selection, test power, non-normality, serial dependence, and backtest/data issues (printed pp. 442-483; PDF 455-496; Tables 22-1 to 22-8). It is a direct warning against presenting raw hit rate as proof of an HSI rule.

## Unvalidated HSI/HKEX hypotheses and minimum data requirements

Each item is a research backlog item, **not** a current product rule or live trading recommendation.

| Hypothesis / question | Required data | Guardrail and decision use |
|---|---|---|
| Opening-auction imbalance and indicative equilibrium price improve classification of opening gap continuation vs. reversal. | HKEX auction-session timestamps/rules, indicative equilibrium price/volume/imbalance if available, HSI constituents, HSI futures, complete intraday OHLCV/order-book proxy. | First verify current HKEX auction design and data entitlement. Test by regime and event day; may only adjust A/B/C confidence or `no-trade`, never assert direction from imbalance alone. |
| HSI futures overnight return, high/low, basis, and OI change improve pre-open map more than US proxies alone. | Timestamp-aligned HSI spot/index and front/next futures quotes, contract specs, session calendar, rollover flags, volume/OI, FX and US close metadata. | Basis must be normalized for contract multiplier, fair-value/carry assumptions, time-to-expiry, dividends and stale timestamps. Missing night-session fields remain unavailable. |
| Breadth and concentration distinguish broad risk appetite from a few-heavyweight index move. | Constituent membership history, free-float weights/divisor or official index contribution data, constituent prices/turnover, HSI/HSCEI/HSTECH values. | Do not infer exact index points from current weights without historical constituents/divisor treatment. Test concentration/breadth incremental value beyond index return. |
| Wider spreads, reduced depth/proxies, or unusual price impact mark lower-confidence/greater execution-risk periods. | Best bid/ask and depth where licensed; otherwise documented proxies such as turnover, realized volatility, quote frequency, futures bid/ask, and time-of-day. | A proxy is not order-book liquidity. Label methodology and availability; do not call lower turnover “outflow.” |
| Futures basis/OI/volume combinations may classify hedging, directional demand, or rollover conditions. | Contract-level price, volume, OI, expiry, settlement, roll calendar, spot level; participant data only if officially available. | No single combination identifies trader intent. Output `ambiguous` unless independently validated against future distribution. |
| Option IV, skew, term structure, OI and volume identify expected move/risk zones rather than direction. | Full option chain, greeks/IV methodology, expiry/strike, OI/volume, futures/spot, rates/dividends, timestamp. | IV/skew are model- and liquidity-sensitive. Use only as volatility/risk context; do not turn put/call ratios into an automatic bullish/bearish arrow. |
| Cross-market predictors decay or invert by regime. | USD/CNH, A50, HSTECH, HSCEI, China ADR/index proxies, Nasdaq, UST yields, VIX plus consistent timestamps/calendars. | Estimate rolling, lag-aware, out-of-sample relationships. Never encode permanent “X up implies HSI up.” |
| Event metadata reduces avoidable model errors around rebalances, expiry/roll, holidays, half-days, severe-weather arrangements and macro releases. | Official HSI/HKEX calendars/notices, HKMA/HKEX weather arrangements, economic-event calendars, actual session-status feed. | Event flags are risk/context fields, not directional forecasts. Treat source/timezone revisions as first-class data. |

## Product implications, bounded by the evidence

1. The map should prefer a **market-state gate** before an A/B/C path: regular/auction/after-hours, data freshness, rollover/expiry, event proximity, and liquidity availability. If the state is unknown, emit `unavailable` or `observe-only` rather than interpret it.
2. Store a per-factor provenance envelope: `source`, `source_updated_at`, `as_of`, `session`, `availability`, `methodology_version`, and, where relevant, `contract/expiry`. This follows the book's transparency and measurement cautions; it is an implementation inference.
3. Treat price, breadth, futures, options, and cross-market evidence as separate evidence families. A related family can corroborate a hypothesis but is not independent by default.
4. Build evaluation around forward distributions, adverse excursion, transaction/execution proxies, and calibration—not directional hit rate alone. Chapter 22 supports this methodological posture but does not validate any HSI model.

## Explicit non-transfers / limitations

- The book uses U.S. venues, rules, technology, and examples current around 2001-2003. They are not evidence of present HKEX market mechanics, rights, auction parameters, reporting fields, or trading hours.
- It discusses dealer, specialist, crossing, and floor-market examples that may not map to an HSI cash-index/futures/options workflow.
- It does not provide a validated HSI forecasting strategy. It supplies concepts and falsifiable questions, not parameter values or probabilities for HSI.
- The audit does not authorize execution, leverage, position sizing, or any claim that data are complete.
