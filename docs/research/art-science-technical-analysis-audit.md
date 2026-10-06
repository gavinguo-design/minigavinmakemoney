# Reading Audit: *The Art and Science of Technical Analysis*

## Scope and identity

- **Source file:** `The_Art_and_Science_of_Technical_Analysis_Market_Structure_P---7e997645-d6d2-4d6f-8c67-1a57fcd18b87.pdf`
- **Metadata title:** *The Art and Science of Technical Analysis: Market Structure, Price Action, and Trading Strategies*.
- **Author / publication shown in source:** Adam Grimes; copyright 2012, John Wiley & Sons (PDF pp. 9-10).
- **PDF length:** 234 pages. The per-page coverage manifest is `docs/research/art-science-technical-analysis-coverage.json`.
- **Citation convention:** `PDF p.` always means the page number in this supplied PDF, not an inferred print-page number. This avoids false precision because the supplied copy has front matter and a major missing-content discontinuity.
- **Audit completed:** text extracted in PDF order and a rendering of every page reviewed. All 234 rendered; no unreadable/corrupt page was found. The manifest has 234 page records and `counts_match: true`.

## Critical source-integrity finding

The table of contents names Parts I-IV, Chapters 1-12, and Appendices A-C (PDF pp. 2-6). However, the readable body runs from Chapter 2 material through PDF p. 85, then shows Part II / Part III / Part IV divider pages (PDF pp. 86-88), then starts **Chapter 11** (PDF p. 89). There are no readable bodies for **Chapters 3-10** in this supplied file.

Consequences:

- This is a full-coverage audit of the supplied 234-page PDF, **not** evidence that the complete published book has been read.
- The missing body includes the TOC's dedicated chapters on trends, ranges, trend/range interfaces, practical templates, confirmation tools, trade management, risk management, and trade examples.
- Do not attribute any detailed Grimes rule from those chapters to this source until an intact edition is supplied. The statements below only cite material actually present.

## Coverage and visual inventory

The machine manifest records text length, rendered-pixel hash, image/vector counts, caption detections, flags, and status for every PDF page. This markdown ledger is the human-readable visual index.

| PDF pages | Content / coverage result | Visual material inspected |
|---|---|---|
| 1-18 | Cover, title/copyright, contents, preface, acknowledgments, Part I divider | Cover p.1; sparse/divider pages 8, 11, 17-18. |
| 19-62 | Chapter 1: edge, chart reading, indicators, price action, pivots, multiple time frames, hand charting | Fig. 1.1-1.18 across pp. 31, 40-61; formula/expectancy layout p.24; chart diagrams and captions reviewed. |
| 63-85 | Chapter 2: Wyckoff cycle and four trade categories | Fig. 2.1 p.64, Fig. 2.2 p.68; text discussion of cycle and trade taxonomy. |
| 86-88 | Part divider pages only | Sparse section dividers; no chapter body follows for Parts II/III. |
| 89-134 | Chapter 11: trader mind, biases, intuition, flow, practical psychology | Fig. 11.1 p.123; one highlighted/callout source box p.116. |
| 135-145 | Appendix A: trading primer | Figs. A.1-A.4 pp.141-145: tick, tick-aggregate, bar/candle, market-profile charts. |
| 146-163 | Appendix B: moving averages and MACD | Figs. B.1-B.16 pp.148-163: synthetic series, SMA/EMA and MACD construction/artifacts. |
| 164-165 | Appendix C | Sample-trade-data tables; p.165 has no extractable text but renders as a continuation/table layout. |
| 166-192 | Glossary | Text entries; p.179 contains a small rendered visual asset. |
| 193-198 | Bibliography, author bio, source links | p.193 has a small visual/link asset; remaining pages render normally. |
| 199-234 | Index and ending imprint/index continuation | Text index; final p.234 is intentionally sparse but rendered. |

### Figure, chart, table, formula audit

