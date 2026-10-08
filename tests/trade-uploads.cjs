const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../investment/chart/trades.html'),'utf8');
function extract(name){const start=html.indexOf('    function '+name+'(');assert.ok(start>=0,name);return html.slice(start,html.indexOf('\n    }',start)+6);}
test('pending and processed uploads visible without entering them into trade stats; unsafe paths rejected',()=>{
 const box={innerHTML:''};const c=vm.createContext({$:()=>box,esc:s=>String(s).replaceAll('<','&lt;')});
 vm.runInContext(extract('uploadUrl')+'\n'+extract('renderUploads'),c);
 assert.equal(c.uploadUrl('investment/chart/uploads/../../secret.png'),null);
 c.renderUploads([{file:'investment/chart/uploads/20261008-135211.png',uploadedAt:'2026-10-08T13:52:11+08:00',status:'pending',note:'<script>'}]);
 assert.match(box.innerHTML,/待识别/);assert.match(box.innerHTML,/&lt;script>/);assert.match(box.innerHTML,/查看原图/);
 c.renderUploads([{file:'investment/chart/uploads/20261008-135211.png',status:'processed'}]);assert.match(box.innerHTML,/已入账/);
 assert.doesNotMatch(html,/通常30分钟内/);
});
test('screenshot recovery uses execution price, not live quote, with product purchase and bearish underlying kept distinct',()=>{
 const data=JSON.parse(fs.readFileSync(require('node:path').join(__dirname,'../investment/chart/trades.json')));const t=data.trades.find(t=>t.id==='T20261008-upload-135211');
 assert.ok(t);assert.equal(t.openPrice,0.035);assert.equal(t.size,'120000份');assert.equal(t.direction,'long');assert.equal(t.underlyingDirection,'short');assert.equal(t.instrumentType,'bear_certificate');assert.equal(data.trades.filter(x=>x.sourceScreenshot===t.sourceScreenshot).length,1);
 assert.match(html,/买入熊证 · 标的看空/);
});
test('upload API exposes queue through authenticated route and returns failure rather than false success',async()=>{
 const code=fs.readFileSync(require('node:path').join(__dirname,'../functions/api/upload.js'),'utf8');
 const mod=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
 const original=global.fetch;
 try {
  global.fetch=async()=>new Response(JSON.stringify([{status:'pending'}]));
  const r=await mod.onRequestGet({env:{},request:new Request('https://example.com/api/upload')});assert.equal(r.status,200);assert.equal((await r.json()).uploads[0].status,'pending');
  global.fetch=async()=>new Response('unavailable',{status:503});assert.equal((await mod.onRequestGet({env:{},request:new Request('https://example.com/api/upload')})).status,502);
 }finally{global.fetch=original;}
});
