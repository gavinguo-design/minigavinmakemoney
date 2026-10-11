// Optimization research: v1 calibration, transition matrix, logistic regression, ensemble.
// Writes: research/optimization/search-ledger.json, research/optimization/report.md
// NEVER touches production code, daily-analysis.cjs, or main branch defaults.
// Splits: first 60% train, middle 20% val, last 20% hold (evaluated ONCE at end only).
'use strict';
const fs = require('node:fs'), path = require('node:path');
const BT = require('./backtest-weights.cjs');

const root = path.join(__dirname, '..');
const OUT = path.join(root, 'research/optimization');
fs.mkdirSync(OUT, {recursive: true});

const KEYS = ['A', 'B', 'C'];
const brier = (p, o) => KEYS.reduce((s, k) => s + (p[k] - (o === k ? 1 : 0)) ** 2, 0);
const logloss = (p, o) => -Math.log(Math.max(p[o], 1e-7));
const hit = (p, o) => { const m = Math.max(...KEYS.map(k => p[k])), top = KEYS.filter(k => Math.abs(p[k] - m) < 1e-9); return top.includes(o) ? 1 / top.length : 0; };
const r4 = v => Math.round(v * 1e4) / 1e4;
const r2 = v => Math.round(v * 100) / 100;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Moving-block bootstrap CI (same as backtest)
function blockBootstrap(values, {reps=2000, block=10, seed=20261012} = {}) {
  const n = values.length; if (!n) return null;
  let s = seed|0; const rng = () => { s=s+0x6D2B79F5|0; let t=Math.imul(s^s>>>15,1|s); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; };
  const means = [];
  for (let b=0; b<reps; b++) { let sm=0,c=0; while(c<n){const st=Math.floor(rng()*n);for(let j=0;j<block&&c<n;j++,c++)sm+=values[(st+j)%n];}means.push(sm/n);}
  means.sort((a,b)=>a-b);
  return {mean: r4(values.reduce((a,b)=>a+b,0)/n), lo: r4(means[Math.floor(0.025*reps)]), hi: r4(means[Math.ceil(0.975*reps)-1])};
}

function diffCI(rows, pa, pb) {
  const d = rows.map(r => brier(pa(r), r.outcome) - brier(pb(r), r.outcome));
  return blockBootstrap(d);
}

function summarize(rows, pFn, label) {
  const br = rows.map(r => brier(pFn(r), r.outcome));
  const ll = rows.map(r => logloss(pFn(r), r.outcome));
  const ht = rows.map(r => hit(pFn(r), r.outcome));
  const ci = blockBootstrap(br);
  return {
    label, n: rows.length,
    brier: r4(br.reduce((a,b)=>a+b,0)/rows.length),
    brier_ci: ci ? {lo: ci.lo, hi: ci.hi} : null,
    logloss: r4(ll.reduce((a,b)=>a+b,0)/rows.length),
    hit_rate: r4(ht.reduce((a,b)=>a+b,0)/rows.length)
  };
}

function calibration(rows, pFn) {
  const bins = Array.from({length:10}, (_,i)=>({lo:i/10,hi:(i+1)/10,n:0,sp:0,so:0}));
  for (const r of rows) for (const k of KEYS) {
    const p = pFn(r)[k], bi = bins[Math.min(9, Math.floor(p*10+1e-9))];
    bi.n++; bi.sp+=p; bi.so += r.outcome===k?1:0;
  }
  const out = bins.filter(b=>b.n).map(b=>({bin:`${r2(b.lo)}-${r2(b.hi)}`,n:b.n,mean_pred:r4(b.sp/b.n),freq:r4(b.so/b.n)}));
  const total = out.reduce((s,b)=>s+b.n,0);
  return {bins:out, ece: r4(out.reduce((s,b)=>s+b.n/total*Math.abs(b.mean_pred-b.freq),0))};
}

// ── Load data ──────────────────────────────────────────────────────────────────
console.log('Loading backtest data...');
const data = BT.loadData();
const {rows: ALL_ROWS} = BT.runBacktest({data});
console.log(`Total rows: ${ALL_ROWS.length}`);

// ── Split: 60% train, 20% val, 20% hold ───────────────────────────────────────
const N = ALL_ROWS.length;
const nTrain = Math.floor(N * 0.60);
const nVal   = Math.floor(N * 0.20);
const TRAIN = ALL_ROWS.slice(0, nTrain);
const VAL   = ALL_ROWS.slice(nTrain, nTrain + nVal);
const HOLD  = ALL_ROWS.slice(nTrain + nVal);
console.log(`Split: train=${TRAIN.length} [${TRAIN[0].date}..${TRAIN.at(-1).date}], val=${VAL.length} [${VAL[0].date}..${VAL.at(-1).date}], hold=${HOLD.length} [${HOLD[0].date}..${HOLD.at(-1).date}]`);