- **Figures/charts inspected:** Fig. 1.1-1.18 (PDF pp. 31, 40-61), Fig. 2.1-2.2 (pp. 64, 68), Fig. 11.1 (p.123), Fig. A.1-A.4 (pp.141-145), and Fig. B.1-B.16 (pp.148-163).
- **Tables inspected:** Appendix C sample trade-data tables (PDF pp.164-165).
- **Formula inspected:** expected-value presentation (PDF p.24). Its symbols do not extract cleanly from the PDF; the accompanying prose defines it as probability-weighted payoff and states its large-sample limitation.
- **Unclear / unavailable:** no visual or textual source material for figures/tables that may have appeared in the missing Chapter 3-10 body. This is a file-content limitation, not an audit omission.

## Traceable source claims

These are **author claims or frameworks**, not established HSI facts and not instructions to trade.

### Edge, probability, and scientific posture

- Markets are usually close to efficient/random; costs create a hurdle even for an otherwise positive-expectancy approach (PDF p.21).
- An edge is a large-sample relationship between entries/exits, probabilities, and payoffs; a win rate and reward/risk ratio must be considered together (PDF pp.21-24).
- The author frames technical patterns as possible evidence of underlying buying/selling imbalance, rather than objects to trade in isolation (PDF p.26).
- Edge development is iterative: convert ideas into actionable systems, monitor, and expect decay/retooling as markets evolve (PDF p.27).
- Clean, consistent price-first charts are favored; calculated tools should supplement rather than obscure price structure (PDF pp.29, 36).

### Market structure, trends/ranges, and support/resistance

- The source distinguishes dynamic **price action** from the static historical record called **market structure** (PDF p.37).
- Its simple model describes motive and resistive forces: equilibrium is typically random; a liquidity failure can create impulse movement that either rebalances or persists (PDF pp.37-38).
- Pivot highs/lows and higher-order pivots provide structure/context, but the author explicitly warns that this backward-looking swing method is not a right-edge predictive methodology (PDF pp.40-43).
- Relative swing position and length distinguish an uptrend, a range, a structural warning, and a breakout; higher lows pressing into resistance are presented as a possible sign of buying conviction, not certainty (PDF pp.44-49, Figs. 1.6-1.10).
- A single candle admits many lower-timeframe paths; close location may suggest end-of-period control, but must not be treated as a complete intrabar account (PDF pp.51-54, Figs. 1.11-1.13).
- The Wyckoff cycle is presented as an idealized model; accumulation/distribution classification can be ambiguous in real time, and a simple lower-shadow pattern has no claimed standalone predictive power outside context (PDF pp.63-75, especially pp.66-68, 72).

### Breakouts, failures, and trade categories

- The author organizes technical trades into four categories: trend continuation, trend termination, support/resistance holding, and support/resistance breaking/failing (PDF pp.76-85).
- Trend-continuation concepts require a defined point at which the trend thesis is wrong; complex/two-legged pullbacks are a stated failure/management consideration (PDF pp.78-79).
- Trend-termination is not automatically trend reversal; the stated success condition can simply be the end of the existing trend. Countertrend positions and adding into adverse trends are explicitly characterized as dangerous (PDF pp.80-81).
- Support/resistance is not a clean exact-price mechanism; false drops/breaks occur. The source says failed breakouts are a distinct, potentially important subset, while also stating that most breakouts fail and that breakout zones can be volatile, illiquid, crowded, and subject to slippage (PDF pp.82-84).

### Indicators and tool construction

- Indicators should be understood mechanistically, not followed as unexplained lines; the source favors controlled/synthetic data experiments to understand their behavior (PDF pp.36, 146-147).
- Appendix B shows that SMA/EMA behavior differs around shocks, stabilization, and the left edge of an SMA window; visually persuasive moving-average support/resistance is not offered as proven (PDF pp.147-153, especially p.148).
- The selected MACD construction is described as a difference between moving averages; its fast line responds to **change in momentum**, and can generate construction artifacts after shocks. The source advises using it as a contextual layer near possible inflections, not reacting to every movement (PDF pp.154-163).

### Risk/trade management and statistical validation

