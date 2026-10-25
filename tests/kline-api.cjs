const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../functions/api/kline.js'),'utf8');
const loaded=import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const ts=s=>Date.parse(s+'+08:00')/1000;
async function run(interval,meta={},fail=false){
 const previousFetch=global.fetch,previousCaches=global.caches;
 const times=[ts('2026-10-05T15:00:00'),ts('2026-10-06T09:30:00'),ts('2026-10-06T10:30:00')];
 global.caches={default:{match:async()=>null,put:async()=>{}}};
 global.fetch=async()=>fail?new Response('blocked',{status:403}):Response.json({chart:{result:[{meta:{regularMarketTime:times[2],regularMarketPrice:110,chartPreviousClose:50,...meta},timestamp:times,indicators:{quote:[{open:[100,101,102],high:[102,105,111],low:[99,100,101],close:[101,104,110],volume:[10,20,30]}]}}]}});
 try {const mod=await loaded;return await mod.onRequest({request:new Request('https://example.invalid/api/kline?interval='+interval),waitUntil:p=>p});} finally{global.fetch=previousFetch;global.caches=previousCaches;}
}
test('minute response uses previous session close and preserves upstream quote time',async()=>{
 const r=await run('60m'),d=await r.json();assert.equal(r.status,200);assert.equal(d.previousClose,101);assert.equal(d.regularMarketTime,ts('2026-10-06T10:30:00'));assert.equal(d.close.length,3);
});
test('explicit previousClose wins; weekly data never treats a week close as yesterday',async()=>{
 assert.equal((await (await run('1d',{previousClose:99})).json()).previousClose,99);
 assert.equal((await (await run('1wk')).json()).previousClose,null);
});
test('missing source time remains missing instead of using local download time',async()=>{
 const d=await (await run('1d',{regularMarketTime:null})).json();assert.equal(d.regularMarketTime,null);assert.equal(d.previousClose,null);
});
test('upstream failure yields an explicit error rather than an empty successful quote',async()=>{
 const r=await run('60m',{},true);assert.equal(r.status,502);assert.equal((await r.json()).status,403);
});