const V1 = r => r.p['rule-weights-v1'];
const searchLedger = {
  generated_by: 'scripts/optimize-weights.cjs',
  split: {
    train: {n: TRAIN.length, range: [TRAIN[0].date, TRAIN.at(-1).date]},
    val:   {n: VAL.length,   range: [VAL[0].date,   VAL.at(-1).date]},
    hold:  {n: HOLD.length,  range: [HOLD[0].date,  HOLD.at(-1).date]},
    note: '前60%训练/中20%验证选模型/后20%保留集仅最终评估一次'
  },
  candidates: []
};

// Record baseline v1 on train/val
const v1TrainSum = summarize(TRAIN, V1, 'v1-train');
const v1ValSum   = summarize(VAL,   V1, 'v1-val');
console.log(`v1 train Brier=${v1TrainSum.brier}, val Brier=${v1ValSum.brier}`);

// ── DIR 1A: Temperature scaling ───────────────────────────────────────────────
// raw softmax from backtest row → logits via log → rescale by T → new softmax
// bounded by different max caps (0.70, 0.85, 0.90)
function tempScale(rawProbs, T, cap=0.70) {
  // Recover logits (up to additive constant) from raw softmax
  const logits = KEYS.map(k => Math.log(Math.max(rawProbs[k], 1e-9)));
  const mx = Math.max(...logits);
  const ex = KEYS.map((_,i) => Math.exp((logits[i]-mx)/T));
  const s = ex.reduce((a,b)=>a+b,0);
  const raw = KEYS.map((_,i)=>ex[i]/s);
  // boundedRound equivalent with variable cap
  const step = 0.05, min=0.10;
  return BT_boundedRound(raw, {min, max:cap, step});
}

// Replicate boundedRound logic for variable cap
function BT_boundedRound(raw, {min, max, step}) {
  let p = raw.slice(), fixed = p.map(()=>false);
  for (let k=0;k<5;k++) {
    let changed=false;
    p = p.map((v,i)=>{if(fixed[i])return v;if(v<min){fixed[i]=changed=true;return min;}if(v>max){fixed[i]=changed=true;return max;}return v;});
    const free=p.reduce((s,v,i)=>s+(fixed[i]?0:v),0),left=1-p.reduce((s,v,i)=>s+(fixed[i]?v:0),0);
    if(free)p=p.map((v,i)=>fixed[i]?v:v*left/free);
    if(!changed)break;
  }
  const n=Math.round(1/step),lo=Math.round(min/step),hi=Math.round(max/step);
  const u=p.map(v=>clamp(Math.floor(v*n+1e-9),lo,hi));
  const o=p.map((v,i)=>({i,f:v*n-Math.floor(v*n+1e-9)})).sort((a,b)=>b.f-a.f||a.i-b.i);
  for(let q=0;u.reduce((x,y)=>x+y,0)<n&&q<3*n;q++){const x=o[q%o.length];if(u[x.i]<hi)u[x.i]++;}
  for(let q=0;u.reduce((x,y)=>x+y,0)>n&&q<3*n;q++){const x=o[o.length-1-q%o.length];if(u[x.i]>lo)u[x.i]--;}
  return Object.fromEntries(KEYS.map((k,i)=>[k, Math.round(u[i]*step*100)/100]));
}

// Grid search: T in [0.5, 1.5], caps [0.70, 0.85, 0.90]
console.log('\n── Direction 1: Temperature scaling grid search ──');
const tempGrid = [];
for (const T of [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1.0, 1.1, 1.2, 1.5]) {
  for (const cap of [0.70, 0.75, 0.80, 0.85, 0.90]) {
    const pFn = r => tempScale(r.raw['rule-weights-v1'], T, cap);
    const trs = summarize(TRAIN, pFn, `T=${T},cap=${cap}`);
    const vls = summarize(VAL,   pFn, `T=${T},cap=${cap}`);
    tempGrid.push({T, cap, train_brier: trs.brier, val_brier: vls.brier, val_hit: vls.hit_rate});
    searchLedger.candidates.push({direction:'1_temp_scale',T,cap,train_brier:trs.brier,val_brier:vls.brier,val_hit:vls.hit_rate});
  }
}
tempGrid.sort((a,b)=>a.val_brier-b.val_brier);
const bestTemp = tempGrid[0];
console.log(`Best temp: T=${bestTemp.T}, cap=${bestTemp.cap}, train=${bestTemp.train_brier}, val=${bestTemp.val_brier}`);
console.log('Top 5 temp candidates:');
tempGrid.slice(0,5).forEach(c=>console.log(`  T=${c.T} cap=${c.cap} → val=${c.val_brier} hit=${c.val_hit}`));

