# Three Trading Books: Full-Coverage Reading Audit

**Status:** source-covering audit complete on 2026-10-06. This document records what was actually extracted and visually inspected; it does **not** claim that the books' historical trading rules predict modern HSI/HSCEI outcomes.

The machine-readable per-spine/per-page checklist is [`trading-reading-audit-manifest.json`](trading-reading-audit-manifest.json). It is the authoritative coverage ledger.

## Method and Evidence

- EPUBs: parsed `META-INF/container.xml`, OPF manifest, and declared spine; extracted every spine document in order and every referenced `img` asset. Each extracted visual was reviewed through contact sheets. No missing references remained.
- PDF: rendered all 343 PDF pages with PyMuPDF, OCR'd each rendered scan with macOS Vision, and reviewed all pages through page contact sheets. The source is a raster scan: each page contains one full-page image, so embedded-image count is not a meaningful figure count.
- “Read” here means the textual source was extracted in source order and reviewed alongside its chapter structure; “visual inspected” means the rendered/extracted asset or page was included in a visual review. OCR is secondary evidence only; the original page image is authoritative when OCR is imperfect.

## Coverage Summary

| Book | Source identity | Text coverage | Visual coverage | Completeness check |
| --- | --- | --- | --- | --- |
| 《定本酒田战法》 | Lin Huitaro; Chinese EPUB; Feishu `...3710d625...` | 15/15 spine items; 99,699 extracted characters | 61/61 visual occurrences | OPF spine = extracted sections; 0 missing refs |
| 《日本蜡烛图技术》 | Steve Nison; Chinese EPUB; Feishu `...914a6697...` | 77/77 spine items; 166,414 extracted characters | 301/301 visual occurrences | OPF spine = extracted sections; 0 missing refs |
| 《股票作手回忆录新版》 | Edwin Lefevre; Zheng Peiyun/Zhang Xingwang trans.; scanned PDF; Feishu `...4fd51a4b...` | 343/343 rendered pages OCR'd | 343/343 rendered pages visually inspected | PyMuPDF page count = 343; rendered count = OCR count = 343 |

The manifest includes source file SHA-256 values, each EPUB spine location and image location, and one record for every PDF page.

## 1. 《定本酒田战法》

### Structure and visual audit

The EPUB contains a preface, eight chapters, and afterword. The chapter-level records and every image filename are in the manifest. Visuals are substantive in chapters 1–7, with no figures in the research chapter.

- **Ch. 1, `OEBPS/text00004.html`:** 4 visuals. Trend/wave schematic, candle anatomy, and swing/pullback drawings. The useful visual lesson is separating the dominant trend from counter-moves.
- **Ch. 2, `OEBPS/text00005.html`:** 6 visuals. A historical chart, new-value sequence diagrams, and frequency/cumulative-frequency tables. The tables report the book's sample distributions; they are not HSI probabilities.
- **Ch. 3, `OEBPS/text00006.html`:** 10 visuals. Range/level sketches, candle-combination catalogues, and a compact buy/sell reference table. They document classification, not a standalone mechanical rule.
- **Ch. 4, `OEBPS/text00007.html`:** 9 visuals. Bottom/reversal examples, including an identifiable morning-star, two-point-bottom, and engulfing-style plate, plus applied charts.
- **Ch. 5, `OEBPS/text00008.html`:** 6 visuals. Top/sell-side pattern catalogues. The visual inspection supports “named formations are variants,” not an unconditional direction label.
- **Ch. 6, `OEBPS/text00009.html`:** 18 visual occurrences. Worked `逆行新值` sequences, range/measurement annotations, numbered position/rule templates, and trade-record/position-management illustrations.
- **Ch. 7, `OEBPS/text00010.html`:** 4 visuals. Multi-candle and contract/settlement relationship examples, including a historical multi-month chart.
- **Front/back QR graphics:** 4 occurrences; publishing links, not method evidence.

### Direct source claims / rules

These are descriptions of the book, not current-market truth claims.

- A daily candle is a post-close OHLC compression; it does not reveal intraday sequencing. The book treats the completed bar as the observable fact.
- The book’s central device is **酒田新值**: count successive same-direction *new highs/new lows relative to the relevant swing*, not merely consecutive red/green candles.
- It distinguishes **顺行** from **逆行**. The same visible formation has different meaning when it is a pullback within an advance versus a move at a top or in a decline.
- It frames “three” and “five” as historical rhythm/statistical thresholds in its own samples, not mystical constants. Its reported frequencies are tied to historical Japanese commodity/equity material.
- It makes position construction (`建玉`), trial positions, adding/reducing, closing, and hedging part of the method rather than treating a shape as a complete trade instruction.
- It advocates recording the trade process (“买卖谱”) for later review.

### Implementation inferences (not book claims)

- A product may expose `market_leg`, `sakata_new_value`, and an evidence lifecycle such as `observed -> candidate -> confirming -> triggered | invalidated`.
- “Trial” must be education/paper-simulation only unless separately risk-approved; it must not become an automated averaging-down instruction.
- A chart may display “the nth countertrend new value” as an observation, never as a guaranteed reversal target.

## 2. 《日本蜡烛图技术：古老东方投资术的现代指南》

### Structure and visual audit

All 77 spine sections and 301 visual occurrences were extracted and inspected. The file’s table of contents documents: history and construction; reversal formations (umbrella, engulfing, dark cloud, piercing, stars, harami, three crows/soldiers, etc.); continuation formations (windows/gaps, three methods, separating lines); doji; a glossary; and combined methods (trendlines, retracements, moving averages, oscillators, volume, targets).

