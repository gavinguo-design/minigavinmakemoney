# Reading Audit: *Evidence-Based Technical Analysis*

## Scope and source identity

- **Book:** *Evidence-Based Technical Analysis: Applying the Scientific Method and Statistical Inference to Trading Signals*
- **Author:** David R. Aronson
- **Edition/source inspected:** John Wiley & Sons, Inc., 2007 digital PDF; PDF pp. 1-528; printed book pp. 1-522 plus front matter, notes, and index.
- **Supplied file:** `Evidence-Based_Technical_Analysis_Applying_the_Scientific_Me---15821e64-b3af-458b-ad4a-169916bc0e3f.pdf`
- **SHA-256:** `8896ace097b7a9e185f337673e373784d592f5645203b234f2614dea1b1d4fb2`
- **Coverage record:** [`evidence-based-technical-analysis-coverage.json`](evidence-based-technical-analysis-coverage.json). It has one record for every PDF page, with section, text/render inspection status, content type, figures/tables detected, and render location.
- **Citation convention:** citations below use `PDF p.` because PDF numbering is stable for this supplied artifact. For main text, printed page is generally PDF page minus 7.

## Audit method and coverage result

1. Extracted text from every page in PDF order and rendered all 528 pages to images.
2. Visually reviewed all renderings in 88 contact sheets, grouped across PDF pp. 1-120, 121-240, 241-360, 361-480, and 481-528.
3. Read the extracted text page-by-page; inspected captions/nearby prose for each detected figure/table and method illustration. Dense tables, formulas, and plot labels were additionally checked against page images where needed for structural relevance.
4. Result: **528 / 528** pages text-inspected and visually render-inspected; **0** empty-text pages; **0** unreadable, scanned-only, cropped, corrupt, or failed-render pages. The document is a clean digital typeset PDF. Fine labels in dense tables/charts are not reproduced verbatim here unless material to the protocol; their page references and detected captions are preserved in the JSON manifest.

This is a reading/audit record, not a claim that the book's S&P 500 results transfer to Hang Seng Index (HSI) trading.

## Traceable chapter reading notes

### Front matter and introduction (PDF pp. 1-21)

- The contents establish the arc: objective rules; the dangers of subjective pattern inference; scientific method; statistics; hypothesis tests; data-mining bias; possible sources of nonrandom price motion; then a 6,402-rule S&P 500 case study (PDF pp. 6-7, 8, 12-16).
- The author explicitly frames a profitable backtest as insufficient without an inference procedure that separates predictive merit from luck and search bias (PDF pp. 15-16).
- **Author claim:** technical-analysis (TA) assertions must be sufficiently definite to test. **Not a product result.**

### Chapter 1 - Objective Rules and Their Evaluation (PDF pp. 22-38; printed pp. 15-31)

- A rule transforms one or more input time series into a recommended market-position output; a signal is a change in output, not merely an indicator level (Figs. 1.1-1.5, PDF pp. 23-29).
- It distinguishes traditional and inverse interpretations, warns that a rule can have position bias, and treats the benchmark as part of the rule-evaluation question (Fig. 1.6, PDF p. 33; benchmark discussion PDF pp. 29-38).
- Detrending/benchmarking is used to prevent a persistent long or short exposure from being mistaken for rule skill (PDF pp. 25-38; Appendix PDF pp. 475-476).
- **HSI research inference (unvalidated):** each trade-map condition must be represented as a versioned function from only information available at the decision timestamp to a defined action/state. Its benchmark must preserve comparable exposure/decision frequency, rather than default to an unconditional HSI long comparison.

### Chapter 2 - The Illusory Validity of Subjective Technical Analysis (PDF pp. 39-107; printed pp. 33-101)

- The central claim is that vague visual TA cannot be independently falsified or backtested; human cognition supplies hindsight, selective recall, confirmation, representativeness, small-sample, and narrative errors (PDF pp. 41-42, 47-105).
- The sequence of bullish/bearish conjecture and hindsight figures shows that identical prior data can support opposite stories once later price action is known (Figs. 2.7-2.11, PDF pp. 57-61).
- Breakout-failure and post-hoc pattern renaming are explicit warnings against letting a failed signal be reclassified after the outcome (Figs. 2.12-2.13, PDF pp. 70-71).
- The 2x2 contingency table, subjective-pattern list, and real-versus-random charts demonstrate that apparent pattern recognition is not evidence of predictive value (Figs. 2.15-2.25; Table 2.1; PDF pp. 80-104).
- **HSI research inference (unvalidated):** freeze each map snapshot before the next bar/event; retain the rule version, inputs, timestamp, unavailable inputs, and chosen A/B/C state. Never revise the historical evidence label after outcome observation.

