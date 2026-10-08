const test = require('node:test');
const assert = require('node:assert/strict');
const { parseOrder, processQueue } = require('../scripts/process-trade-uploads.cjs');

const upload = { file: 'investment/chart/uploads/20261008-135211.png', uploadedAt: '2026-10-08T13:52:11+08:00', status: 'pending' };
const ocr = `65702 恒指法兴九一熊N.P\n0.042 +55.56%\n订单状态 名称代码 数量/价格 下单时间\n买入 恒指法兴九一熊N.P 120,000 10/08\n全部成交 65702 0.035 11:21:28 (香港)`;

test('OCR records the execution row, not the product quote, and keeps bear-product direction distinct', () => {
  const result = parseOrder(ocr, upload);
  assert.equal(result.trade.symbol, '65702.HK');
  assert.equal(result.trade.openPrice, 0.035);
  assert.equal(result.trade.size, '120000份');
  assert.equal(result.trade.openDate, '2026-10-08');
  assert.equal(result.trade.openTime, '11:21:28+08:00');
  assert.equal(result.trade.direction, 'long');
  assert.equal(result.trade.underlyingDirection, 'short');
});

test('ambiguous OCR leaves the image in review instead of inventing a trade', () => {
  const queue = [{ ...upload }];
  const ledger = { trades: [], stats: {} };
  assert.equal(processQueue(queue, ledger, () => ocr.replace('0.035', '')), true);
  assert.equal(queue[0].status, 'needs_review');
  assert.equal(ledger.trades.length, 0);
  assert.match(queue[0].note, /成交价/);
  assert.equal(parseOrder(ocr.replace('买入', '卖出'), upload).trade, undefined);
});

test('repeated processing is idempotent and leaves settled performance intact', () => {
  const queue = [{ ...upload }];
  const ledger = { trades: [{ status: 'closed', pnl: 18 }], stats: {} };
  assert.equal(processQueue(queue, ledger, () => ocr), true);
  assert.equal(ledger.trades.length, 2);
  assert.equal(ledger.stats.totalPnl, 18);
  assert.equal(ledger.stats.winRate, 100);
  assert.equal(processQueue(queue, ledger, () => { throw Error('should not OCR twice'); }), false);
  assert.equal(ledger.trades.length, 2);
});
