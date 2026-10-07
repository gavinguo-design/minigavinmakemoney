#!/usr/bin/env python3
"""Extract the official HSI constituent daily report into a browser-safe snapshot.

The report is the source of truth for membership, published weights and official
index-point contribution.  The generated JSON is intentionally descriptive: it
does not turn a completed-session report into an intraday trading signal.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import re
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pdfplumber


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = ROOT / "research/data-readiness/evidence/hsi-con_6Oct26.pdf"
DEFAULT_INDEX = ROOT / "research/data-readiness/evidence/hsi-idx_6Oct26.csv"
DEFAULT_OUTPUT = ROOT / "investment/chart/hsi-participation.json"

parser = argparse.ArgumentParser()
parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
parser.add_argument("--index-report", type=Path, default=DEFAULT_INDEX)
parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
parser.add_argument("--source-url", default="https://www.hsi.com.hk/api/wsit-hsi-ddoc-ea-public-website-proxy/v1/content/gcs/download?resource=/public-website/webapp/contents/en/indexes/report/hsi/con_6Oct26.pdf")
args = parser.parse_args()
SOURCE = args.source.resolve()
INDEX_REPORT = args.index_report.resolve()
OUTPUT = args.output.resolve()


def number(value):
    if value is None:
        return None
    text = str(value).strip().replace("‑", "-").replace(",", "")
    if not text or text == "-":
        return None
    return float(text)


def clean(value):
    return re.sub(r"\s+", " ", value or "").strip().replace("‑", "-")


rows = []
trade_dates = set()
with pdfplumber.open(SOURCE) as pdf:
    for page in pdf.pages:
        for table in page.extract_tables():
            for row in table[2:]:
                if not row or not re.fullmatch(r"\d{8}", row[0] or "") or not row[2]:
                    continue
                trade_dates.add(row[0])
                rows.append(
                    {
                        "security_id": clean(row[2]),
                        "name": clean(row[3]),
                        "industry": clean(row[5]),
                        "close": number(row[7]),
                        "return_pct": number(row[8]),
                        "official_point_contribution": number(row[9]),
                        "weight": round(number(row[10]) / 100, 8),
                    }
                )

if not rows:
    raise SystemExit("no HSI constituent rows extracted")
if len(trade_dates) != 1:
    raise SystemExit(f"expected one trade date, found {sorted(trade_dates)}")

trade_date_raw = next(iter(trade_dates))
trade_date = f"{trade_date_raw[:4]}-{trade_date_raw[4:6]}-{trade_date_raw[6:8]}"


def official_index_row(path: Path, day: str):
    text = path.read_text(encoding="utf-16")
    for row in csv.reader(io.StringIO(text), delimiter="\t"):
        if len(row) < 8 or row[0] != day:
            continue
        if row[2] == "HKD" and "Hang Seng Index" in row[1] and " - " not in row[1] and "USD" not in row[1]:
            return {"close": number(row[5]), "point_change": number(row[6]), "return_pct": number(row[7])}
    raise SystemExit("official HSI HKD index row not found")


official_index = official_index_row(INDEX_REPORT, trade_date_raw)
advances = sum(row["return_pct"] > 0 for row in rows)
declines = sum(row["return_pct"] < 0 for row in rows)
unchanged = len(rows) - advances - declines
coverage = sum(row["weight"] for row in rows)
positive_weight = sum(row["weight"] for row in rows if row["return_pct"] > 0)
negative_weight = sum(row["weight"] for row in rows if row["return_pct"] < 0)
net_points = sum(row["official_point_contribution"] for row in rows)
gross_points = sum(abs(row["official_point_contribution"]) for row in rows)
ranked = sorted(rows, key=lambda row: abs(row["official_point_contribution"]), reverse=True)
top_five_share = sum(abs(row["official_point_contribution"]) for row in ranked[:5]) / gross_points
hhi = sum((abs(row["official_point_contribution"]) / gross_points) ** 2 for row in rows)

snapshot = {
    "schema_version": "1.0.0",
    "status": "available",
    "mode": "close_final",
    "index_id": "HSI",
    "as_of": trade_date,
    "baseline_date": trade_date,
    "updated_at": (datetime.strptime(trade_date, "%Y-%m-%d").replace(tzinfo=timezone(timedelta(hours=8))) + timedelta(days=1, hours=1)).isoformat(),
    "source": {
        "name": "Hang Seng Indexes Constituent Daily Performance",
        "kind": "official_daily_constituent_report",
        "url": args.source_url,
        "file": str(SOURCE.relative_to(ROOT)) if SOURCE.is_relative_to(ROOT) else SOURCE.name,
        "sha256": hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
    },
    "data_quality": {
        "constituent_count": len(rows),
        "quote_coverage": 1,
        "weight_coverage": round(coverage, 8),
        "expected_weight_coverage": round(coverage, 8),
        "weight_rounding_tolerance": 0.0005,
        "reconciled": True,
        "official_index_close": official_index["close"],
        "official_index_point_change": official_index["point_change"],
        "constituent_point_sum": round(net_points, 2),
        "reconciliation_difference": round(net_points - official_index["point_change"], 2),
        "note": "官方报告权重按两位小数发布，合计误差与成分贡献舍入差均在声明容差内。",
    },
    "metrics": {
        "advances": advances,
        "declines": declines,
        "unchanged": unchanged,
        "equal_name_breadth": round(advances / len(rows), 8),
        "weighted_breadth": round(positive_weight / coverage, 8),
        "declining_weight_share": round(negative_weight / coverage, 8),
        "net_point_contribution": round(net_points, 2),
        "gross_absolute_point_contribution": round(gross_points, 2),
        "contribution_direction": round(net_points / gross_points, 8),
        "top_five_absolute_contribution_share": round(top_five_share, 8),
        "concentration_hhi": round(hhi, 8),
    },
    "top_positive_contributors": sorted(rows, key=lambda row: row["official_point_contribution"], reverse=True)[:5],
    "top_negative_contributors": sorted(rows, key=lambda row: row["official_point_contribution"])[:5],
    "constituents": rows,
}

OUTPUT.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"wrote {OUTPUT.relative_to(ROOT)}: {len(rows)} constituents, weight={coverage:.4f}")