### Chapter 3 - The Scientific Method and Technical Analysis (PDF pp. 108-168; printed pp. 103-163)

- The author emphasizes clear, falsifiable propositions rather than confirmation stories (PDF pp. 111-152). A prediction and an observation are conceptually distinct (Fig. 3.1, PDF p. 111); logical form matters (Figs. 3.2-3.5, PDF pp. 119-126).
- The head-and-shoulders case study demonstrates objectification: exclusion criteria, volatility normalization, symmetry requirements, and a completion rule are needed before a visually named pattern becomes testable (Figs. 3.6-3.15, PDF pp. 157-164; algorithm detail PDF pp. 153-165).
- The technical-analysis taxonomy separates subjective methods from objective/testable methods (Fig. 3.16, PDF p. 167).
- **HSI research inference (unvalidated):** “breadth weak,” “night futures confirm,” “support held,” and every candle pattern must have a deterministic definition, sampling time, missing-data behavior, threshold provenance, and a falsifying outcome. A prose rationale alone is not evidence.

### Chapter 4 - Statistical Analysis (PDF pp. 169-220; printed pp. 165-215)

- It introduces population versus sample, sampling variation, distribution shape, sample mean, standard deviation, probability density, law of large numbers, and standard error (Figs. 4.1-4.33; Table 4.1; PDF pp. 171-219).
- Crucially, Fig. 4.4 contrasts the null distribution for one tested rule with the distribution appropriate after testing many rules (PDF p. 175). This anticipates the data-mining correction.
- **HSI research inference (unvalidated):** report the number of independent decision observations, distribution of forward outcomes, drawdown/tail behavior, confidence intervals, and not just win rate. A small number of dramatic HSI episodes cannot establish a map factor.

### Chapter 5 - Hypothesis Tests and Confidence Intervals (PDF pp. 221-257; printed pp. 217-253)

- The book uses a skeptical null: a candidate TA rule has no positive expected return/predictive power beyond its stated benchmark (PDF pp. 221-237). A p-value is conditional on the null and does not prove the alternative (Fig. 5.9, PDF p. 236).
- Bootstrap resampling and Monte Carlo permutation are described as ways to form reference distributions for a *single pre-specified rule* (Figs. 5.11-5.14, PDF pp. 240-246); confidence intervals quantify estimation uncertainty (Figs. 5.15-5.23, PDF pp. 248-256).
- **HSI research inference (unvalidated):** for a pre-registered feature, test `H0: no incremental predictive value / no excess utility after matched benchmark and costs`. Use block-aware resampling where return dependence/regimes make IID resampling inappropriate. Do not use single-rule p-values after feature shopping.

### Chapter 6 - Data-Mining Bias: The Fool's Gold of Objective TA (PDF pp. 258-333; printed pp. 255-329)

- This is the key anti-overfitting section. The best in-sample candidate selected from a searched rule universe is biased upward and commonly deteriorates out of sample (Fig. 6.1, PDF p. 265; Figs. 6.2-6.10, PDF pp. 272-281).
- Bias depends on the number of alternatives searched, sample size, dependence/correlation among candidates, tail behavior, and actual variation in candidate merit (Figs. 6.21-6.55, PDF pp. 292-321).
- It describes data-mining-aware randomization / White Reality Check and Monte Carlo permutation approaches, and shows in-sample/out-of-sample segmentation and walk-forward testing (Figs. 6.56-6.57, PDF pp. 324-326; methods PDF pp. 327-333).
- **HSI research inference (unvalidated):** maintain a search ledger containing every feature, transform, threshold, market/filter, horizon, and discarded candidate. Split chronology before exploration; reserve a final locked holdout. For a broad search, evaluate the selected best rule with a multiple-testing/data-snooping-aware method, not its ordinary backtest p-value.

### Chapter 7 - Theories of Nonrandom Price Motion (PDF pp. 334-388; printed pp. 331-385)

