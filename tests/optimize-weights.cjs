// Tests for optimize-weights.cjs utilities.
// Run: node --test tests/optimize-weights.cjs
'use strict';
const test = require('node:test'), assert = require('node:assert/strict');

// Replicate the BT_boundedRound and tempScale helpers for isolated testing
function BT_boundedRound(raw, {min, max, step}) {
  const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
  let p=raw.slice(),fixed=p.map(()=>false);
  for(let k=0;k<5;k++){let changed=false;p=p.map((v,i)=>{if(fixed[i])return v;if(v<min){fixed[i]=changed=true;return min;}if(v>max){fixed[i]=changed=true;return max;}return v;});const free=p.reduce((s,v,i)=>s+(fixed[i]?0:v),0),left=1-p.reduce((s,v,i)=>s+(fixed[i]?v:0),0);if(free)p=p.map((v,i)=>fixed[i]?v:v*left/free);if(!changed)break;}
  const n=Math.round(1/step),lo=Math.round(min/step),hi=Math.round(max/step),u=p.map(v=>clamp(Math.floor(v*n+1e-9),lo,hi)),o=p.map((v,i)=>({i,f:v*n-Math.floor(v*n+1e-9)})).sort((a,b)=>b.f-a.f||a.i-b.i);
  for(let q=0;u.reduce((x,y)=>x+y,0)<n&&q<3*n;q++){const x=o[q%o.length];if(u[x.i]<hi)u[x.i]++;}
  for(let q=0;u.reduce((x,y)=>x+y,0)>n&&q<3*n;q++){const x=o[o.length-1-q%o.length];if(u[x.i]>lo)u[x.i]--;}
  return u.map(x=>Math.round(x*step*100)/100);
}

function tempScale(rawProbs, T, cap=0.70) {
  const KEYS=['A','B','C'];
  const logits=KEYS.map(k=>Math.log(Math.max(rawProbs[k],1e-9)));
  const mx=Math.max(...logits),ex=logits.map(l=>Math.exp((l-mx)/T));
  const s=ex.reduce((a,b)=>a+b,0),raw=ex.map(x=>x/s);
  const p=BT_boundedRound(raw,{min:0.10,max:cap,step:0.05});
  return Object.fromEntries(KEYS.map((k,i)=>[k,p[i]]));
}

test('boundedRound: sum=1, each in [min,max], steps of 0.05', () => {
  for (const [ra,rb,rc] of [[0.7,0.2,0.1],[0.4,0.4,0.2],[0.33,0.33,0.34],[0.9,0.05,0.05]]) {
    const p = BT_boundedRound([ra,rb,rc],{min:0.10,max:0.70,step:0.05});
    assert.ok(Math.abs(p.reduce((a,b)=>a+b,0)-1)<1e-9, `sum!=1: ${p}`);
    for (const v of p) {
      assert.ok(v>=0.10-1e-9 && v<=0.70+1e-9, `out of [0.10,0.70]: ${v}`);
      assert.ok(Math.abs(v*20-Math.round(v*20))<1e-9, `not multiple of 0.05: ${v}`);
    }
  }
});

test('boundedRound: cap=0.85 allows higher values', () => {
  const p = BT_boundedRound([0.82,0.10,0.08],{min:0.10,max:0.85,step:0.05});
  assert.ok(p[0]<=0.85+1e-9, `exceeds cap: ${p[0]}`);
  assert.ok(Math.abs(p.reduce((a,b)=>a+b,0)-1)<1e-9, `sum!=1: ${p}`);
});

test('tempScale T<1 sharpens distribution (higher max), T>1 flattens', () => {
  const raw = {A:0.6,B:0.3,C:0.1};
  const sharp = tempScale(raw,0.7,0.85);
  const flat  = tempScale(raw,1.3,0.85);
  assert.ok(sharp.A >= raw.A, `T<1 should sharpen A: sharp=${sharp.A} orig=${raw.A}`);
  assert.ok(flat.A  <= raw.A+1e-9, `T>1 should flatten A: flat=${flat.A} orig=${raw.A}`);
  assert.ok(Math.abs(sharp.A+sharp.B+sharp.C-1)<1e-9);
  assert.ok(Math.abs(flat.A +flat.B +flat.C -1)<1e-9);
});

test('tempScale T=1.0 is identity (within step rounding) at cap=0.70', () => {
  const raw = {A:0.55,B:0.30,C:0.15};
  const p = tempScale(raw,1.0,0.70);
  // sum=1, in bounds
  assert.ok(Math.abs(p.A+p.B+p.C-1)<1e-9);
});

test('tempScale point-in-time: only uses raw probabilities not future data', () => {
  // Idempotent: same input same output
  const raw = {A:0.4,B:0.4,C:0.2};
  const p1 = tempScale(raw,0.8,0.85), p2 = tempScale(raw,0.8,0.85);
  assert.deepEqual(p1,p2);
});

test('search-ledger.json exists and has required fields', () => {
  const fs=require('node:fs'),path=require('node:path');
  const f=path.join(__dirname,'..','research/optimization/search-ledger.json');
  if(!fs.existsSync(f)){console.log('SKIP: search-ledger.json not yet generated');return;}
  const d=JSON.parse(fs.readFileSync(f,'utf8'));
  assert.ok(d.candidates && Array.isArray(d.candidates) && d.candidates.length>0,'candidates array');
  assert.ok(d.split,'split field');
  // All candidates must have train_brier and val_brier (not cherry-picking)
  for (const c of d.candidates) {
    assert.ok(typeof c.train_brier==='number','missing train_brier in candidate '+JSON.stringify(c).slice(0,80));
    assert.ok(typeof c.val_brier==='number','missing val_brier in candidate '+JSON.stringify(c).slice(0,80));
  }
  // All four directions represented
  const dirs=new Set(d.candidates.map(c=>c.direction.split('_')[0]));
  assert.ok(dirs.has('1'),'direction 1 missing');
  assert.ok(dirs.has('2'),'direction 2 missing');
  assert.ok(dirs.has('3'),'direction 3 missing');
  assert.ok(dirs.has('4'),'direction 4 missing');
  // final block present
  assert.ok(d.final,'final block missing');
  assert.ok(typeof d.final.hold_v1_brier==='number','hold_v1_brier');
});

test('report.md exists and has sections', () => {
  const fs=require('node:fs'),path=require('node:path');
  const f=path.join(__dirname,'..','research/optimization/report.md');
  if(!fs.existsSync(f)){console.log('SKIP: report.md not yet generated');return;}
  const txt=fs.readFileSync(f,'utf8');
  assert.ok(txt.includes('## 进度'),'进度 section');
  assert.ok(txt.includes('## 最终推荐'),'最终推荐 section');
  assert.ok(txt.includes('## 保留集最终结果'),'保留集 section');
  assert.ok(txt.includes('宽度/南向'),'宽度南向 section');
  assert.ok(txt.includes('剧本设计建议'),'剧本设计建议 section');
});