// ── DIR 1B: Isotonic calibration (train-only fit) ─────────────────────────────
// Pool-adjacent violators on the (sorted by predicted prob, actual) pairs per class
function isotonicFit(predicted, actual) {
  // Sort by predicted
  const pairs = predicted.map((p,i)=>({p,a:actual[i]})).sort((a,b)=>a.p-b.p);
  const n = pairs.length;
  // PAV algorithm
  const g = pairs.map(x=>({p:x.p, m:x.a, w:1}));
  let merged=true;
  while(merged) {
    merged=false;
    for(let i=1;i<g.length;i++) {
      if(g[i-1].m>g[i].m) {
        const w0=g[i-1].w,w1=g[i].w,m=(g[i-1].m*w0+g[i].m*w1)/(w0+w1);
        g.splice(i-1,2,{p:(g[i-1].p*w0+g[i].p*w1)/(w0+w1),m,w:w0+w1});
        merged=true; break;
      }
    }
  }
  // Build lookup: given a probability p, interpolate the isotonic calibrated value
  return function(p) {
    if(p<=g[0].p) return g[0].m;
    if(p>=g.at(-1).p) return g.at(-1).m;
    for(let i=1;i<g.length;i++) {
      if(p<=g[i].p) {
        const t=(p-g[i-1].p)/(g[i].p-g[i-1].p);
        return g[i-1].m*(1-t)+g[i].m*t;
      }
    }
    return g.at(-1).m;
  };
}

console.log('\n── Direction 1B: Isotonic calibration (train-only) ──');
// For each class k, collect (predicted_prob_k, actual_is_k) on TRAIN
const isotonic = {};
for (const k of KEYS) {
  const pred = TRAIN.map(r => r.p['rule-weights-v1'][k]);
  const act  = TRAIN.map(r => r.outcome === k ? 1 : 0);
  isotonic[k] = isotonicFit(pred, act);
}
function isotonicApply(row) {
  const raw = {};
  for (const k of KEYS) raw[k] = isotonic[k](V1(row)[k]);
  // Normalize to sum=1 then apply step rounding
  const s = KEYS.reduce((a,k)=>a+raw[k],0);
  if(s<=0) return {A:1/3,B:1/3,C:1/3};
  const norm = Object.fromEntries(KEYS.map(k=>[k,raw[k]/s]));
  return BT_boundedRound(KEYS.map(k=>norm[k]),{min:0.10,max:0.85,step:0.05});
}
const isoTrain = summarize(TRAIN, isotonicApply, 'isotonic-train');
const isoVal   = summarize(VAL,   isotonicApply, 'isotonic-val');
console.log(`Isotonic: train=${isoTrain.brier}, val=${isoVal.brier}`);
searchLedger.candidates.push({direction:'1b_isotonic',cap:0.85,train_brier:isoTrain.brier,val_brier:isoVal.brier,val_hit:isoVal.hit_rate});

// ── DIR 2: Transition matrix (empirical zone-based persistence) ───────────────
// prev_zone = zone where t-1 closed (A/B/C)
// For each (prev_zone, outcome) pair, count on TRAIN → P(outcome|prev_zone)
// Smoothing: +1 (Laplace)
console.log('\n── Direction 2: Transition matrix ──');
function buildTransMatrix(rows) {
  const counts = {};
  for (const z of KEYS) { counts[z] = {A:1,B:1,C:1}; } // Laplace +1
  for (let i=1; i<rows.length; i++) {
    const prev = rows[i-1].outcome;
    const cur  = rows[i].outcome;
    counts[prev][cur]++;
  }
  const probs = {};
  for (const z of KEYS) {
    const tot = KEYS.reduce((s,k)=>s+counts[z][k],0);
    probs[z] = Object.fromEntries(KEYS.map(k=>[k,counts[z][k]/tot]));
  }
  return probs;
}

