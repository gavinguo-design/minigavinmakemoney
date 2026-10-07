// Gate a newly generated prediction before appending it to the frozen log.
// Usage: node scripts/validate-prediction-horizons.cjs /path/to/new-record.json
// Existing frozen records are audited in the UI; this command never rewrites them.
const fs=require('node:fs');
const rules=require('../investment/chart/market-rules.js');
const filename=process.argv[2];
if(!filename) { console.error('Provide a newly generated prediction JSON.'); process.exitCode=1; }
else {
  const data=JSON.parse(fs.readFileSync(filename,'utf8'));
  const records=Array.isArray(data.predictions)?data.predictions:[data];
  const rejected=records.map(record=>({id:record.id,...rules.auditHorizon(record)})).filter(result=>result.status!=='valid');
  if(rejected.length) { console.error(JSON.stringify({rejected},null,2)); process.exitCode=1; }
  else console.log(JSON.stringify({valid:records.length}));
}
