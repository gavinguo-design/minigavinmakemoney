#!/usr/bin/env python3
"""Fetch daily Southbound (港股通 沪+深) net buy history.

Primary source : Eastmoney datacenter RPT_MUTUAL_DEAL_HISTORY
                 (MUTUAL_TYPE 002=港股通(沪), 004=港股通(深), 006=南向合计)
Cross-check    : HKEX Stock Connect daily statistics JS
                 (https://www.hkex.com.hk/eng/csm/DailyStat/data_tab_daily_YYYYMMDDe.js),
                 which HKEX only keeps for roughly the most recent ~6-7 months.
HK calendar    : Futu OpenD request_trading_days (read-only quote API; no login /
                 no trade context); fallback = Yahoo ^HSI session dates.

Units: Eastmoney and HKEX both report Southbound turnover in HKD million.  Output
stores HKD 亿 (1 亿 = 100 million), currency = "HKD".

No interpolation: a HK trading day where Southbound did not trade (Mainland
holiday) is emitted with southbound_closed=true and null values.  A HK trading
day for which no source returned a row is emitted with missing=true.

Idempotent: rerunning overwrites research/data/southbound-daily.json and
research/data/southbound-crosscheck.json deterministically (except fetched_at).
"""

from __future__ import annotations

import argparse
import json
import random
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "research/data"
TZ = timezone(timedelta(hours=8))
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36"
EM_URL = "https://datacenter-web.eastmoney.com/api/data/v1/get"
HKEX_URL = "https://www.hkex.com.hk/eng/csm/DailyStat/data_tab_daily_{ymd}e.js"
TYPES = {"002": "sh", "004": "sz", "006": "total"}


def http_get(url: str, timeout: int = 30, tries: int = 3) -> str:
    """Try with environment proxy first, then direct (no proxy)."""
    last = None
    for attempt in range(tries):
        for use_proxy in (True, False):
            handlers = [] if use_proxy else [urllib.request.ProxyHandler({})]
            opener = urllib.request.build_opener(*handlers)
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            try:
                with opener.open(req, timeout=timeout) as r:
                    return r.read().decode("utf-8", "replace")
            except Exception as e:  # noqa: BLE001
                last = e
        time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"GET failed {url}: {last}")


def hk_trading_days(start: str, end: str) -> tuple[list[str], dict, str]:
    try:
        import logging
        logging.disable(logging.CRITICAL)
        from futu import OpenQuoteContext, TradeDateMarket
        q = OpenQuoteContext(host="127.0.0.1", port=11111)
        try:
            ret, data = q.request_trading_days(market=TradeDateMarket.HK, start=start, end=end)
        finally:
            q.close()
        if ret == 0:
            days = sorted(d["time"] for d in data)
            kinds = {d["time"]: d.get("trade_date_type") for d in data}
            return days, kinds, "futu-opend request_trading_days(HK)"
    except Exception:  # noqa: BLE001
        pass
    import yfinance as yf
    end_plus = (date.fromisoformat(end) + timedelta(days=1)).isoformat()
    df = yf.download("^HSI", start=start, end=end_plus, progress=False, auto_adjust=False)
    days = sorted(d.date().isoformat() for d in df.index)
    return days, {}, "yahoo ^HSI session dates"


def fetch_eastmoney(start: str, end: str) -> dict:
    out: dict[str, dict] = {}
    for mtype, key in TYPES.items():
        page = 1
        while True:
            params = {
                "reportName": "RPT_MUTUAL_DEAL_HISTORY", "columns": "ALL", "source": "WEB",
                "sortColumns": "TRADE_DATE", "sortTypes": "1", "pageSize": "500", "pageNumber": str(page),
                "filter": f'(MUTUAL_TYPE="{mtype}")(TRADE_DATE>=\'{start}\')(TRADE_DATE<=\'{end}\')',
            }
            j = json.loads(http_get(EM_URL + "?" + urllib.parse.urlencode(params)))
            res = j.get("result") or {}
            for r in res.get("data") or []:
                d = r["TRADE_DATE"][:10]
                out.setdefault(d, {})[key] = {
                    "net": r.get("NET_DEAL_AMT"), "buy": r.get("BUY_AMT"),
                    "sell": r.get("SELL_AMT"), "turnover": r.get("DEAL_AMT"),
                }
            if page >= (res.get("pages") or 1):
                break
            page += 1
            time.sleep(0.5)
    return out