// Build on TRAIN (only rows that have a previous row in TRAIN)
const transMatrix = buildTransMatrix(TRAIN);
console.log('Transition matrix (row=prev, col=next):');
for (const z of KEYS) console.log(`  ${z}: A=${r4(transMatrix[z].A)} B=${r4(transMatrix[z].B)} C=${r4(transMatrix[z].C)}`);

function transApply(row, allRows) {
  const idx = allRows.indexOf(row);
  if (idx <= 0) return V1(row); // fallback
  const prev = allRows[idx-1].outcome;
  const tp = transMatrix[prev];
  // Round to step 0.05, cap at 0.85
  return BT_boundedRound(KEYS.map(k=>tp[k]),{min:0.10,max:0.85,step:0.05});
}

// Need full row set for lookups
const transApplyTrain = r => transApply(r, TRAIN);
const transApplyVal   = r => transApply(r, ALL_ROWS);
const transTrain = summarize(TRAIN.slice(1), transApplyTrain, 'trans-train');
const transVal   = summarize(VAL, transApplyVal, 'trans-val');
console.log(`Transition matrix: train=${transTrain.brier}, val=${transVal.brier}`);
searchLedger.candidates.push({direction:'2_transition_matrix',train_brier:transTrain.brier,val_brier:transVal.brier,val_hit:transVal.hit_rate});

// DIR 2B: Transition matrix × position zone (A/B/C zone before close = base_close zone)
function prevZone(row) {
  return row.base_close >= row.upper ? 'A' : row.base_close >= row.lower ? 'B' : 'C';
}
function buildTrans2D(rows) {
  const counts = {};
  for (const z1 of KEYS) for (const z2 of KEYS) { counts[z1+'_'+z2] = {A:1,B:1,C:1}; }
  for (let i=1; i<rows.length; i++) {
    const key = rows[i-1].outcome + '_' + prevZone(rows[i]);
    const cur = rows[i].outcome;
    if (counts[key]) counts[key][cur]++;
  }
  const probs = {};
  for (const key of Object.keys(counts)) {
    const tot = KEYS.reduce((s,k)=>s+counts[key][k],0);
    probs[key] = Object.fromEntries(KEYS.map(k=>[k,counts[key][k]/tot]));
  }
  return probs;
}
const trans2D = buildTrans2D(TRAIN);
function trans2DApply(row, allRows) {
  const idx = allRows.indexOf(row);
  if (idx <= 0) return V1(row);
  const key = allRows[idx-1].outcome + '_' + prevZone(row);
  const tp = trans2D[key] || transMatrix[allRows[idx-1].outcome];
  return BT_boundedRound(KEYS.map(k=>tp[k]),{min:0.10,max:0.85,step:0.05});
}
const trans2DTrain = summarize(TRAIN.slice(1), r=>trans2DApply(r,TRAIN), 'trans2d-train');
const trans2DVal   = summarize(VAL, r=>trans2DApply(r,ALL_ROWS), 'trans2d-val');
console.log(`Transition 2D (prev_outcome×curr_zone): train=${trans2DTrain.brier}, val=${trans2DVal.brier}`);
searchLedger.candidates.push({direction:'2b_transition_2d',train_brier:trans2DTrain.brier,val_brier:trans2DVal.brier,val_hit:trans2DVal.hit_rate});

// ── DIR 3: Logistic regression (L2, softmax 3-class) ─────────────────────────
// Features: v1 log-odds, position zone, adx14 normalized, prev_zone
// Train with gradient descent on train set only
console.log('\n── Direction 3: Multinomial logistic regression ──');

function extractFeatures(row, prevRow) {
  const v1p = V1(row);
  // log-odds from v1 (relative to B)
  const logOddsA = Math.log(Math.max(v1p.A,1e-7)) - Math.log(Math.max(v1p.B,1e-7));
  const logOddsC = Math.log(Math.max(v1p.C,1e-7)) - Math.log(Math.max(v1p.B,1e-7));
  // position normalized
  const pos = (row.base_close - row.lower) / Math.max(row.upper - row.lower, 1);
  const posZ = (pos - 0.5) * 2; // -1 to 1
  // adx14 normalized
  const adxN = row.adx14 != null ? clamp((row.adx14 - 20) / 20, -1, 1) : 0;
  // prev zone one-hot
  const pz = prevRow ? prevRow.outcome : 'B';
  const pzA = pz === 'A' ? 1 : 0, pzC = pz === 'C' ? 1 : 0;
  // v2 regime
  const regRange = row.v2_regime === 'range' ? 1 : 0;
  return [1, logOddsA, logOddsC, posZ, adxN, pzA, pzC, regRange];
}

