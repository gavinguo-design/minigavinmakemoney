# minigavinmakemoney
投资雷达 · 港股/美股/A股每日分析

## 历史分析存档机制（/investment/chart/archive/）

- `archive/YYYY-MM-DD.json`：每天盘前冻结时把当天完整 `annotations.json` 快照存档一份，**生成后不可修改**（与预测留痕同一原则）。
- `archive/index.json`：存档日期索引数组 `["2026-09-25", ...]`，前端靠它渲染日期切换器。
- 页面 `/investment/chart/` 图表上方提供「📅 查看历史分析」切换器：选中某历史日期后，判断卡/价位线/情景区域/playbook 等全部切到当天冻结的内容，K线保持最新真实走势，情景区域锚定在存档基准日 → 历史预测与后来真实走势直接叠加，用于反向验证分析准确度。
- **每日维护**：盘前 cron 需执行两步 —— ① `cp annotations.json archive/$(date +%F).json`；② 把该日期追加进 `archive/index.json` 数组（去重）。
