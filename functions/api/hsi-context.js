// Cloudflare Pages Function: /api/hsi-context
// Live HSI futures, cash-futures basis, executable spread and VHSI risk context.
// Direction comes only from futures; liquidity/volatility can reduce reliability.

const UA = 'Mozilla/5.0 (compatible; minigavin-market-context/1.0)';

export async function onRequestGet() {
  const cache = caches.default;
  const key = new Request('https://cache.internal/api/hsi-context');
  const cached = await cache.match(key);
  if (cached) return cached;
  try {
    const [future, cash, vhsi] = await Promise.all([fetchFuture(), fetchCash(), fetchVhsi()]);
    const payload = buildContext(future, cash, vhsi, Date.now());
    const response = Response.json(payload, { headers:{ 'Cache-Control':'public, max-age=15', 'Access-Control-Allow-Origin':'*' } });
    await cache.put(key, response.clone());
    return response;
  } catch (error) {
    return Response.json({ schema_version:'1.0.0', status:'unavailable', issue:String(error && error.message || error), generated_at:new Date().toISOString() }, { status:503, headers:{ 'Cache-Control':'no-store' } });
  }
}

async function text(url, referer) {
  const r = await fetch(url, { headers:{ 'User-Agent':UA, Referer:referer }, signal:AbortSignal.timeout(7000) });
  if (!r.ok) throw new Error('upstream HTTP ' + r.status);
  return new TextDecoder('utf-8', { fatal:false }).decode(await r.arrayBuffer());
}
function number(v) { const n = Number.parseFloat(v); return Number.isFinite(n) ? n : null; }
function unix(date, time) {
  const ms = Date.parse(String(date).replace(/\//g, '-') + 'T' + String(time) + '+08:00');
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}
function quoted(body) { const m = body.match(/"([^"]*)"/); return m ? m[1] : ''; }

async function fetchFuture() {
  const body = await text('https://hq.sinajs.cn/list=hf_HSI', 'https://finance.sina.com.cn/');
  const f = quoted(body).split(',');
  const q = { symbol:'HSI-front', price:number(f[0]), change_pct:number(f[1]), bid:number(f[2]), ask:number(f[3]), high:number(f[4]), low:number(f[5]), previous_close:number(f[7]), open:number(f[8]), volume:number(f[9]), bid_size:number(f[10]), ask_size:number(f[11]), ts:unix(f[12],f[6]), open_interest:number(f[14]), source:'Sina hf_HSI' };
  if (!(q.price > 0) || !(q.previous_close > 0) || !q.ts) throw new Error('invalid HSI futures quote');
  return q;
}
async function fetchCash() {
  const body = await text('https://qt.gtimg.cn/q=r_hkHSI', 'https://gu.qq.com/');
  const f = quoted(body).split('~');
  const stamp = String(f[30] || '').split(' ');
  const q = { symbol:'HSI', price:number(f[3]), previous_close:number(f[4]), amount_hkd:number(f[36]) == null ? null : Math.round(number(f[36]) * 10000), ts:unix(stamp[0],stamp[1] || '00:00:00'), source:'Tencent r_hkHSI' };
  if (!(q.price > 0) || !(q.previous_close > 0) || !q.ts) throw new Error('invalid HSI cash quote');
  return q;
}
async function fetchVhsi() {
  const body = await text('https://qt.gtimg.cn/q=r_hkVHSI', 'https://gu.qq.com/');
  const f = quoted(body).split('~');
  const stamp = String(f[30] || '').split(' ');
  const q = { symbol:'VHSI', price:number(f[3]), previous_close:number(f[4]), change:number(f[31]), change_pct:number(f[32]), high:number(f[33]), low:number(f[34]), ts:unix(stamp[0],stamp[1] || '00:00:00'), source:'Tencent r_hkVHSI' };
  if (!(q.price > 0) || !(q.previous_close > 0) || !q.ts) throw new Error('invalid VHSI quote');
  return q;
}

function buildContext(future, cash, vhsi, nowMs) {
  const newest = Math.max(future.ts, cash.ts, vhsi.ts);
  const spread = future.ask != null && future.bid != null ? future.ask - future.bid : null;
  const basis = future.price - cash.price;
  const basisPct = basis / cash.price;
  const overnightReturn = future.price / future.previous_close - 1;
  const expectedDailyMove = cash.price * (vhsi.price / 100) / Math.sqrt(252);
  const futureAge = Math.max(0, nowMs / 1000 - future.ts);
  const quoteFresh = futureAge <= 20 * 60;
  const spreadOk = spread != null && spread >= 0 && spread <= 12;
  return {
    schema_version:'1.0.0', status:quoteFresh && spreadOk ? 'available' : 'observe_only', generated_at:new Date(nowMs).toISOString(), as_of:new Date(newest * 1000).toISOString(),
    futures:{ ...future, basis_points:basis, basis_pct:basisPct, return_from_previous_close:overnightReturn, quote_age_seconds:futureAge },
    liquidity:{ status:spreadOk ? 'proxy_available':'degraded', proxy:'front-month futures best bid/ask spread', spread_points:spread, spread_bps:spread == null ? null : spread / future.price * 10000, session_volume:future.volume, open_interest:future.open_interest, cash_turnover_hkd:cash.amount_hkd },
    options_risk:{ status:'available', ...vhsi, meaning:'30-calendar-day expected HSI volatility implied by near/next-term HSI options', expected_one_day_move_points:expectedDailyMove, directional_signal:false },
    data_quality:{ futures_fresh:quoteFresh, spread_usable:spreadOk, timestamps:{ futures:future.ts, cash:cash.ts, vhsi:vhsi.ts } },
    source:{ futures:'Sina hf_HSI realtime quote', cash:'Tencent r_hkHSI realtime quote', volatility:'Tencent r_hkVHSI quote; index definition by Hang Seng Indexes' }
  };
}

export const _test = { buildContext };