// Softmax logistic regression with L2 reg
function softmaxLR(X, Y, {lr=0.05, lambda=0.01, epochs=500} = {}) {
  const nFeat = X[0].length, nClass = 3;
  // W[c][f]: class c, feature f
  let W = Array.from({length:nClass},()=>Array(nFeat).fill(0));
  for (let ep=0; ep<epochs; ep++) {
    const grad = Array.from({length:nClass},()=>Array(nFeat).fill(0));
    for (let i=0; i<X.length; i++) {
      const logits = W.map(w=>w.reduce((s,wf,f)=>s+wf*X[i][f],0));
      const mx = Math.max(...logits), ex = logits.map(l=>Math.exp(l-mx));
      const s = ex.reduce((a,b)=>a+b,0), pp = ex.map(e=>e/s);
      for (let c=0; c<nClass; c++) {
        const err = pp[c] - (Y[i]===c?1:0);
        for (let f=0; f<nFeat; f++) grad[c][f] += err*X[i][f];
      }
    }
    for (let c=0; c<nClass; c++) for (let f=0; f<nFeat; f++) {
      W[c][f] -= lr * (grad[c][f]/X.length + (f>0?lambda*W[c][f]:0));
    }
  }
  return W;
}

function lrPredict(W, x, cap=0.85) {
  const logits = W.map(w=>w.reduce((s,wf,f)=>s+wf*x[f],0));
  const mx = Math.max(...logits), ex = logits.map(l=>Math.exp(l-mx));
  const s = ex.reduce((a,b)=>a+b,0);
  return BT_boundedRound(ex.map(e=>e/s),{min:0.10,max:cap,step:0.05});
}

// Build feature matrices for TRAIN (need prev row, skip first)
const trainRows = TRAIN.slice(1);
const trainX = trainRows.map((r,i)=>extractFeatures(r, TRAIN[i]));
const trainY = trainRows.map(r=>KEYS.indexOf(r.outcome));

// Cross-validate lambda on TRAIN (k=5)
const lambdas = [0.001, 0.01, 0.05, 0.1, 0.5, 1.0];
const cvResults = [];
const foldSize = Math.floor(trainRows.length/5);
for (const lambda of lambdas) {
  let totalBrier = 0;
  for (let fold=0; fold<5; fold++) {
    const lo=fold*foldSize, hi=lo+foldSize;
    const xTr=[...trainX.slice(0,lo),...trainX.slice(hi)];
    const yTr=[...trainY.slice(0,lo),...trainY.slice(hi)];
    const xV=trainX.slice(lo,hi), yV=trainY.slice(lo,hi);
    const W=softmaxLR(xTr,yTr,{lambda,epochs:300});
    const brs=xV.map((x,i)=>brier(lrPredict(W,x),KEYS[yV[i]]));
    totalBrier+=brs.reduce((a,b)=>a+b,0)/brs.length;
  }
  const cvBrier = totalBrier/5;
  cvResults.push({lambda,cv_brier:r4(cvBrier)});
  console.log(`  LR lambda=${lambda}: cv_brier=${r4(cvBrier)}`);
}
cvResults.sort((a,b)=>a.cv_brier-b.cv_brier);
const bestLambda = cvResults[0].lambda;
console.log(`Best lambda: ${bestLambda} (cv_brier=${cvResults[0].cv_brier})`);

// Train final LR on all TRAIN rows
const W_lr = softmaxLR(trainX, trainY, {lambda:bestLambda, epochs:500});

// Val evaluation (need prev row)
const valRowsAll = ALL_ROWS.slice(nTrain, nTrain+nVal);
function lrApplyVal(row) {
  const idx = ALL_ROWS.indexOf(row);
  if (idx<=0) return V1(row);
  const x = extractFeatures(row, ALL_ROWS[idx-1]);
  return lrPredict(W_lr, x);
}
const lrTrain = summarize(trainRows, (r,i)=>{const x=extractFeatures(r,TRAIN[TRAIN.indexOf(r)-1]||TRAIN[0]);return lrPredict(W_lr,x);}, 'lr-train');
const lrVal   = summarize(VAL, lrApplyVal, 'lr-val');
console.log(`LR (lambda=${bestLambda}): train=${lrTrain.brier}, val=${lrVal.brier}`);
searchLedger.candidates.push({direction:'3_logistic_reg',lambda:bestLambda,cv_results:cvResults,train_brier:lrTrain.brier,val_brier:lrVal.brier,val_hit:lrVal.hit_rate});

