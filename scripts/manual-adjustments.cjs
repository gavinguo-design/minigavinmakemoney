// Manual adjustment ledger (round1 C3). After the close, a human may rewrite next session's A/B/C (probabilities and/or
// price rules). Every rewrite is appended here — never by editing published analyses, archives or prediction logs.
//   ledger: investment/chart/manual-adjustments/ledger.json  {schema, entries:[...]}, append-only, each entry hash-chained.
//   score : scores the effective manual entry per session against the completed daily close, side by side with the
//           frozen model card (daily-generated/<session>.json) and its RW reference, on the same session set.
// Dedup: several entries for the same target session -> only the LAST one recorded before the session's 08:45 HKT
// cutoff counts ("effective"); earlier ones are "superseded"; entries after the cutoff are "late" and never scored.
// CLI:
//   node scripts/manual-adjustments.cjs record --session 2026-10-20 --p A=0.2,B=0.6,C=0.2 [--upper 24524.63 --lower 23737.14] --reason "..." [--author gavin]
//   node scripts/manual-adjustments.cjs score  -> investment/chart/manual-adjustments/scorecard.json
'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const MR = require('../investment/chart/market-rules.js');
const KEYS = ['A', 'B', 'C'];
const ROOT = path.join(__dirname, '..');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const r4 = v => Math.round(v * 1e4) / 1e4;
const brier = (p, o) => KEYS.reduce((s, k) => s + (p[k] - (o === k ? 1 : 0)) ** 2, 0);
function ledgerPath(root = ROOT) { return path.join(root, 'investment/chart/manual-adjustments/ledger.json'); }
function load(root = ROOT) { try { return JSON.parse(fs.readFileSync(ledgerPath(root), 'utf8')); } catch (e) { if (e.code === 'ENOENT') return {schema: 'manual-adjustments-v1', entries: []}; throw e; } }
function entryHash(e) { const {hash, ...rest} = e; return sha(JSON.stringify(rest)); }
function verify(ledger) {
  let prev = null;
  ledger.entries.forEach((e, i) => { if (e.prev_hash !== prev) throw Error('ledger chain broken at ' + i); if (entryHash(e) !== e.hash) throw Error('ledger entry tampered at ' + i); prev = e.hash; });
  return true;
}
function validProbs(p) { return p && KEYS.every(k => Number.isFinite(p[k]) && p[k] >= 0 && p[k] <= 1) && Math.abs(KEYS.reduce((s, k) => s + p[k], 0) - 1) < 1e-6; }
// Append one adjustment. `rules` defaults to the model card's price rules for that session (probability-only edit).
function record({root = ROOT, session, probabilities, rules = null, reason, author = 'manual', now = Date.now(), baseCard = null}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(session || '')) throw Error('session must be YYYY-MM-DD');
  if (!validProbs(probabilities)) throw Error('probabilities must be A/B/C in [0,1] summing to 1');
  if (!reason || !String(reason).trim()) throw Error('reason required');
  const card = baseCard || (() => { try { return JSON.parse(fs.readFileSync(path.join(root, 'investment/chart/daily-generated', session + '.json'), 'utf8')); } catch (e) { return null; } })();
  const R = rules || (card ? Object.fromEntries(card.forecast.scenarios.map(s => [s.id, s.price_rule])) : null);
  if (!R || !KEYS.every(k => R[k])) throw Error('price rules required (no model card for ' + session + ')');
  const ledger = load(root); verify(ledger);
  const e = {session, recorded_at: new Date(now).toISOString(), cutoff: session + 'T08:45:00+08:00', author, reason: String(reason).trim(),
    probabilities: Object.fromEntries(KEYS.map(k => [k, r4(probabilities[k])])), rules: R,
    base_analysis_id: card?.meta?.analysis_id || null, base_probabilities: card ? Object.fromEntries(card.forecast.scenarios.map(s => [s.id, s.probability])) : null,
    prev_hash: ledger.entries.at(-1)?.hash || null};
  e.hash = entryHash(e);
  ledger.entries.push(e);
  fs.mkdirSync(path.dirname(ledgerPath(root)), {recursive: true});
  fs.writeFileSync(ledgerPath(root), JSON.stringify(ledger, null, 1) + '\n');
  return e;
}
function effective(ledger) {
  const out = new Map(), status = [];
  for (const [i, e] of ledger.entries.entries()) {
    const late = MR.timestamp(e.recorded_at) > MR.timestamp(e.cutoff);
    status.push({i, session: e.session, hash: e.hash, state: late ? 'late' : 'pending'});
    if (!late) out.set(e.session, i);
  }
  for (const s of status) if (s.state === 'pending') s.state = out.get(s.session) === s.i ? 'effective' : 'superseded';
  return {bySession: out, status};
}
function outcomeOf(rules, close) { const hits = KEYS.filter(k => MR.priceCondition(rules[k], close) === true); return hits.length === 1 ? hits[0] : null; }
function score({root = ROOT, candles = null} = {}) {
  const ledger = load(root); verify(ledger);
  const bars = candles || JSON.parse(fs.readFileSync(path.join(root, 'investment/chart/kline_futu.json'), 'utf8')).candles;
  const close = new Map(bars.filter(b => !b.partial && b.final !== false).map(b => [b.date, b.close]));
  const {bySession, status} = effective(ledger), rows = [];
  for (const [session, i] of [...bySession.entries()].sort()) {
    const e = ledger.entries[i], c = close.get(session); if (!Number.isFinite(c)) { rows.push({session, status: 'awaiting_close'}); continue; }
    let card = null; try { card = JSON.parse(fs.readFileSync(path.join(root, 'investment/chart/daily-generated', session + '.json'), 'utf8')); } catch (err) {}
    const om = outcomeOf(e.rules, c), row = {session, close: c, manual: om ? {outcome: om, brier: r4(brier(e.probabilities, om))} : {outcome: null, brier: null, issue: 'manual rules do not partition the close'}, entry_hash: e.hash};
    if (card) {
      const rules = Object.fromEntries(card.forecast.scenarios.map(s => [s.id, s.price_rule])), oc = outcomeOf(rules, c), info = card.forecast.weight_model_info || {};
      const mp = Object.fromEntries(card.forecast.scenarios.map(s => [s.id, s.probability]));
      row.model = oc && validProbs(mp) ? {version: card.forecast.weight_model, outcome: oc, brier: r4(brier(mp, oc))} : null;
      const rw = info.rw_reference?.probabilities || info.shadow?.['rw-gauss-v1'];
      row.rw = oc && validProbs(rw) ? {outcome: oc, brier: r4(brier(rw, oc))} : null;
      row.same_rules_as_model = JSON.stringify(rules) === JSON.stringify(e.rules);
    }
    rows.push(row);
  }
  const both = rows.filter(r => r.manual?.brier != null && r.model), withRw = both.filter(r => r.rw);
  const mean = a => a.length ? r4(a.reduce((s, x) => s + x, 0) / a.length) : null;
  const card = {generated_by: 'scripts/manual-adjustments.cjs score', ledger_entries: ledger.entries.length, scored_sessions: both.length,
    summary: {manual: mean(both.map(r => r.manual.brier)), model: mean(both.map(r => r.model.brier)), rw_same_sessions: mean(withRw.map(r => r.rw.brier)), manual_on_rw_sessions: mean(withRw.map(r => r.manual.brier)), n_rw: withRw.length},
    note: '同一交易日多次人工改动只取 08:45 截止前最后一次（effective），其余 superseded；截止后记录（late）不计分。人工规则与模型规则不同时，各自按自己的规则判定结局。',
    entries: status, rows};
  fs.writeFileSync(path.join(path.dirname(ledgerPath(root)), 'scorecard.json'), JSON.stringify(card, null, 1) + '\n');
  return card;
}
module.exports = {record, score, load, verify, effective, entryHash, ledgerPath};
if (require.main === module) {
  const [cmd, ...a] = process.argv.slice(2), o = {};
  for (let i = 0; i < a.length; i += 2) o[a[i].replace(/^--/, '')] = a[i + 1];
  if (cmd === 'record') {
    const p = Object.fromEntries(String(o.p || '').split(',').map(x => x.split('=')).map(([k, v]) => [k, Number(v)]));
    const rules = o.upper && o.lower ? {A: {operator: 'gte', value: Number(o.upper)}, B: {operator: 'range', lower: Number(o.lower), upper: Number(o.upper)}, C: {operator: 'lt', value: Number(o.lower)}} : null;
    console.log(JSON.stringify(record({session: o.session, probabilities: p, rules, reason: o.reason, author: o.author || 'manual'}), null, 1));
  } else if (cmd === 'score') console.log(JSON.stringify(score().summary, null, 1));
  else { console.error('usage: record|score'); process.exitCode = 2; }
}
