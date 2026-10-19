// Builds research/v4/rw-guard-seed.json: frozen v4 walk-forward predictions (research/v4/predictions.csv,
// candidate 'v3+overnight+struct+imp' = production v4 features/λ) and the RW-gauss reference for every session
// 2016-01..2026-10-09, plus the walk-forward guard statistics used by scripts/rw-guard.cjs GUARD.wf.
// Read-only on frozen research outputs. Run: node scripts/rw-guard-seed.cjs
'use strict';
const fs = require('node:fs'), path = require('node:path');
const root = path.join(__dirname, '..');
const DA = require('./daily-analysis.cjs'), G = require('./rw-guard.cjs');
const K = 'v3+overnight+struct+imp', KEYS = ['A', 'B', 'C'];
const S = JSON.parse(fs.readFileSync(path.join(root, 'research/v4/data/sessions.json'), 'utf8')).rows;
const H = JSON.parse(fs.readFileSync(path.join(root, 'research/v4/data/HSI.json'), 'utf8')).rows, idx = new Map(H.map((r, i) => [r.date, i]));
const lines = fs.readFileSync(path.join(root, 'research/v4/predictions.csv'), 'utf8').trim().split('\n'), head = lines[0].split(',');
const col = KEYS.map(k => head.indexOf(K + '_' + k)); if (col.some(c => c < 0)) throw Error('missing v4 columns');
const pred = new Map(lines.slice(1).map(l => { const x = l.split(','); return [x[0], col.map(c => x[c])]; }));
const round = (raw, b) => DA.boundedRound(raw, b), bounds = {min: 0.10, max: 0.85, step: 0.05};
const rows = [];
for (const s of S) {
  if (s.date < '2016-01-01') continue;
  const p = pred.get(s.date), i = idx.get(s.baseline); if (!p || p.some(v => v === '') || i == null) continue;
  const rw = G.rwGauss({bars: H.slice(0, i + 1), lower: s.lower, upper: s.upper, round, bounds});
  if (Math.abs(rw.base_close - s.base_close) > 1e-6 * s.base_close) throw Error('baseline mismatch ' + s.date);
  const v4 = round(p.map(Number), bounds);
  rows.push({date: s.date, outcome: s.outcome, v4: {A: v4[0], B: v4[1], C: v4[2]}, rw: rw.probabilities});
}
const wf = rows.filter(r => r.date <= '2025-12-31'), sk = wf.map(r => G.brier(r.rw, r.outcome) - G.brier(r.v4, r.outcome));
let cum = 0, peak = 0, mdd = 0; for (const x of sk) { cum += x; peak = Math.max(peak, cum); mdd = Math.max(mdd, peak - cum); }
const roll = []; for (let i = 59; i < sk.length; i++) roll.push(sk.slice(i - 59, i + 1).reduce((a, b) => a + b, 0) / 60);
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(p * (s.length - 1))]; };
const r6 = v => Math.round(v * 1e6) / 1e6;
const stats = {n: wf.length, mean: r6(sk.reduce((a, b) => a + b, 0) / sk.length), mdd: r6(mdd), roll60_p1: r6(q(roll, 0.01)), roll60_p5: r6(q(roll, 0.05)), roll60_p50: r6(q(roll, 0.5)), roll60_min: r6(Math.min(...roll)), frac_roll60_below0: r6(roll.filter(v => v < 0).length / roll.length)};
const out = {generated_by: 'scripts/rw-guard-seed.cjs', model: K + ' (= production rule-weights-v4 spec)', rw: G.RW_VERSION, window: [rows[0].date, rows.at(-1).date], n: rows.length,
  note: 'v4 = frozen walk-forward predictions (fit on years < Y), RW = zero-parameter Gaussian random walk; both through production boundedRound. 2026 rows are out-of-sample reference. Live reviews supersede these rows by date.',
  wf_stats_2016_2025: stats, rows};
fs.writeFileSync(path.join(root, 'research/v4/rw-guard-seed.json'), JSON.stringify(out) + '\n');
console.log(JSON.stringify({n: rows.length, window: out.window, stats}, null, 1));
