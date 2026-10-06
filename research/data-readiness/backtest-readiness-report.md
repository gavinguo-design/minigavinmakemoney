# HSI Breadth / Weight Contribution Backtest Readiness

- Assessment timestamp: 2026-10-06T21:16:00+08:00
- Scope: `HSI-R-BREADTH-WEIGHT-v1`, research-only.
- Decision: **blocked. No valid historical backtest or sample metric has been run.**
- Reason: this repository has no point-in-time constituent history, weight history, survivorship-safe constituent price panel, corporate-action mapping, or divisor/capping history. Current/public snapshots must not be substituted for history.

## Contract Reviewed First

This assessment follows:

1. `research/governance/research-protocol.md`
2. `research/governance/breadth-weight-data-contract.md`
3. `research/governance/registry.json`

The registered card remains `lifecycle: data_pending`; thresholds, historical interval, train/validation/OOS/holdout partitions, and trade claim are intentionally unset. Therefore the only permissible work at this stage is readiness evidence and fail-closed calculation plumbing.

## Local Inventory

| Component | Local evidence | Fields / granularity | Historical range | PIT / survivorship result |
| --- | --- | --- | --- | --- |
| HSI constituent membership | None | No `constituent_universe` table | None | Missing; no eligible session |
| HSI free-float/capped weights | None | No `constituent_weights` table | None | Missing; no eligible session |
| Rebalance / capping / divisor history | None | No effective-date files or divisor series | None | Missing |
| Constituent OHLCV / turnover | None | `investment/chart/kline_futu.json` is one HSI index series, not constituent data | HSI index only | Not usable for constituent breadth or contribution |
| Adjusted prices / corporate actions | None | No `adjusted_close`, action version, ex-date, factor mapping | None | Missing |
| Official HSI close | Partial | Existing HSI chart files plus official daily `idx` example downloaded below | Local chart history is index-only; official manifest exposes 25 recent sessions | Does not make a constituent panel usable |

The repository contains no CSV, Parquet, spreadsheet, or database panel for the five required data-contract tables. Existing production-facing assets were not altered.

## Lawful Official Availability Probes

All timestamps below are source/retrieval evidence only, not market observation timestamps. Files are retained as evidence payloads with checksums in `evidence/SHA256SUMS`; the manifest deliberately excludes itself and `node scripts/verify-evidence-checksums.cjs` verifies every listed payload.

| Source / exact URL | Download / status | Available content and granularity | Coverage discovered | Backtest sufficiency / caveat |
| --- | --- | --- | --- | --- |
| Hang Seng Indexes daily-report manifest: `https://www.hsi.com.hk/api/wsit-hsi-ddoc-ea-public-website-proxy/v1/product-data/pub/series/metadata/v2?data=dailyReport&seriesCode=hsi` | HTTP 200; `evidence/hsi-daily-report-manifest-2026-10-06.json` | JSON paths by report type: constituent PDF (`con-pdf-1`), index daily CSV (`idx`), index-performance spreadsheet (`ips`) | 25 constituent-PDF, 25 daily-index, and 26 index-performance entries; 2026-09-01 through 2026-10-06 | Official and reproducible as a recent-public archive pointer, but visibly only 25 constituent-report entries. It is not established as a complete historical PIT archive. |
| Constituent report (from the official manifest): `https://www.hsi.com.hk/api/wsit-hsi-ddoc-ea-public-website-proxy/v1/content/gcs/download?resource=/public-website/webapp/contents/en/indexes/report/hsi/con_6Oct26.pdf` | HTTP 200; `evidence/hsi-con_6Oct26.pdf`, SHA-256 `04fc303b6812e9c76dfbf61cd405b0413dfea0cb40ee8ccf1b205ca931ad889f` | Official daily constituent report PDF; PDF is a 10-page snapshot | 2026-10-06 snapshot only | Could support a **single-date** universe/weight extraction after fields and as-of semantics are independently verified. It does not prove historical membership intervals, free-float factors, caps, or divisor history. No metrics were run from it. |
| Index daily report (from official manifest): `https://www.hsi.com.hk/api/wsit-hsi-ddoc-ea-public-website-proxy/v1/content/gcs/download?resource=/public-website/webapp/contents/en/indexes/report/hsi/idx_6Oct26.csv` | HTTP 200; `evidence/hsi-idx_6Oct26.csv` | UTF-16 TSV: `Trade Date`, `Index`, `Index Currency`, `Daily High`, `Daily Low`, `Index Close`, `Point Change`, `% Change`, `Dividend Yield (%)`, `PE Ratio`, `Index Turnover (Mn)`, `Market Turnover (Mn)`, `Index Currency to HKD` | 2026-10-06 file only; manifest has recent entries above | Satisfies a source option for official completed HSI close and index turnover only. It is not constituent price/turnover data. |
| Factsheet manifest: `https://www.hsi.com.hk/api/wsit-hsi-ddoc-ea-public-website-proxy/v1/content/gcs/download?resource=/public-website/webapp/factsheets/factsheet.json` | HTTP 200; `evidence/hsi-factsheet-manifest-2026-10-06.json` | Current factsheet resource locations, including `/public-website/webapp/factsheets/en-hk/hsi.pdf` | Current resource map | Useful for current methodology/factsheet discovery; no versioned historical methodology/divisor sequence established. |
| Public constituent metadata route probe: `https://www.hsi.com.hk/api/wsit-hsi-ddoc-ea-public-website-proxy/v1/product-data/pub/constituent/metadata/v2?data=top10&indexCode=HSI&language=en` | GET 400; POST 404; saved response/header evidence | No usable public response obtained via documented website route | N/A | No access control was bypassed. Do not treat this route as an acquisition solution without official API access/terms. |
| HKEX historical market-data discovery: `https://www.hkex.com.hk/Market-Data?sc_lang=en` | HTTP 503 from this environment | Not downloaded | N/A | Site availability from this host is insufficient; official commercial Market Data Services remains a source option, not a verified local feed. |