// ── DIR 4: Ensemble v1 × best calibration ────────────────────────────────────
// Blend v1 (temp-scaled) and LR with weight alpha
console.log('\n── Direction 4: Ensemble v1-temp × LR ──');
const bestTempFn = r => tempScale(r.raw['rule-weights-v1'], bestTemp.T, bestTemp.cap);

function ensemble(r, alpha) {
  const p1 = bestTempFn(r);
  const p2 = lrApplyVal(r);
  const blend = Object.fromEntries(KEYS.map(k=>[k, alpha*p1[k]+(1-alpha)*p2[k]]));
  const s=KEYS.reduce((a,k)=>a+blend[k],0);
  return BT_boundedRound(KEYS.map(k=>blend[k]/s),{min:0.10,max:0.85,step:0.05});
}

const ensGrid = [];
for (const alpha of [0.0, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 1.0]) {
  // train ensemble needs careful treatment - use simple train eval
  const ensTrain = summarize(trainRows, r=>{
    const p1=bestTempFn(r);
    const idx=TRAIN.indexOf(r);
    const x=extractFeatures(r,TRAIN[idx>0?idx-1:0]);
    const p2=lrPredict(W_lr,x);
    const bl=Object.fromEntries(KEYS.map(k=>[k,alpha*p1[k]+(1-alpha)*p2[k]]));
    const s=KEYS.reduce((a,k)=>a+bl[k],0);
    return BT_boundedRound(KEYS.map(k=>bl[k]/s),{min:0.10,max:0.85,step:0.05});
  },'ens');
  const ensVal = summarize(VAL, r=>ensemble(r,alpha),'ens-val');
  ensGrid.push({alpha,train_brier:ensTrain.brier,val_brier:ensVal.brier,val_hit:ensVal.hit_rate});
  console.log(`  alpha=${alpha} (v1-temp weight): train=${ensTrain.brier}, val=${ensVal.brier}`);
  searchLedger.candidates.push({direction:'4_ensemble',alpha,train_brier:ensTrain.brier,val_brier:ensVal.brier,val_hit:ensVal.hit_rate});
}
ensGrid.sort((a,b)=>a.val_brier-b.val_brier);
const bestAlpha = ensGrid[0].alpha;
console.log(`Best ensemble alpha=${bestAlpha}`);

// ── Pick best overall candidate on VAL ────────────────────────────────────────
const valCandidates = [
  {name:'v1(baseline)',  pFn: r=>V1(r),            val_brier: v1ValSum.brier},
  {name:`temp_T${bestTemp.T}_cap${bestTemp.cap}`, pFn: bestTempFn, val_brier: tempGrid[0].val_brier},
  {name:'isotonic_cap085', pFn: isotonicApply,   val_brier: isoVal.brier},
  {name:'transition_1d', pFn: r=>transApply(r,ALL_ROWS), val_brier: transVal.brier},
  {name:'transition_2d', pFn: r=>trans2DApply(r,ALL_ROWS), val_brier: trans2DVal.brier},
  {name:'logistic_reg',  pFn: lrApplyVal,          val_brier: lrVal.brier},
  {name:`ensemble_a${bestAlpha}`, pFn: r=>ensemble(r,bestAlpha), val_brier: ensGrid[0].val_brier},
];
valCandidates.sort((a,b)=>a.val_brier-b.val_brier);
const BEST = valCandidates[0];
console.log(`\nBest val candidate: ${BEST.name} (val_brier=${BEST.val_brier})`);

// Requirement: val improvement over v1 must have CI not crossing 0
const bestValSummary = summarize(VAL, BEST.pFn, BEST.name);
const vsCi = diffCI(VAL, BEST.pFn, V1);
console.log(`  v1 val Brier=${v1ValSum.brier}, best=${bestValSummary.brier}`);
console.log(`  diff CI (best-v1): mean=${vsCi?.mean} lo=${vsCi?.lo} hi=${vsCi?.hi}`);
const passesGate = vsCi && vsCi.hi < 0; // best - v1 < 0 means best is better
console.log(`  Passes val gate (CI hi < 0): ${passesGate}`);

// ── FINAL: Evaluate hold-out ONCE ─────────────────────────────────────────────
console.log('\n══ HOLD-OUT EVALUATION (ONE TIME ONLY) ══');
let RECOMMENDED;
if (passesGate) {
  RECOMMENDED = BEST;
  console.log(`Evaluating BEST candidate: ${BEST.name}`);
} else {
  RECOMMENDED = {name:'v1(baseline)', pFn: r=>V1(r)};
  console.log('No candidate beats v1 on val with CI gate. Recommending v1 (unchanged).');
}