- The chapter distinguishes explanatory theory from a story after the fact: useful theory makes falsifiable predictions (PDF pp. 334-345). It discusses efficient-market responses, under/overreaction, behavioral biases, feedback, and risk-adjusted comparisons (Figs. 7.1-7.15, PDF pp. 338-387).
- **HSI research inference (unvalidated):** cross-market inputs (CNH, A50, US rates/VIX, ADRs, Nasdaq) are hypotheses about conditional transmission, not permanent causal rules. Test their marginal value by regime and release/event type, including whether they add value after actual HSI futures/night-session information is present.

### Chapter 8 - Case Study: Rule Data Mining for the S&P 500 (PDF pp. 389-441; printed pp. 389-439)

- The case study deliberately enumerates a large, disclosed rule universe (6,402) and lists raw/derived inputs, operators, lookbacks, rule types, and naming conventions (PDF pp. 389-441; Tables 8.1-8.4; Figs. 8.1-8.30).
- Its strengths for replication are explicit input provenance, transformations, operator syntax, enumerated parameter grid, and stated selection universe. It is a methodological example, not a source of HSI parameter values.
- **HSI research inference (unvalidated):** build an HSI feature registry with source/vendor, raw timestamp, exchange/session definition, transformations, allowed lookbacks, release lag, and no-lookahead availability. Record every tested combination, including inversions and controls.

### Chapter 9 - Case Study Results and the Future of TA (PDF pp. 442-474; printed pp. 441-473)

- The case study reports that conventional single-rule assessment can make the best of thousands of rules appear impressive, while White Reality Check / Monte Carlo permutation accounting for the search can find no significant evidence for the best candidate (Figs. 9.1-9.3, PDF pp. 443-445; discussion PDF pp. 442-450).
- It discusses limitations, benchmark choices, rule complexity, validation segmentation, walk-forward complexity search, and objective model comparisons (Figs. 9.4-9.10, PDF pp. 455-471).
- **HSI research inference (unvalidated):** display “evidence status” separately from “market narrative”: exploratory, internally validated, locked-holdout supported, live monitored, degraded, or retired. No backtest result becomes an A/B/C confidence multiplier without an explicit evidence tier.

### Appendix, notes, and index (PDF pp. 475-528)

- The appendix provides the detrending/position-bias equivalence proof (PDF pp. 475-476), supporting the Chapter 1 warning that raw directional performance can conflate exposure with skill.
- Notes and index were included in coverage because they contain source/method details and terminology, especially references around data snooping, out-of-sample data, and the case-study methods (PDF pp. 477-528).

## Figure/table and math-method audit index

The JSON manifest enumerates labels detected on every page. High-relevance visual/method groups are listed here so future questions can be traced quickly.

| PDF pages | Figures/tables/method examples inspected | Why it matters to the HSI research protocol |
|---|---|---|
| 23-33 | Figs. 1.1-1.6: rule input/output, MA/threshold/band rules, inversions, position bias | Define a signal as executable and benchmarkable, including its inverse/control. |
| 47-105 | Figs. 2.3-2.25; Table 2.1: illusion/hindsight, subjective patterns, random-looking charts | Require ex-ante labels and prevent narrative relabeling. |
| 157-167 | Figs. 3.6-3.16: objective head-and-shoulders criteria, symmetry/completion, TA taxonomy | Turn chart language into deterministic inclusion/exclusion rules. |
| 171-219 | Figs. 4.1-4.33; Table 4.1: null distributions, sampling variation, LLN, SE, CLT | Report uncertainty and use the right distribution for the number of tested rules. |
| 226-256 | Figs. 5.1-5.23: null/alternative, p-values, bootstrap, permutation, confidence intervals | Pre-specify H0 and quantify uncertainty; do not equate p-value with probability a rule is true. |
| 265-326 | Figs. 6.1-6.57: OOS decay, search selection, bias drivers, ATR simulations, holdout/walk-forward | Keep a search ledger; use holdout and data-mining-aware evaluation. |
| 338-387 | Figs. 7.1-7.15: efficiency, reaction, behavioral feedback, risk-adjusted comparisons | Treat transmission and behavior stories as falsifiable regime-specific hypotheses. |
| 396-441 | Figs. 8.1-8.30; Tables 8.1-8.4: inputs, transforms, channel/threshold/divergence rule grammar | Use a reproducible feature/rule registry and disclose search space. |
| 443-471 | Figs. 9.1-9.10; Table 9.1: best-of-6,402 correction, results tables, model/walk-forward diagrams | Best observed result can be luck; validate complexity selection separately. |
| 475-476 | Appendix proof/formula | Compare rule value against matched position bias/exposure. |

