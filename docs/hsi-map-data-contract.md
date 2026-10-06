# 恒指交易地图：数据生成与验收规范

本次前端升级不修改历史存档、预测日志、交易记录，也不发布。外部 cron / 数据生成 Agent 不在本仓库中，需按以下接口更新；字段缺失时页面显示待验证，不自动补造数据。

## 分析版本与情景状态

- `annotations.meta.analysis_id`：不可变版本标识；任何规则、阈值、止损或目标变动均产生新版本。
- `forecast.applicable_date`：地图适用的香港交易日期；`baseDate` 是计算基准，不是适用日期。
- `forecast.updatedAt`：包含时区的生成时间。旧格式兼容仅限 status 中 `analysis_updated_at` 与其严格相等。
- 每个情景提供稳定 `id`（A/B/C 等）；`rr.entry/target/stop/direction` 按实际计划入场计算。
- `scenario_status.analysis_id` 必须与地图一致；`conditions_date` 必须等于适用日期；`updated_at` 必须是源数据时间，不得是单纯文件下载时间。
- `judgment_mode` 只允许 `intraday_preview` / `close_final`。盘中条件最多10分钟；午休应更新至午盘；正式确认必须在该交易日收盘检查时间之后（普通16:10，半日12:10）。
- 条件 `met` 使用 true / false / null；null 表示数据缺失。`role: confirm` 为确认条件，其余为结构触发。页面根据条件重算计数，不相信失配的汇总状态。

## 资金、成交量与行情

- 南向资金使用 `metrics.southbound_net_yi`、`southbound_updated_at`、`southbound_available: true`。必须为条件日期的真实源记录；通道关闭写 available=false、数值null，不能沿用上一交易日资金。当前显式拦截2026年10月1–7日，生产端应维护完整南向通日历。
- 盘中量比要求 `metrics.volume_ratio_basis: same_time`，比较同一累计时间窗口、同一数据源和同一单位，并记录计算分子/分母、窗口、参考天数及源时间。缺少同时间段口径时量能条件为null。收盘全日比较可另用 full_day。
- 富途日线 volume 承载成交额亿元，Yahoo volume 为成交股数。不得拼接为一个量能比较样本。实时数据只按当前同源口径合并。
- 实时报价 `ts` 是真实行情 Unix 秒。获取时间不能替代它。Yahoo代理保留 `regularMarketTime`；昨日收盘优先 previousClose，缺失时由前一交易日实际K线推导，不能用区间起点 chartPreviousClose。
- 富途日线 updated_at 和最后K线日期须有效，盘中超过15分钟则尝试Yahoo。无有效行情时应呈现缺失，不延用旧数据声称实时。
- 未收盘的日/周/分钟K线保留 partial=true，指标副图可预览，但确认指标、摆动点、形态和缺口统计只使用已收盘数据。

## 技术分析口径

RSI14、ATR14采用Wilder平滑；MACD采用SMA种子的EMA(12,26,9)，柱体DIF−DEA，不乘2。指标预热不足显示空值。摆动高低点需左右各2根已收盘K线确认。历史模式计算截至冻结基准日，不能用后续K线确认当时的结构。

关键位建议补充 `formedAt`。未提供时只能展示当前窗口内的触碰统计，不能声称已正式失效。容差默认0.1ATR，ATR不足回退价格0.1%；此规则是观察尺度，不是交易指令。缺口为完整高低价跳空，并分别记录未回补、部分回补、已回补。

香港现金市场日历覆盖2026/2027年（含半日）；未知年份不猜测交易日。维护来源：
- https://www.hkex.com.hk/-/media/HKEX-Market/Services/Circulars-and-Notices/Participant-and-Members-Circulars/SEHK/2025/ce_SEHK_CT_075_2025.pdf
- https://www.hkex.com.hk/-/media/HKEX-Market/Services/Circulars-and-Notices/Participant-and-Members-Circulars/SEHK/2026/ce_SEHK_CT_077_2026.pdf

本地图使用现金指数日历，期货夜盘、合约换月和基差需独立数据与规则。

## 客观复盘（生成端待实现）

到期只表示分析窗口结束，不等于已完成复盘。未来评价记录须绑定 analysis_id、scenario_id、适用日、评价窗口、数据源、规则版本与生成时间；逐项留存结构触发、入场、止损、目标、失效时点以及MFE/MAE。先确定收盘确认后何时可成交、费用、滑点与最大持有日，再统计结果。同一根K线同时触及止损和目标且无更细数据时记 ambiguous，不能按有利顺序结算。未触发 / 已触发未成交 / 赢 / 输 / 到期 / 歧义分别计数，不混作胜率分母。

本次没有回填历史胜率、制造交易结果或实施自动下单。现有主观情景权重不得转换为历史命中率。

## 本地验证

运行 `node --test tests/chart-analysis.cjs tests/kline-api.cjs`。生产发布仍通过原Cloudflare链路，但本次不推送代码、不触发部署。