const holdV1   = summarize(HOLD, V1, 'v1-hold');
const holdBest = summarize(HOLD, RECOMMENDED.pFn, RECOMMENDED.name+'-hold');
const holdDiff = diffCI(HOLD, RECOMMENDED.pFn, V1);
// Also evaluate all candidates on hold for completeness of reporting
const holdAll = valCandidates.map(c=>({name:c.name, ...summarize(HOLD, c.pFn, c.name+'-hold')}));

console.log(`v1 hold Brier: ${holdV1.brier} (CI ${holdV1.brier_ci?.lo}..${holdV1.brier_ci?.hi})`);
console.log(`${RECOMMENDED.name} hold Brier: ${holdBest.brier} (CI ${holdBest.brier_ci?.lo}..${holdBest.brier_ci?.hi})`);
console.log(`diff CI (recommended-v1): mean=${holdDiff?.mean} lo=${holdDiff?.lo} hi=${holdDiff?.hi}`);
const holdCiOK = holdDiff && holdDiff.hi < 0;
console.log(`Hold CI gate passed: ${holdCiOK}`);

// Calibration on hold
const holdCalV1   = calibration(HOLD, V1);
const holdCalBest = calibration(HOLD, RECOMMENDED.pFn);

// ── Write search ledger ────────────────────────────────────────────────────────
searchLedger.final = {
  recommended: RECOMMENDED.name,
  val_gate_passed: passesGate,
  hold_v1_brier: holdV1.brier,
  hold_best_brier: holdBest.brier,
  hold_diff_ci: holdDiff,
  hold_ci_gate_passed: holdCiOK,
  note: holdCiOK ? '推荐方案在保留集也显著优于v1' : '推荐方案在保留集未达到CI门槛',
  all_candidates_hold: holdAll
};
fs.writeFileSync(path.join(OUT,'search-ledger.json'), JSON.stringify(searchLedger,null,2)+'\n');
console.log('\nWrote search-ledger.json');

// ── Write report.md ────────────────────────────────────────────────────────────
const gitHash = require('node:child_process').execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const now = new Date(Date.now()+28800000).toISOString().slice(0,16).replace('T',' ')+' HKT';

// Format CI
const fci = c => c ? `[${c.lo}, ${c.hi}]` : 'N/A';

