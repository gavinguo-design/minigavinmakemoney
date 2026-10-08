// Read uploaded order screenshots with local OCR in GitHub Actions. Never infer
// an execution price from the product quote or turn a sell into a new short.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const queuePath = path.join(root, 'investment/chart/uploads/pending.json');
const tradesPath = path.join(root, 'investment/chart/trades.json');

function parseOrder(text, upload) {
  const lines = String(text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const joined = lines.join(' ');
  const buy = /买\s*入|買\s*入/.test(joined);
  const sell = /卖\s*出|賣\s*出/.test(joined);
  if (!buy || sell) return { reason: '仅能自动登记单笔买入成交；卖出或多笔交易须人工核对' };
  if (!/全\s*部\s*成\s*交|已\s*成\s*交/.test(joined)) return { reason: '未识别到已成交状态' };
  const codes = [...new Set((joined.match(/(?<!\d)\d{5}(?!\d)/g) || []))];
  if (codes.length !== 1) return { reason: '证券代码无法唯一确定' };
  const code = codes[0];
  const qtyMatches = [...joined.matchAll(/(?<!\d)(\d{1,3}(?:,\d{3})+)(?!\d)/g)]
    .filter(m => Number(m[1].replaceAll(',', '')) >= 100);
  if (qtyMatches.length !== 1) return { reason: '成交数量无法唯一确定' };
  const qty = Number(qtyMatches[0][1].replaceAll(',', ''));
  // The execution price must sit beside the order quantity. Product quotes,
  // indicator values and the screenshot time are never used as a fallback.
  const tail = joined.slice(qtyMatches[0].index + qtyMatches[0][0].length, qtyMatches[0].index + qtyMatches[0][0].length + 95);
  const prices = [...tail.matchAll(/(?<![\d.])(0\.\d{2,4})(?!\d)/g)];
  if (prices.length !== 1) return { reason: '成交价与数量未能可靠配对' };
  const price = Number(prices[0][1]);
  const dateMatch = tail.match(/(?<!\d)(\d{1,2})\s*[\/-]\s*(\d{1,2})(?!\d)/);
  const timeMatch = tail.match(/(?<!\d)(\d{1,2}):(\d{2}):(\d{2})(?!\d)/);
  if (!dateMatch || !timeMatch) return { reason: '成交日期或时间未识别' };
  const uploadDate = String(upload.uploadedAt || '').slice(0, 10);
  const year = Number(uploadDate.slice(0, 4));
  const mm = Number(dateMatch[1]);
  const dd = Number(dateMatch[2]);
  const date = `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  const validDate = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(year) || Number.isNaN(validDate.getTime()) || validDate.toISOString().slice(0, 10) !== date || date > uploadDate) return { reason: '成交日期与上传日期不符' };
  const hh = Number(timeMatch[1]);
  if (hh > 23 || Number(timeMatch[2]) > 59 || Number(timeMatch[3]) > 59) return { reason: '成交时间无效' };
  const nameLine = lines.find(line => line.includes(code) && /熊|牛/.test(line))
    || lines.find(line => /熊|牛/.test(line) && /N[.．]P|恒指|恆指/.test(line) && !/[….]{2,}/.test(line)) || '';
  const name = nameLine.replace(new RegExp(code, 'g'), '').trim();
  if (!name || !/熊|牛/.test(name)) return { reason: '产品名称及方向无法核实' };
  const bear = /熊/.test(name);
  const stamp = path.basename(upload.file).match(/^(\d{8})-(\d{6})\.(?:png|jpe?g|webp)$/i);
  if (!stamp) return { reason: '截图文件名无效' };
  return { trade: {
    id: `T${stamp[1]}-upload-${stamp[2]}`, status: 'open', symbol: `${code}.HK`, name,
    direction: 'long', instrumentType: bear ? 'bear_certificate' : 'bull_certificate',
    underlyingDirection: bear ? 'short' : 'long', openDate: date,
    openTime: `${String(hh).padStart(2, '0')}:${timeMatch[2]}:${timeMatch[3]}+08:00`,
    openPrice: price, size: `${qty}份`,
    note: '截图 OCR 自动登记买入成交；请核对交易明细。截图未见卖出。',
    sourceScreenshot: upload.file, pnl: null, pnlPct: null,
  } };
}

function processQueue(queue, ledger, recognize) {
  let changed = false;
  for (const upload of queue) {
    if (upload.status !== 'pending') continue;
    const safePath = /^investment\/chart\/uploads\/[0-9]{8}-[0-9]{6}\.(?:png|jpe?g|webp)$/i.test(upload.file || '');
    if (!safePath) { upload.status = 'needs_review'; upload.note = '截图路径无法核对'; changed = true; continue; }
    const existing = ledger.trades.find(t => t.sourceScreenshot === upload.file);
    if (existing) { upload.status = 'processed'; upload.tradeId = existing.id; changed = true; continue; }
    const result = parseOrder(recognize(path.join(root, upload.file)), upload);
    if (!result.trade) {
      upload.status = 'needs_review'; upload.note = result.reason;
    } else {
      ledger.trades.push(result.trade);
      upload.status = 'processed'; upload.tradeId = result.trade.id;
      upload.note = '已从成交行自动提取并入账；请核对明细。';
    }
    changed = true;
  }
  if (changed) {
    const closed = ledger.trades.filter(t => t.status === 'closed');
    const wins = closed.filter(t => t.pnl > 0).length;
    ledger.stats = {
      total: ledger.trades.length, wins,
      losses: closed.filter(t => t.pnl < 0).length,
      winRate: closed.length ? Math.round(wins / closed.length * 10000) / 100 : null,
      totalPnl: closed.length ? Math.round(closed.reduce((n, t) => n + (Number(t.pnl) || 0), 0) * 100) / 100 : null,
    };
  }
  return changed;
}

function recognize(imagePath) {
  if (!fs.existsSync(imagePath)) throw new Error('Uploaded image missing; keep queue pending for retry');
  const out = spawnSync('tesseract', [imagePath, 'stdout', '-l', 'chi_sim+eng', '--psm', '11'], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  if (out.error || out.status !== 0) throw new Error('OCR engine unavailable; queue remains pending');
  return out.stdout;
}

function main() {
  const queue = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
  const ledger = JSON.parse(fs.readFileSync(tradesPath, 'utf8'));
  if (!Array.isArray(queue) || !Array.isArray(ledger.trades)) throw new Error('Invalid upload queue or trade ledger');
  if (!processQueue(queue, ledger, recognize)) return;
  fs.writeFileSync(queuePath, JSON.stringify(queue, null, 2) + '\n');
  fs.writeFileSync(tradesPath, JSON.stringify(ledger, null, 2) + '\n');
}

if (require.main === module) main();
module.exports = { parseOrder, processQueue };