- The supplied source does **not** contain the bodies of its advertised Chapters 8, 9, 10, or 12. Therefore it cannot support specific claims about Grimes's complete stop placement, targets, position sizing, portfolio risk, record keeping, or statistical-trade-result procedure.
- What is available: all trade categories should have risk and expectation defined before entry (PDF p.78); countertrend and breakout trades can incur gap/slippage risk that complicates sizing (PDF pp.81, 83); and expectancy only becomes meaningful over sufficiently large samples (PDF pp.23-24).

## Proposed minigavin inferences: unvalidated HSI research hypotheses

These are product/research translations, not claims made by the author, not live trading instructions, and not validated predictions.

1. **Regime gate.** If daily HSI is classified as `range/equilibrium`, A/B/C directional confidence should be capped and `wait/no-trade` made eligible; test whether range labels reduce false directional scenario triggers versus no regime gate. Data: survivorship-safe HSI OHLCV, complete-bar flags, HSI futures basis/night data, transaction-cost proxy. Source inspiration: PDF pp.37-38, 45.
2. **Breakout quality feature.** Test whether a resistance break preceded by higher daily pivot lows has different conditional follow-through, MAE, and false-break probability from a generic close above resistance. Define pivots and resistance without future leakage; compare against a generic-breakout baseline. Data: daily/intraday HSI and futures OHLCV, event calendar, liquidity/volume fields. Source inspiration: PDF pp.47-49, 83-84.
3. **Failure-state first.** For every A/B/C path, encode an explicit structural invalidation and separately record a maximum-risk control. Test whether stateful `candidate -> confirmed -> invalidated` records improve calibration and post-hoc audit quality relative to one-off directional labels. Data: immutable forecast snapshots, complete-bar status, future realized bars. Source inspiration: PDF pp.43, 78-81.
4. **Support-zone rather than exact-point test.** Compare a zone/tolerance definition with an exact-price definition for support-holding and failed-breakout observations; evaluate hit rate, payoff after costs, maximum adverse excursion, and stability across regimes. Data: high/low/close, realized volatility, volume, session/holiday calendar. Source inspiration: PDF pp.82-83.
5. **Indicator-ablation test.** For any MACD/MA confirmation proposed for HSI, compare price-structure-only, indicator-only, and combined models on a chronologically separated out-of-sample period. Reject the indicator layer unless it improves calibrated performance after multiple-testing controls. Data: precisely versioned daily bars, chosen indicator parameters fixed before evaluation, trade-cost assumptions. Source inspiration: PDF pp.36, 146-163.
6. **Daily-close integrity test.** Compare signals formed from completed HSI daily bars with signals that incorrectly incorporate intraday/incomplete daily bars; report revision rate, apparent in-sample uplift, and out-of-sample decay. Data: timestamped intraday and official-close feeds. Source inspiration: PDF pp.51-59; Appendix A pp.141-145.

## High-impact implications for the HSI map

- The most defensible next feature is not more named patterns: it is a **regime + structural-state layer** with clear data provenance and invalidation rules.
- A/B/C must remain conditional paths. A breakout should be represented as an observation plus a confirmed/failure condition, not a declaration that price will trend.
- The product should expose `no directional edge / unavailable` whenever complete-bar, source-freshness, or market-regime evidence is missing. This is faithful to the source's emphasis on randomness and large-sample evidence.
- No Grimes-derived numeric threshold, MA parameter, breakout success rate, stop distance, or position-size rule is justified from this incomplete PDF. Those require separately specified, HSI-specific and out-of-sample-tested research.

## Reproducibility checks

```bash
python3 - <<'PY'
import json
p = 'docs/research/art-science-technical-analysis-coverage.json'
d = json.load(open(p))
assert d['coverage']['reviewed_pages'] == d['source']['pdf_page_count'] == len(d['pages'])
assert d['coverage']['counts_match']
assert not d['coverage']['unreadable_pages']
print('coverage ok:', d['coverage'])
PY

git diff --check -- docs/research/art-science-technical-analysis-audit.md docs/research/art-science-technical-analysis-coverage.json
```

Expected audit result: `coverage ok: {'reviewed_pages': 234, 'pdf_page_count': 234, 'counts_match': True, 'unreadable_pages': []}`.