def fetch_hkex(d: str):
    """Return {'sh': {...}, 'sz': {...}} in HKD mil, or None if file not kept by HKEX."""
    try:
        t = http_get(HKEX_URL.format(ymd=d.replace("-", "")), tries=2)
    except RuntimeError:
        return None
    if not t.lstrip().startswith("tabData"):
        return None
    j = json.loads(t[t.index("["):].strip().rstrip(";"))
    res = {}
    for m in j:
        mk = {"SSE Southbound": "sh", "SZSE Southbound": "sz"}.get(m["market"])
        if not mk:
            continue
        tab = m["content"][0]["table"]
        cols = tab["schema"][0]
        vals = [x["td"][0][0] for x in tab["tr"]]
        row = dict(zip(cols, vals))
        num = lambda s: float(s.replace(",", ""))  # noqa: E731
        buy, sell = num(row["Buy Turnover"]), num(row["Sell Turnover"])
        res[mk] = {"date": m["date"], "trading_day_flag": m["tradingDay"], "buy": buy, "sell": sell,
                   "turnover": num(row["Total Turnover"]), "net": round(buy - sell, 2)}
    return res


def to_yi(v):
    return None if v is None else round(v / 100.0, 4)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", default="2024-10-01")
    ap.add_argument("--end", default="2026-10-09")
    ap.add_argument("--crosscheck-n", type=int, default=10)
    ap.add_argument("--seed", type=int, default=20261012)
    a = ap.parse_args()
    fetched_at = datetime.now(TZ).isoformat(timespec="seconds")

    days, kinds, cal_src = hk_trading_days(a.start, a.end)
    em = fetch_eastmoney(a.start, a.end)

    rows, missing, closed = [], [], []
    for d in days:
        e = em.get(d)
        base = {"date": d, "hk_session_type": kinds.get(d), "currency": "HKD", "unit": "亿港元",
                "source": "eastmoney:RPT_MUTUAL_DEAL_HISTORY", "fetched_at": fetched_at}
        if e is None:
            # Eastmoney publishes no row on HK days when Southbound is shut; we cannot
            # distinguish that from a data gap without a second source, so mark missing.
            rows.append({**base, "sh_net": None, "sz_net": None, "total_net": None,
                         "southbound_closed": None, "missing": True})
            missing.append(d)
            continue
        sh, sz, tot = e.get("sh", {}), e.get("sz", {}), e.get("total", {})
        is_closed = all(not (x.get("turnover") or 0) for x in (sh, sz)) and not (tot.get("turnover") or 0)
        if is_closed:
            rows.append({**base, "sh_net": None, "sz_net": None, "total_net": None,
                         "southbound_closed": True, "missing": False})
            closed.append(d)
            continue
        sh_net, sz_net = to_yi(sh.get("net")), to_yi(sz.get("net"))
        tot_net = to_yi(tot.get("net"))
        if tot_net is None and sh_net is not None and sz_net is not None:
            tot_net = round(sh_net + sz_net, 4)
        rows.append({**base, "sh_net": sh_net, "sz_net": sz_net, "total_net": tot_net,
                     "sh_buy": to_yi(sh.get("buy")), "sh_sell": to_yi(sh.get("sell")),
                     "sz_buy": to_yi(sz.get("buy")), "sz_sell": to_yi(sz.get("sell")),
                     "total_turnover": to_yi(tot.get("turnover")),
                     "southbound_closed": False, "missing": any(v is None for v in (sh_net, sz_net, tot_net))})
        if rows[-1]["missing"]:
            missing.append(d)

    # Eastmoney rows not on the HK calendar (should be none)
    extra = sorted(set(em) - set(days))

    # Resolve "missing" days with HKEX where HKEX still keeps the file
    for r in rows:
        if r["missing"]:
            hk = fetch_hkex(r["date"])
            if hk and all(hk.get(k, {}).get("turnover", 0) == 0 for k in ("sh", "sz")):
                r.update(southbound_closed=True, missing=False, source="hkex:csm-daily-stat (zero turnover)")
    missing = [r["date"] for r in rows if r["missing"]]
    closed = [r["date"] for r in rows if r["southbound_closed"]]

    # Cross-check: random sample of open days; HKEX only retains recent months.
    open_days = [r["date"] for r in rows if r["southbound_closed"] is False and not r["missing"]]
    rng = random.Random(a.seed)
    probe = sorted(open_days, reverse=True)
    hkex_window = []
    for d in probe:  # find HKEX retention window by probing back from latest
        if fetch_hkex(d) is None:
            break
        hkex_window.append(d)
        if len(hkex_window) > 400:
            break
    sample = sorted(rng.sample(hkex_window, min(a.crosscheck_n, len(hkex_window))))
    old_probe = sorted(rng.sample([d for d in open_days if d not in hkex_window], 5))
    checks = []
    byd = {r["date"]: r for r in rows}
    for d in sample:
        hk = fetch_hkex(d)
        r = byd[d]
        hk_sh, hk_sz = to_yi(hk["sh"]["net"]), to_yi(hk["sz"]["net"])
        checks.append({
            "date": d,
            "eastmoney": {"sh_net": r["sh_net"], "sz_net": r["sz_net"], "total_net": r["total_net"]},
            "hkex": {"sh_net": hk_sh, "sz_net": hk_sz, "total_net": round(hk_sh + hk_sz, 4)},
            "diff_yi": {"sh": round(r["sh_net"] - hk_sh, 4), "sz": round(r["sz_net"] - hk_sz, 4),
                        "total": round(r["total_net"] - (hk_sh + hk_sz), 4)},
        })
    for r in rows:
        if any(c["date"] == r["date"] for c in checks):
            r["crosschecked_with"] = "hkex:csm-daily-stat"

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = {
        "schema_version": "1.0.0",
        "dataset": "southbound_daily_net_buy",
        "range": {"start": days[0], "end": days[-1]},
        "currency": "HKD", "unit": "亿港元 (HKD 100 million)",
        "definition": "net = buy turnover - sell turnover of Southbound Stock Connect; sh=港股通(沪), sz=港股通(深), total=南向合计 (Eastmoney MUTUAL_TYPE 006)",
        "calendar_source": cal_src,
        "sources": {
            "primary": "https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_MUTUAL_DEAL_HISTORY (MUTUAL_TYPE 002/004/006)",
            "crosscheck": "https://www.hkex.com.hk/eng/csm/DailyStat/data_tab_daily_YYYYMMDDe.js",
        },
        "fetched_at": fetched_at,
        "counts": {"hk_trading_days": len(days), "southbound_open": len(open_days),
                   "southbound_closed": len(closed), "missing": len(missing)},
        "southbound_closed_dates": closed,
        "missing_dates": missing,
        "eastmoney_dates_not_in_hk_calendar": extra,
        "rows": rows,
    }
    (OUT_DIR / "southbound-daily.json").write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n")
    cc = {"fetched_at": fetched_at, "seed": a.seed,
          "hkex_retention_window": {"from": min(hkex_window) if hkex_window else None,
                                     "to": max(hkex_window) if hkex_window else None,
                                     "days": len(hkex_window)},
          "older_dates_without_second_official_source": old_probe,
          "max_abs_diff_yi": max((abs(v) for c in checks for v in c["diff_yi"].values()), default=None),
          "checks": checks}
    (OUT_DIR / "southbound-crosscheck.json").write_text(json.dumps(cc, ensure_ascii=False, indent=1) + "\n")
    print(json.dumps({"counts": out["counts"], "missing": missing, "closed_n": len(closed), "extra": extra,
                      "hkex_window": cc["hkex_retention_window"], "max_abs_diff_yi": cc["max_abs_diff_yi"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
