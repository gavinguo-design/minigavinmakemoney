#!/usr/bin/env python3
"""Fetch daily HSI constituent OHLC and compute market-breadth metrics.

Universe & membership: `scripts/_hsi_constituent_versions.py` encodes the point-in-time
Hang Seng Index constituent list, keyed by effective-date windows, sourced from Hang Seng
Indexes Company quarterly "Index Review Results" press releases (URLs recorded in each
version's `source` field; several only reachable via web.archive.org because hsi.com.hk
moved its press-release path mid-2026) plus the ad-hoc Hang Seng Bank privatisation
delisting notice. The final version (effective 2026-09-07, 95 names) is cross-checked
to equal the constituent list in `investment/chart/hsi-participation.json` (official HSI
daily constituent report) -- see README for the match confirmation.

Price source: Yahoo Finance (`XXXX.HK`) for all constituents reachable there. One name
(0011.HK, Hang Seng Bank) was delisted 2026-01-14 and Yahoo has already dropped its
history entirely (404), so it is backfilled from Tencent's public quote API
(web.ifzq.gtimg.cn) for its full window 2024-08-01..2026-01-14. Futu OpenD
(request_history_kline, read-only quote API, no login/trade) was evaluated as the
preferred source per project convention, but its local historical-K quota/rate-limit
rejected most of the universe in this environment (free-tier "frequency too high"
errors) within the time budget of this task; Yahoo+Tencent was used instead. No account
login, order placement, or trade context was used anywhere in this script.

Breadth definition (descriptive only, matches the spirit of the existing
hsi-participation.json's `metrics.advances/declines/unchanged`, but computed on *raw*
daily close-to-close returns across the point-in-time universe, not weighted / not an
official index-point reconciliation):
  - advancers = count(close_t > close_{t-1})
  - decliners = count(close_t < close_{t-1})
  - unchanged = count(close_t == close_{t-1})
  - adv_ratio = advancers / (advancers+decliners+unchanged)
  - pct_above_ma20 = fraction of names with close_t > 20-session SMA of close (computed
    on each name's own continuous price series, independent of index membership gaps)
  - missing_symbols = constituents in that day's official universe with no price row
    for that date (e.g. trading halt, late listing, delisting) -- NOT filled with 0/NaN.

No interpolation. A constituent with no price for a session is excluded from counts and
listed in `missing_symbols`; if more than 0 names are missing the row still computes
breadth over the names that *do* have data (disclosed via `missing_symbols` length), it
is never silently treated as flat/unchanged.

Idempotent: rerunning regenerates research/data/hsi-breadth-daily.json deterministically
(except fetched_at).
"""

from __future__ import annotations

import json
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from _hsi_constituent_versions import VERSIONS  # noqa: E402

OUT_DIR = ROOT / "research/data"
TZ = timezone(timedelta(hours=8))
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36"

START, END = "2024-10-01", "2026-10-09"
MA_WINDOW = 20


def fetch_yahoo(codes: list[str], start: str, end: str) -> dict:
    import yfinance as yf
    tickers = [c.zfill(4) + ".HK" for c in codes]
    end_plus = (datetime.fromisoformat(end) + timedelta(days=1)).date().isoformat()
    df = yf.download(tickers, start=start, end=end_plus, progress=False,
                      auto_adjust=False, group_by="ticker", threads=True)
    out = {}
    for c, t in zip(codes, tickers):
        try:
            s = df[t]["Close"].dropna()
        except Exception:
            s = None
        out[c] = {} if s is None else {d.date().isoformat(): float(v) for d, v in s.items()}
    return out


def fetch_tencent(code: str, start: str, end: str) -> dict:
    sym = "hk" + code.zfill(5)
    url = f"https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={sym},day,{start},{end},2000,"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as r:
        j = json.loads(r.read().decode())
    rows = (j.get("data", {}).get(sym, {}) or {}).get("day", [])
    return {row[0]: float(row[1 + 2]) for row in rows}  # index 3 = close