- **Construction and reversal chapters:** ideal candle diagrams are repeatedly paired with historical chart examples. Visual audit confirms that the book uses examples to show a formation within a preceding move, rather than displaying an isolated shape as sufficient proof.
- **Continuation and doji chapters:** diagrams and annotated chart cases cover gaps/windows, multi-session continuation, small-body/indecision structures, and their context.
- **Combined-method chapters:** visuals cover trendlines, support/resistance polarity, retracement levels, moving averages, RSI, oscillator families, MACD, volume, box breakouts, measured moves, flags and pennants.
- **Glossary (`text/part0072.html`):** 41 visual occurrences, a visual reference catalogue. It supports identification only; it cannot establish signal quality by itself.

### Direct source claims / rules

- Candles communicate the relationship of open, high, low, and close; a named formation requires prior price context and generally needs confirmation.
- Reversal patterns flag a potential change in the current trend; they do not prove a full trend reversal on their own.
- Windows/gaps, trendlines, polarity changes, retracements, moving averages, oscillators, volume, and price targets can be used for **confluence**.
- The book explicitly combines Eastern candlestick analysis with Western technical tools; this is a framework for corroboration, not an assertion that every indicator is independent evidence.

### Implementation inferences (not book claims)

- Evidence must identify dependencies: RSI, MACD, moving averages, and candle patterns are all price-derived, so agreement among them is not equivalent to independent confirmations.
- Use a support/resistance **zone**, confirmation bar, structural invalidation, and actual scenario entry before calculating risk/reward.
- The illustrated glossary belongs in reference/help, not as a trading-action engine.

## 3. 《股票作手回忆录新版》

### Structure and visual audit

The supplied PDF is a 343-page scan of Edwin Lefevre’s *Reminiscences of a Stock Operator*, Chinese edition credited to Zheng Peiyun and Zhang Xingwang, Shanghai University of Finance and Economics Press (2006). It has prefaces and twelve chapters. PDF pages 28–34 provide a contents map; chapter openings occur at PDF pages 35, 64, 90, 117, 144, 171, 197, 221, 241, 267, 295, and 316.

- Every page was rendered, OCR’d, and visually classified in the manifest.
- The visuals are cover/publisher matter, historical illustrations/photos, and decorative material. **No genuine technical price chart, quote-sheet data table, or trading table was found in the scanned edition.**
- Historical images give period context but are not quantitative evidence and were not used to create signal rules.

### Direct source claims / rules

These are recurring lessons presented through the narrator’s experiences; they are not a scientific trading specification.

- Read the market’s actual action rather than argue with a preferred theory (“do not fight the tape” in the book’s historical vocabulary).
- Being directionally right is insufficient if timing, execution, capital, liquidity, or position size are wrong.
- The book repeatedly emphasizes patience for a broad move, allowing a profitable position to prove itself before increasing exposure, and avoiding action for its own sake.
- Losses should force diagnosis; tips, vanity, overtrading, averaging a wrong position, and dependence on a broker/insider narrative are treated as recurring failure modes.
- “Intuition” in the narrative is represented as compressed experience from observing market action, not an exempt-from-evidence prediction tool.

### Implementation inferences (not book claims)

- Record an explicit hypothesis, observation, planned action, capital-at-risk, invalidation, and review result. This turns the book’s experiential lesson into an auditable product record.
- A scenario should distinguish “market observation” from “action permission”; a compelling narrative must not override stale data, missing confirmation, liquidity constraints, or a failed risk gate.
- Do not encode the book’s anecdotes as deterministic price-prediction rules.

## Modern HSI / HSCEI Applicability and Backtesting Gates

All three sources predate or are not designed for current HSI/HSCEI index behavior. The following are mandatory limitations:

- Historical Japanese commodity statistics and book-specific `3/5` new-value rhythms are **not** HSI/HSCEI probability estimates.
- HSI/HSCEI are index products affected by constituent concentration, China/Hong Kong policy, USD/CNH, US overnight markets, futures basis/roll, holiday schedules, auction behavior, and event gaps. These can invalidate slow, mean-reversion, or pattern-based interpretations.
- A current/intraday daily candle must be marked provisional. No daily pattern, new-value increment, or confirmation may be promoted from an unclosed bar.
- Books’ historical position-sizing, averaging, leverage, and cross-contract hedging examples must not be automated or presented as real-time execution instructions.

Before any displayed confidence, win rate, target distribution, or rule is used in a HSI/HSCEI decision surface, backtest it by:

1. Defining the candle/new-value rule exactly (close-based versus high/low-based variants) before sampling.
2. Separating market regimes: trend/range, volatility, event days, roll/settlement windows, and gap sessions.
3. Measuring forward return, maximum adverse excursion, invalidation hit rate, transaction cost/slippage, trade frequency, expected value, and drawdown—not hit rate alone.
4. Comparing against simple baselines and applying rolling out-of-sample validation plus probability calibration.
5. Retaining data timestamp, session completeness, rule version, evidence snapshot, and outcome for every displayed scenario.

## Verification Commands

Run from the repository root after the source files are available locally:

```bash
python3 - <<'PY'
import json
p = 'docs/research/trading-reading-audit-manifest.json'
d = json.load(open(p))
for b in d['books']:
    print(b['id'], b['coverage'])
PY

python3 -m json.tool docs/research/trading-reading-audit-manifest.json >/dev/null
git diff --check -- docs/research/
```

Expected coverage: Sakata `15/15` spine and `61/61` visual occurrences; Nison `77/77` spine and `301/301` visual occurrences; Livermore `343/343` rendered/OCR/visual pages.
