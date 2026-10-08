// Capture the analysis actually published for a session. Never synthesize a new
// forecast, relabel its original date, overwrite a frozen file, or score carryovers.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const MR = require('../investment/chart/market-rules.js');
function snapshot(analysis, date, provenance, now = Date.now()) {
  if (MR.tradingDay(date) !== true || !MR.horizon(date, 1)) throw new Error('Invalid archive trading date');
  const originalDate = String(analysis?.forecast?.applicable_date || analysis?.meta?.updatedAt || '').slice(0,10);
  if (!originalDate || originalDate > date) throw new Error('Missing or future analysis date');
  const sourceMs = MR.timestamp(provenance.source_committed_at);
  if (!Number.isFinite(sourceMs) || sourceMs > MR.timestamp(date+'T23:59:59+08:00')) throw new Error('Source commit is later than the archived session');
  if (!provenance.source_commit || !/^[a-f0-9]{40}$/.test(provenance.source_commit)) throw new Error('Source commit required');
  const copy = JSON.parse(JSON.stringify(analysis));
  if (copy.archive_record) throw new Error('Source must be original analysis');
  copy.archive_record = {
    session_date: date,
    kind: provenance.recovered ? 'recovered_snapshot' : originalDate === date ? 'daily_snapshot' : 'carried_forward_snapshot',
    original_analysis_date: originalDate,
    captured_at: new Date(now).toISOString(),
    source_commit: provenance.source_commit,
    source_committed_at: provenance.source_committed_at,
    source_sha256: crypto.createHash('sha256').update(JSON.stringify(analysis)).digest('hex'),
    eligible_as_new_prediction: !provenance.recovered && originalDate === date,
    note: provenance.recovered ? '按当日Git历史补录网站当时使用的分析；保留原冻结日期，不作为新增预测样本。' : originalDate === date ? '当日已发布分析的冻结快照。' : '当日沿用旧分析；尚无新分析发布，不作为新增预测样本。'
  };
  return copy;
}
function save(root, analysis, date, provenance, now) {
  const out = snapshot(analysis, date, provenance, now);
  const dir = path.join(root, 'investment/chart/archive');
  fs.mkdirSync(dir, {recursive:true});
  const file = path.join(dir, date+'.json');
  // Exclusive create: concurrency/retries never alter frozen content.
  try { fs.writeFileSync(file, JSON.stringify(out,null,2)+'\n', {flag:'wx'}); }
  catch(e) { if(e.code !== 'EEXIST') throw e; }
  const indexPath = path.join(dir,'index.json');
  const index = fs.existsSync(indexPath) ? JSON.parse(fs.readFileSync(indexPath,'utf8')) : [];
  if (!Array.isArray(index)) throw new Error('Invalid archive index');
  if (!index.includes(date)) fs.writeFileSync(indexPath,JSON.stringify([...index,date].sort(),null,2)+'\n');
  return JSON.parse(fs.readFileSync(file,'utf8')).archive_record || {kind:'existing_frozen_snapshot'};
}
module.exports = {snapshot,save};
if (require.main === module) {
  const cp = require('node:child_process');
  const root = path.join(__dirname,'..');
  const now = process.env.ARCHIVE_NOW ? MR.timestamp(process.env.ARCHIVE_NOW) : Date.now();
  const today = MR.hk(now).date;
  if(MR.tradingDay(today)!==true) {console.log('No archive: non-trading session');process.exit(0);}
  const analysis = JSON.parse(fs.readFileSync(path.join(root,'investment/chart/annotations.json'),'utf8'));
  const originalDate = String(analysis.forecast?.applicable_date || analysis.meta?.updatedAt || '').slice(0,10);
  // Preopen commits may freeze a genuine new analysis; carryovers only at close.
  if(originalDate!==today && MR.latestDay(now,true)!==today) {console.log('Carryover capture waits for completed session');process.exit(0);}
  const git = args => cp.execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
  const sourceCommit = git(['log','-1','--format=%H','--','investment/chart/annotations.json']);
  const committedAt = git(['show','-s','--format=%cI',sourceCommit]);
  console.log(JSON.stringify(save(root,analysis,today,{source_commit:sourceCommit,source_committed_at:committedAt},now)));
}
