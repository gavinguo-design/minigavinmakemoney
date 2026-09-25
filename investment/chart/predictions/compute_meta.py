#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
compute_meta.py — 预测元数据自动计算（傻瓜基准 baselines + 市场状态 marketRegime）

用途：每次发布新预测时运行本脚本，把输出的 JSON 片段填入
      investment/chart/predictions/log.json 对应预测记录的
      baselines / marketRegime 字段。全程机械规则，无 AI 介入，
      保证基准判断可复现、可审计。

数据源：https://minigavin.com/api/kline?interval=1d&range=1y（Yahoo Finance ^HSI 代理）

===== 判断规则（人工审查用，改规则请同步改此注释）=====

【baselines.naiveTrend 简单趋势基准】
  规则：昨日涨跌方向延续。
  最新收盘 > 前一日收盘 → 看涨；否则 → 看跌。
  （这是最傻的"惯性"策略，作为模型对照的下限基准之一）

【baselines.ma20Rule MA20规则基准】
  规则：价格与20日均线相对位置。
  最新收盘 > MA20 → 看涨；否则 → 看跌。
  （最常见的趋势跟随规则，作为模型对照的技术基准）

【marketRegime.trend 趋势状态】
  规则：MA20 斜率 + 价格相对 MA20 位置。
  slope = (MA20_今 - MA20_5日前) / MA20_5日前
  slope > +0.3% 且 收盘 > MA20 → 上涨趋势
  slope < -0.3% 且 收盘 < MA20 → 下跌趋势
  其余情况 → 横盘震荡

【marketRegime.volatility 波动状态】
  规则：近20日平均日振幅 vs 近120日平均日振幅。
  日振幅 = (high - low) / close
  ratio = 近20日均值 / 近120日均值
  ratio > 1.25 → 高波动；ratio < 0.75 → 低波动；其余 → 正常波动
"""

import json
import urllib.request

API = "https://minigavin.com/api/kline?interval=1d&range=1y"


def fetch_kline(url=API):
    req = urllib.request.Request(url, headers={"User-Agent": "miniGG-meta/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def clean_series(data):
    """去掉任一字段为 null 的 bar，返回 (closes, highs, lows) 对齐数组。"""
    o, h, l, c = data["open"], data["high"], data["low"], data["close"]
    closes, highs, lows = [], [], []
    for i in range(len(c)):
        if o[i] is None or h[i] is None or l[i] is None or c[i] is None:
            continue
        closes.append(c[i]); highs.append(h[i]); lows.append(l[i])
    return closes, highs, lows


def sma(arr, n, idx=None):
    """arr 末尾（或 idx 处，含）向前 n 个的简单均值；数据不足返回 None。"""
    if idx is None:
        idx = len(arr) - 1
    if idx + 1 < n:
        return None
    window = arr[idx - n + 1: idx + 1]
    return sum(window) / n


def compute_baselines(closes):
    """傻瓜基准：简单趋势延续 + MA20规则。规则见文件头注释。"""
    last, prev = closes[-1], closes[-2]
    naive = "看涨" if last > prev else "看跌"
    ma20 = sma(closes, 20)
    ma20_rule = "看涨" if (ma20 is not None and last > ma20) else "看跌"
    return {
        "naiveTrend": {
            "judgment": naive,
            "basis": "昨日涨跌方向延续（最新收盘 %.1f vs 前日收盘 %.1f）" % (last, prev),
        },
        "ma20Rule": {
            "judgment": ma20_rule,
            "basis": "价格与MA20相对位置（最新收盘 %.1f vs MA20 %.1f）" % (last, ma20 if ma20 else float("nan")),
        },
    }


def compute_regime(closes, highs, lows):
    """市场状态标签：趋势（MA20斜率+价格位置）+ 波动（20日/120日振幅比）。规则见文件头注释。"""
    last = closes[-1]
    ma20_now = sma(closes, 20)
    ma20_5ago = sma(closes, 20, idx=len(closes) - 6)
    if ma20_now is None or ma20_5ago is None:
        trend = "数据不足"
        slope_pct = None
    else:
        slope_pct = (ma20_now - ma20_5ago) / ma20_5ago * 100
        if slope_pct > 0.3 and last > ma20_now:
            trend = "上涨趋势"
        elif slope_pct < -0.3 and last < ma20_now:
            trend = "下跌趋势"
        else:
            trend = "横盘震荡"

    amp = [(highs[i] - lows[i]) / closes[i] for i in range(len(closes))]
    a20 = sma(amp, 20)
    a120 = sma(amp, 120)
    if a20 is None or a120 is None or a120 == 0:
        vol = "数据不足"
        ratio = None
    else:
        ratio = a20 / a120
        vol = "高波动" if ratio > 1.25 else ("低波动" if ratio < 0.75 else "正常波动")

    return {
        "trend": trend,
        "volatility": vol,
        "basis": "MA20斜率5日%s%% + 收盘%s于MA20(%.0f)；20日均振幅/120日均振幅=%s" % (
            ("%.2f" % slope_pct) if slope_pct is not None else "?",
            "高" if (ma20_now and last > ma20_now) else "低",
            ma20_now or 0,
            ("%.2f" % ratio) if ratio is not None else "?",
        ),
    }


def main():
    data = fetch_kline()
    closes, highs, lows = clean_series(data)
    out = {
        "baselines": compute_baselines(closes),
        "marketRegime": compute_regime(closes, highs, lows),
    }
    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