## Proposed HSI trade-map research protocol (implementation inference; all items unvalidated)

### 1. Research object and availability discipline

- Define each candidate only from data genuinely available at a named HKT decision point: pre-open, opening auction completion, intraday checkpoint, close, or post-close.
- For each raw datum retain `source`, `source_updated_at`, `as_of`, exchange/session clock, vendor revision marker, missing/stale status, and acquisition timestamp.
- Define the target before modeling: e.g., HSI futures return after tradable spread/slippage over a specified horizon, probability of a scenario invalidation, or realized range. Do not mix these targets after seeing results.

### 2. Pre-register feature families and controls

- Candidate families: index breadth/weight contribution; HSI futures basis/night session; options implied-volatility surface/positioning; southbound/liquidity; event/calendar; and cross-market data.
- Define a non-directional/no-trade control and matched baselines: unconditional exposure, simple trend/range baselines, and time-of-day/session baselines. A candidate must beat the relevant baseline after costs, not merely predict raw positive HSI drift.
- Maintain a machine-readable **search ledger**: identifier, code/data version, hypothesis, features, transformations, thresholds, all parameter combinations, in-sample period, outcome, selection status, and reason for retirement.

### 3. Chronological evaluation design

- Freeze an early training/exploration interval, then use rolling walk-forward validation. Reserve a final untouched chronological holdout until rule logic and parameter choices are locked.
- Segment results by market state known at the decision time: trend/range proxy, volatility regime, major scheduled event window, session/overnight gap, holiday/half-day, roll/expiry, and data-availability state.
- Use purging/embargo or non-overlapping observations when horizons overlap; use block/bootstrap variants suitable for serial dependence rather than assuming IID daily returns.

### 4. Statistical decision standard

- **Default null hypothesis:** conditional on stated availability and matched benchmark, the candidate has no incremental predictive value or economic value after costs.
- Report effect size, bootstrap confidence interval, p-value/reference distribution, observation count, decision frequency, turnover, costs/slippage assumptions, maximum adverse excursion, drawdown/tail losses, and probability calibration (Brier score/log loss plus calibration curve when output is probabilistic).
- If searching multiple candidates/thresholds, ordinary per-rule p-values are descriptive only. Use a data-snooping-aware procedure (e.g., appropriately implemented Reality Check / superior predictive ability or search-replicating permutation) and disclose the full search universe.
- Do not carry over book-specific S&P 500 parameters, thresholds, or results as HSI priors.

### 5. Product gating

- `exploratory`: visible only to researchers; cannot change map confidence or user-facing directional wording.
- `validated_internal`: passed a pre-defined rolling validation gate but has no locked final holdout success; may be shown as research context, not a confidence modifier.
- `holdout_supported`: passed final locked holdout and cost/stability gates; eligible to adjust A/B/C probability *within tested regimes*.
- `live_monitored`: continuously compare realized calibration, coverage, turnover, and regime performance against validation ranges.
- `degraded` or `retired`: automatically cease confidence adjustment; retain historical audit trail. Missing/stale raw data always resolves to `unavailable`, never an inferred flow/direction.

## High-impact implications

1. An attractive A/B/C story is not evidence; it must become a timestamped, falsifiable rule with a stated benchmark and target.
2. The principal danger is not only subjective candles: every added HSI breadth, futures, option, event, and cross-market feature multiplies the search space and therefore the false-discovery risk.
3. Backtest accuracy/win rate alone is inadequate. Economic value after realistic execution, uncertainty, tail loss, and calibrated probability matter.
4. The correct user-facing response to insufficient evidence or unavailable data is `no directional evidence` / `unavailable` / `no trade`, not a synthetic explanation.
5. A feature that worked in one HSI regime or after a retrospective threshold search is an exploratory hypothesis until it survives locked chronological tests and live monitoring.

## Boundaries

- This audit does **not** implement any website, signal, skill, market-data, or configuration change.
- The protocol is a research proposal derived from the author's methodological claims; it is **not validated trading advice**, not a claim of HSI predictability, and not an endorsement of the book's specific S&P 500 rule set.
