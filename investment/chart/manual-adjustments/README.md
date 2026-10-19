# 人工调整台账（round1 C3）

收盘后人工改下一交易日 A/B/C（概率或价位）时，**不要改** annotations / daily-generated / archive / predictions 留痕，改为追加一条台账：

```bash
node scripts/manual-adjustments.cjs record --session 2026-10-20 --p A=0.2,B=0.6,C=0.2 --reason "原因" [--upper 24524.63 --lower 23737.14] [--author gavin]
node scripts/manual-adjustments.cjs score   # 写 scorecard.json：人工 vs 模型 vs 随机游走，同交易日同口径
```

- `ledger.json` 只追加，逐条 sha256 链式哈希，改旧条目会被 `verify` 拒绝。
- 同一交易日多次改动：只取当日 08:45 截止前**最后一次**（effective），其余 superseded；截止后录入（late）不计分。
- 不填 `--upper/--lower` 时沿用模型卡的价格规则（只改概率）。