### Source / Licensing Caveats

- Hang Seng Indexes public reports are official-source evidence. The report manifest itself shows limited recent coverage, so it must not be represented as a long-lived PIT membership or weighting history without a separate archival completeness audit.
- The public PDF was retained only as a small provenance sample. Before retaining raw reports at scale, confirm Hang Seng Indexes terms and redistribution rights. Raw licensed data should be external to this repository as the research protocol requires.
- HKEX public Stock Connect historical pages describe Stock Connect statistics, not a full HSI constituent OHLCV/corporate-action panel. They cannot satisfy this contract.
- Any vendor must contractually permit internal research use, document corporate-action adjustment policy, retain delisted/ticker-changed constituents, and license the relevant historical index constituent/weight data.

## Missing Components

1. Historical PIT HSI constituent membership with effective-from/effective-to intervals and stable IDs.
2. Historical free-float-adjusted, capped constituent weights for every effective interval and rebalance day; exact `weight_type` and source timestamps.
3. Official, versioned capping/rebalance and divisor adjustment history. Without it, only `weight * adjusted return` may be called an approximate return contribution, never index points.
4. Delisting-inclusive constituent daily OHLCV, preferably official close/turnover plus documented adjusted close and volume/turnover definition.
5. Corporate-action event/version table covering splits, rights, special dividends, suspensions, ticker changes, and other adjustments.
6. An official HSI completed-session close/calendar dataset and an explicit constituent-to-index reconciliation policy.
7. Predeclared sample window and chronological partitions. These are governed by the admission protocol and have not been selected.

## Safe Prototype and Test Gate

`research/breadth-weight/backtest.js` is deliberately not a backtest runner. It accepts an in-memory fully specified session only and rejects incomplete panels before calculating. If/when a valid panel is supplied, it emits the contract's equal-name breadth, weighted breadth, approximate weighted return contributions, concentration HHI, and top-five absolute-contribution share. It has no turnover breadth metric because no valid constituent volume/turnover field exists.

It explicitly flags `NOT_OFFICIAL_INDEX_POINT_ATTRIBUTION`. Before calculation, it requires valid ISO calendar session/as-of/effective dates, ISO-8601 source timestamps with timezones, source identifiers, one exact study session across membership/weights/prices/index close, and the explicit HSI weight type `hsi_free_float_adjusted_capped`. It rejects malformed or mismatched provenance, missing index/price provenance, duplicate or incomplete panels, and invalid weight coverage. The tiny internally constructed test fixture is a gate test, **not source data, not an input artifact, and not a backtest result**.