def main():
    fetched_at = datetime.now(TZ).isoformat(timespec="seconds")
    all_codes = sorted({c for v in VERSIONS for c in v["codes"]}, key=int)

    print(f"Fetching Yahoo history for {len(all_codes)} HSI-ever-constituent codes...", file=sys.stderr)
    px = fetch_yahoo(all_codes, "2024-08-01", END)  # extra lookback so MA20 is valid from START

    yahoo_missing = [c for c in all_codes if not px.get(c)]
    tencent_used = []
    for c in yahoo_missing:
        try:
            t = fetch_tencent(c, "2024-08-01", END)
            if t:
                px[c] = t
                tencent_used.append(c)
        except Exception as e:  # noqa: BLE001
            print(f"  tencent fallback failed for {c}: {e}", file=sys.stderr)
    still_missing_entirely = [c for c in all_codes if not px.get(c)]

    # HK trading-day calendar: union of all price dates within [START, END]
    all_dates = sorted({d for s in px.values() for d in s if START <= d <= END})

    # Precompute sorted date list per code for MA20 (needs the code's own series regardless
    # of index membership on that date, since MA is a price-series property)
    sorted_px = {c: sorted(s.items()) for c, s in px.items()}
    idx_of = {c: {d: i for i, (d, _) in enumerate(sorted_px[c])} for c in sorted_px}

    def ma20(code: str, date: str):
        s = sorted_px[code]
        i = idx_of[code].get(date)
        if i is None or i < MA_WINDOW - 1:
            return None
        window = [v for _, v in s[i - MA_WINDOW + 1: i + 1]]
        return sum(window) / len(window)

    def version_for(date: str):
        for v in VERSIONS:
            if v["effective_from"] <= date <= v["effective_to"]:
                return v
        return None

    rows = []
    for d in all_dates:
        v = version_for(d)
        if v is None:
            rows.append({"date": d, "missing": True, "reason": "no constituent version covers this date"})
            continue
        universe = v["codes"]
        advancers = decliners = unchanged = 0
        above_ma = below_ma = 0
        missing_syms = []
        for c in universe:
            s = sorted_px.get(c, [])
            i = idx_of.get(c, {}).get(d)
            if i is None or i == 0:
                missing_syms.append(c)
                continue
            close_t = s[i][1]
            close_prev = s[i - 1][1]
            if close_t > close_prev:
                advancers += 1
            elif close_t < close_prev:
                decliners += 1
            else:
                unchanged += 1
            m = ma20(c, d)
            if m is not None:
                if close_t > m:
                    above_ma += 1
                else:
                    below_ma += 1
        counted = advancers + decliners + unchanged
        ma_counted = above_ma + below_ma
        rows.append({
            "date": d,
            "constituent_version_effective_from": v["effective_from"],
            "constituents_count": len(universe),
            "counted": counted,
            "advancers": advancers,
            "decliners": decliners,
            "unchanged": unchanged,
            "adv_ratio": round(advancers / counted, 6) if counted else None,
            "ma20_counted": ma_counted,
            "pct_above_ma20": round(above_ma / ma_counted, 6) if ma_counted else None,
            "missing_symbols": missing_syms,
            "missing": False,
            "source": "yahoo:XXXX.HK close" + (" + tencent:web.ifzq.gtimg.cn (0011.HK delisted-name backfill)" if "11" in universe else ""),
            "fetched_at": fetched_at,
        })

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = {
        "schema_version": "1.0.0",
        "dataset": "hsi_market_breadth_daily",
        "range": {"start": START, "end": END},
        "definition": {
            "advancers": "count of constituents (per that day's point-in-time HSI membership) with close_t > close_{t-1}",
            "decliners": "close_t < close_{t-1}",
            "unchanged": "close_t == close_{t-1}",
            "adv_ratio": "advancers / (advancers+decliners+unchanged), i.e. equal-name breadth, NOT weighted",
            "pct_above_ma20": "fraction of constituents with close_t above their own 20-session simple moving average (continuous price series, independent of index membership gaps)",
            "missing_symbols": "constituents in that day's official membership with no usable price row (no previous close, delisted, late listing, data gap) -- excluded from counts, not treated as flat",
            "compatibility_note": "Field names chosen to be mergeable with investment/chart/hsi-participation.json's metrics.advances/declines/unchanged (that file is a single as_of snapshot using *official* weighted/capped index-point data; this file is a daily equal-name close-to-close time series, a different and complementary measure, not a replacement).",
        },
        "constituent_universe_source": "Hang Seng Indexes Company quarterly 'Index Review Results' press releases + ad-hoc delisting notice; see scripts/_hsi_constituent_versions.py for URLs per version.",
        "constituent_versions": VERSIONS,
        "price_sources": {
            "primary": "Yahoo Finance (yfinance) XXXX.HK daily close, unadjusted",
            "fallback": "Tencent web.ifzq.gtimg.cn fqkline (used only for: " + ", ".join(tencent_used) + ")",
            "futu_opend_evaluation": "Attempted first per project convention (read-only OpenQuoteContext.request_history_kline, no login/trade). Local OpenD historical-K quota/rate-limit rejected most of the universe within this task's time budget ('获取历史K线频率太高' / quota errors), so Yahoo+Tencent was used for the full dataset instead. No trading/account functions were touched.",
        },
        "survivorship_bias_note": (
            "Membership is point-in-time (9 versions, 2024-10-01..2026-10-09), so additions/removals are reflected on "
            "their actual effective dates -- this avoids survivorship bias in universe membership. However, PRICE "
            "history for constituents is only fetched for codes that are current-OR-ever HSI members within this "
            "window; a name removed from HSI before 2024-10-01 and never re-added is NOT in this dataset even for "
            "dates before its removal would have mattered (out of window, not applicable here). Corporate actions "
            "(splits/rights issues) are handled via Yahoo's unadjusted close for the primary feed -- NOT adjusted for "
            "splits; large jumps around corporate actions should be treated with caution and are not corrected here."
        ),
        "codes_covered": all_codes,
        "yahoo_missing_codes": yahoo_missing,
        "tencent_fallback_used_for": tencent_used,
        "codes_with_no_price_data_at_all": still_missing_entirely,
        "fetched_at": fetched_at,
        "counts": {"trading_days": len(rows), "rows_with_missing_flag": sum(1 for r in rows if r.get("missing"))},
        "rows": rows,
    }
    (OUT_DIR / "hsi-breadth-daily.json").write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n")
    print(json.dumps({
        "trading_days": len(rows),
        "codes_total": len(all_codes),
        "tencent_fallback_used_for": tencent_used,
        "codes_with_no_price_data_at_all": still_missing_entirely,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
