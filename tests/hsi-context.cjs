const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const Context=require('../investment/chart/market-context.js');
const annotations=require('../investment/chart/annotations.json');
const source=fs.readFileSync(path.join(__dirname,'../functions/api/hsi-context.js'),'utf8');
const loaded=import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));

test('context endpoint calculates basis, spread and option-implied daily range',async()=>{
 const {_test}=await loaded, now=Date.parse('2026-10-07T16:05:00+08:00');
 const d=_test.buildContext(
  {price:24080,previous_close:24250,bid:24079,ask:24081,ts:now/1000-60,volume:100,open_interest:50},
  {price:24120,previous_close:24100,ts:now/1000-300,amount_hkd:1e11},
  {price:18,previous_close:18.5,ts:now/1000-300},now);
 assert.equal(d.status,'available'); assert.equal(d.futures.basis_points,-40); assert.equal(d.liquidity.spread_points,2);
 assert.ok(d.options_risk.expected_one_day_move_points>270); assert.equal(d.options_risk.directional_signal,false);
});

test('futures direction tilts A while spread and VHSI only reduce reliability',()=>{
 const scenarios=annotations.forecast.scenarios;
 const s={status:'available',futures:{return_from_previous_close:.01,basis_pct:.002},liquidity:{spread_points:2},options_risk:{price:18}};
 const r=Context.evaluate(s,scenarios,null); assert.equal(r.status,'available'); assert.ok(r.weights.A>.35); assert.ok(r.weights.B<.45);
 const stressed=Context.evaluate({...s,liquidity:{spread_points:10},options_risk:{price:40}},scenarios,null);
 assert.ok(stressed.evidence.reliability<r.evidence.reliability);
});

test('missing or degraded context fails closed',()=>{
 const r=Context.evaluate({status:'observe_only'},annotations.forecast.scenarios,null); assert.equal(r.status,'unavailable');
});

test('chart exposes live market context and keeps options non-directional',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../investment/chart/index.html'),'utf8');
 assert.match(html,/\/api\/hsi-context/); assert.match(html,/期指只做方向校正/); assert.match(html,/流动性和VHSI只控制可靠度/);
});
