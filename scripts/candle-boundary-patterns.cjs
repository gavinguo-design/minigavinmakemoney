// research/candle-boundary: point-in-time Nison pattern on each HSI bar.
// For bar index b we call CandlePatterns.detect(bars[0..b]) (prefix only, no future bars) with production CFG,
// and keep the pattern whose index === b. Also checks that a single full-series run gives identical results
// (patterns.js has no look-ahead), as a sanity check only.
'use strict';
const fs = require('node:fs'), path = require('node:path');
const root = path.join(__dirname, '..');
const CP = require('../investment/chart/patterns.js');
const hsi = JSON.parse(fs.readFileSync(path.join(root, 'research/v4/data/HSI.json'), 'utf8'));
const bars = hsi.rows.map(r => ({open: r.open, high: r.high, low: r.low, close: r.close, time: r.date}));
const out = {};
for (let b = 0; b < bars.length; b++) {
  const res = CP.detect(bars.slice(0, b + 1));
  const hit = res.find(p => p.index === b);
  out[bars[b].time] = hit ? {id: hit.id, direction: hit.direction, strength: hit.strength} : null;
}
const full = CP.detect(bars); const fullMap = {};
for (const p of full) fullMap[bars[p.index].time] = p.id;
let mism = 0;
for (const d of Object.keys(out)) if ((out[d] && out[d].id) !== (fullMap[d] || null) && !(out[d] == null && fullMap[d] == null)) mism++;
fs.writeFileSync(path.join(root, 'research/candle-boundary/patterns-by-date.json'),
  JSON.stringify({generated_by: 'scripts/candle-boundary-patterns.cjs', cfg: CP.CFG, hsi_rows_sha256: hsi.rows_sha256, prefix_vs_full_mismatch: mism, n: bars.length, patterns: out}));
const cnt = {}; for (const v of Object.values(out)) if (v) cnt[v.id] = (cnt[v.id] || 0) + 1;
console.log(JSON.stringify({n: bars.length, prefix_vs_full_mismatch: mism, counts: cnt}));
