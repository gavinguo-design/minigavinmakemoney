---
name: candlestick-evidence
description: "Contextual candlestick and technical-analysis evidence for auditable trading scenarios."
---

# Candlestick Evidence

Use when an agent or chart must turn OHLCV and indicator data into conditional, auditable trading scenarios. Candles are price-action evidence, not predictive guarantees or standalone buy/sell commands.

## Core Rules

- Read location and prevailing trend before a pattern: relevant support/resistance zone, trend structure, and timeframe context come first.
- Treat support, resistance, gaps, and pattern ranges as zones, not exact inviolable prices.
- Classify every signal: `candidate -> confirming -> triggered | invalidated`. A candidate from an incomplete candle cannot trigger a trade.
- Require confirmation from a completed candle and state the exact confirming condition. Do not claim confirmation when source data are stale, missing, or provisional.
- State an entry, confirmation condition, structural invalidation, disaster stop, and risk/reward. Reject plans with planned `RR < 2`; do not silently substitute an attractive global reference price.
- Structural invalidation is the price that disproves the scenario. A disaster stop is a separate maximum-loss boundary; never conflate them.
- Evaluate multi-timeframe alignment explicitly: lower-timeframe reversal evidence can be countertrend to the higher-timeframe structure.
- Do not count correlated price-derived indicators as independent confirmations. Describe the evidence families used (price structure, timeframe, volume/flow, event/fundamental) and their dependencies.
- Anchor forecast paths at the displayed latest completed/current candle close. Future curves are conditional paths, not forecasts presented as facts.
- Preserve reproducibility: record source, source timestamp, analysis timestamp, bar timeframe, whether the last bar is provisional, inputs, and rule version. Never invent a pattern, threshold, or market datum.

## Algorithm

1. Validate OHLCV schema, source freshness, timestamps, and market-session status; mark the last bar as completed or provisional.
2. Establish higher-timeframe trend and nearby price zones; record the zone bounds and why they matter.
3. Detect eligible candle/price-action patterns only in that context; otherwise return no pattern evidence.
4. Create `candidate` evidence with the pattern range and a completed-candle confirmation condition.
5. Define the scenario entry, structural invalidation, separate disaster stop, target(s), and planned RR using the actual scenario entry.
6. Check timeframe alignment and evidence-family independence; downgrade confidence or label conflict rather than manufacturing consensus.
7. Move state only when current, completed-bar data satisfy the declared condition: `candidate`, `confirming`, `triggered`, or `invalidated`.
8. Emit the contract below and retain it with the chart/scenario record for later review.

## Output Contract

Return one record per scenario in this shape. Use `null` or an explicit unavailable status for unsupported values; do not fabricate them.

```json
{
  "scenario_id": "stable-id",
  "state": "candidate|confirming|triggered|invalidated",
  "direction": "long|short|neutral",
  "timeframe": "1d",
  "as_of": "ISO-8601 timestamp",
  "data": {
    "source": "source identifier",
    "source_updated_at": "ISO-8601 timestamp",
    "last_bar_time": "bar timestamp",
    "last_bar_provisional": false,
    "rule_version": "version identifier"
  },
  "context": {
    "higher_timeframe_trend": "bullish|bearish|range|unknown",
    "price_zone": {"kind": "support|resistance|gap|other", "low": 0, "high": 0},
    "alignment": "aligned|countertrend|mixed|unknown"
  },
  "evidence": [
    {"family": "price_action|structure|volume_flow|event", "claim": "observed fact", "dependent_on": []}
  ],
  "conditions": {
    "confirmation": "completed-bar condition",
    "entry": 0,
    "structural_invalidation": 0,
    "disaster_stop": 0,
    "targets": [0],
    "planned_rr": 0
  },
  "forecast_anchor": {"bar_time": "bar timestamp", "close": 0},
  "notes": ["limits, conflicts, or missing inputs"]
}
```

## Guardrails

- Do not promote a pattern solely because its name sounds directional.
- Do not update evidence state from an unclosed candle unless the output clearly remains provisional.
- Do not render an unsupported signal as a recommendation; render `no valid evidence` instead.
- Measure later outcomes against the recorded conditions and data snapshot, not a rewritten rationale.
