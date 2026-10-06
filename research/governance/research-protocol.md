# HSI Research Admission Protocol

This governs research artifacts only. It does not authorize deployment, alter the existing A/B/C decision logic, or create a trading instruction.

## 1. Preregister

Before acquiring or inspecting the test panel, create a versioned admission card with:

- Falsifiable hypothesis and descriptive/predictive claim boundary.
- Exact input universe, timestamps, freshness rules, transformations, outcome horizon, trigger, confirmation, invalidation, exit, applicable and disabled regimes.
- Tradeable instrument, execution timing, fees, spreads, slippage, ambiguous-bar treatment, and maximum holding period if performance is tested.
- Chronological train, validation/walk-forward, OOS, and final holdout partitions. The final holdout is immutable until all choices are frozen.

Any material change produces a new `rule_id` version and restarts the holdout gate.

## 2. Maintain a search ledger

For every data source, experiment, and discarded variant, retain date, card version, dataset manifest/checksum, query or code revision, source coverage, exclusions, parameters, and decision. Record negative results. Do not retroactively relabel a discovered pattern as preregistered.

## 3. Evaluate without leakage

- Use point-in-time constituent membership, weights, prices, event calendars, futures rolls, and options conventions.
- Separate completed-session facts from partial/intraday facts. Never substitute retrieval time for source time.
- Enforce available/stale/missing status; missing inputs are unavailable, not a neutral or favorable observation.
- Run rolling walk-forward: fit/choose only in each training window, freeze rules, then score the next chronological validation window.
- Report IS, OOS, and untouched holdout separately. Include sample size, win rate, average R, expectancy after declared costs/slippage, max drawdown, exclusions, and uncertainty where feasible.

## 4. Admission gates

A rule cannot be considered for any production discussion unless all are true:

1. Every required source has provenance and point-in-time timestamps.
2. Trigger, confirmation, invalidation, and exit are exact and machine-readable or unambiguous prose.
3. Costs/slippage and execution timing are specified for a trade claim.
4. IS, OOS, and holdout metrics are present, pass their preregistered gates, and use independent chronological samples.
5. A conflict priority and placement are declared.
6. An independent review records that the evidence supports only the claimed scope.

The repository validator intentionally rejects cards that do not meet evidence completeness. A valid schema card remains research-only; separate explicit authorization and implementation review would be required for any production change.

## 5. Record outcomes

Keep the raw dataset outside this public repository when licensing or confidentiality requires it. Store only manifests, card versions, code hashes, aggregate results, and reproducible instructions here. Report failures, revisions, and disabled regimes alongside positive findings.
