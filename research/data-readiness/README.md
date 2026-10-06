# HSI Breadth / Weight Data Readiness

Status: **BLOCKED -- valid historical backtest has not begun.**

This folder is a research-only data-readiness record for `HSI-R-BREADTH-WEIGHT-v1`. It neither changes the A/B/C production map nor asserts a signal or a historical result.

- `backtest-readiness-report.md`: local inventory, externally verified source evidence, caveats, and acquisition plan.
- `blocked-backtest-spec.md`: minimum viable panel, pre-registration boundary, and source options.
- `evidence/`: small, lawfully downloaded official-source evidence payloads plus SHA-256 checksums; it is not a backtest panel.
- `evidence/SHA256SUMS`: manifest of evidence payloads only. It deliberately never hashes itself; run `node scripts/verify-evidence-checksums.cjs` to verify every listed payload and reject unlisted payloads or tampering.
- `../breadth-weight/backtest.js`: deterministic, research-only calculation gate. It requires one valid ISO study session, matching as-of/session dates, source identifiers and timezone-bearing source timestamps for membership, weights, every price, and index close. It rejects incomplete, non-point-in-time, or non-HSI-free-float-capped weights before calculating anything.

Raw licensed data must remain in secured storage. Do not add vendor raw data to this repository without redistribution approval.