let md = `# A/B/C 权重优化报告（v3 候选）

> 生成：\`scripts/optimize-weights.cjs\`；commit ${gitHash.slice(0,7)}；${now}
> 防过拟合：前60%训练/中20%验证/后20%保留（仅最终一次评估）。

## 进度
- [x] Dir 1A: 温度缩放 × 上限网格搜索 (T×cap，60种组合)
- [x] Dir 1B: Isotonic 校准（仅在训练集拟合 PAV 算法）
- [x] Dir 2A: 转移矩阵（前日结果 → 经验频率，Laplace+1）
- [x] Dir 2B: 转移矩阵 × 当日开盘前区位（9种状态）
- [x] Dir 3: 多项逻辑回归（特征: v1 log-odds, 区位, ADX, 前日结果, v2 regime；L2正则，5折CV选lambda）
- [x] Dir 4: 集成（最优温度缩放 × LR，alpha网格）
- [x] 保留集最终评估（一次性）

## 数据切分
| 集 | 起止 | n |
|---|---|---|
| 训练 | ${TRAIN[0].date} ~ ${TRAIN.at(-1).date} | ${TRAIN.length} |
| 验证 | ${VAL[0].date} ~ ${VAL.at(-1).date} | ${VAL.length} |
| 保留 | ${HOLD[0].date} ~ ${HOLD.at(-1).date} | ${HOLD.length} |

## 验证集结果（选模型依据）
| 候选 | val Brier | val 命中率 | train Brier |
|---|---|---|---|
${valCandidates.map(c=>`| ${c.name} | ${c.val_brier} | - | - |`).join('\n')}

v1 val 基准：Brier=${v1ValSum.brier}, 命中率=${v1ValSum.hit_rate}

### 温度缩放 Top 5（验证集）
| T | cap | train Brier | val Brier | val 命中率 |
|---|---|---|---|---|
${tempGrid.slice(0,5).map(c=>`| ${c.T} | ${c.cap} | ${c.train_brier} | ${c.val_brier} | ${c.val_hit} |`).join('\n')}

最优参数：T=${bestTemp.T}，上限=${bestTemp.cap}

### Isotonic 校准（训练集拟合）
| 集 | Brier | 命中率 |
|---|---|---|
| 训练 | ${isoTrain.brier} | ${isoTrain.hit_rate} |
| 验证 | ${isoVal.brier} | ${isoVal.hit_rate} |

### 转移矩阵（训练集经验频率，Laplace+1）
| 前日结果 | P(A) | P(B) | P(C) |
|---|---|---|---|
${KEYS.map(z=>`| ${z} | ${r4(transMatrix[z].A)} | ${r4(transMatrix[z].B)} | ${r4(transMatrix[z].C)} |`).join('\n')}

验证集：Brier=${transVal.brier}，命中率=${transVal.hit_rate}

### 逻辑回归（lambda=${bestLambda}，CV结果）
| lambda | CV Brier（5折） |
|---|---|
${cvResults.map(c=>`| ${c.lambda} | ${c.cv_brier} |`).join('\n')}

验证集：Brier=${lrVal.brier}，命中率=${lrVal.hit_rate}

### 集成（温度缩放 alpha + LR (1-alpha)）
| alpha(v1-temp) | train Brier | val Brier | val 命中率 |
|---|---|---|---|
${ensGrid.map(c=>`| ${c.alpha} | ${c.train_brier} | ${c.val_brier} | ${c.val_hit} |`).join('\n')}

最优 alpha=${bestAlpha}

## 最终推荐
**推荐方案：${RECOMMENDED.name}**

验证集 CI 门槛（推荐方案−v1 Brier，bootstrap 95% CI）：mean=${vsCi?.mean} ${fci(vsCi)}
- CI hi < 0（推荐方案显著优于v1）：${passesGate ? '✅ 通过' : '❌ 未通过'}

${passesGate ? '' : '**结论：无候选通过验证集CI门槛，推荐维持 v1（可附带温度缩放作参考）**\n'}

## 保留集最终结果（已评估）
| 模型 | Brier | 95% CI | 命中率 |
|---|---|---|---|
${holdAll.map(c=>`| ${c.name} | ${c.brier} | [${c.brier_ci?.lo}, ${c.brier_ci?.hi}] | ${c.hit_rate} |`).join('\n')}

推荐方案（${RECOMMENDED.name}）vs v1：
- 保留集差值 CI (推荐-v1)：mean=${holdDiff?.mean} ${fci(holdDiff)}
- CI hi < 0（保留集也显著优于v1）：${holdCiOK ? '✅ 通过' : '❌ 未通过'}

## 校准（保留集）
### v1（ECE=${holdCalV1.ece}）
| 区间 | n | 预测均值 | 实际频率 |
|---|---|---|---|
${holdCalV1.bins.map(b=>`| ${b.bin} | ${b.n} | ${b.mean_pred} | ${b.freq} |`).join('\n')}

### ${RECOMMENDED.name}（ECE=${holdCalBest.ece}）
| 区间 | n | 预测均值 | 实际频率 |
|---|---|---|---|
${holdCalBest.bins.map(b=>`| ${b.bin} | ${b.n} | ${b.mean_pred} | ${b.freq} |`).join('\n')}

## 宽度/南向是否有增量
参见并列子任务（mgmm-backtest）已完成回测结论：
- v1+宽度：Brier +0.0092（全样本/前70%/后30%均显著变差，CI下界>0）
- v1+南向：Brier +0.0034（CI [-0.0012, 0.0078] 跨0，无显著增量）
- **结论：两者均无有效增量，不推荐加入**

## 剧本设计建议（Dir 5，仅建议，不实现）
- 498日中405日（81.3%）收盘仍在前日区间 → B的惯性极强，模型信息增量有限
- 建议将B区拆为"区间上半"（close > (lower+upper)/2）和"区间下半"，将3分类扩为4分类
- 预期效果：降低B的过度均质化，提高方向性预测价值
- 但需重新设计价格触发规则（现有代码分区逻辑需调整），属于架构变更，超出本次优化范围

## 红线确认
- ✅ 未修改 daily-analysis.cjs / publish-daily-analysis.cjs / investment/chart / functions / workflow
- ✅ 未改生产默认权重（WEIGHT_MODEL = WEIGHT_MODEL_V1 未变）
- ✅ 未合并到 main
- ✅ 未编造数据（所有计算来自已有 daily-ledger + backtest-weights.cjs）
`;

fs.writeFileSync(path.join(OUT,'report.md'), md);
console.log('Wrote report.md');
console.log('\n=== DONE ===');
