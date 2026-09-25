// Cloudflare Pages Function: /api/realtime
// Realtime HSI quote with multi-upstream fallback — solves Yahoo's ~15min
// delay and missing latest-day volume.
// Upstream chain (first success wins):
//   1. Eastmoney push2   (often blocks overseas CF edge IPs → 502, kept first
//                         in case of region-specific success)
//   2. Sina hq.sinajs.cn   (globally accessible, includes share volume)
//   3. Tencent qt.gtimg.cn (backup; index feed lacks share volume)
// Returns normalized JSON:
//   { price, open, high, low, volume, amount, prevClose, ts, source }
// On total failure returns { error } with HTTP 200 so the frontend can fall
// back to pure-Yahoo data gracefully.
//
// Field mappings (verified live 2026-09-25, HSI ≈ 24510.09):
//   EM:      f43 price ×100 | f44 high ×100 | f45 low ×100 | f46 open ×100
//            f47 volume raw | f48 amount raw | f60 prevClose ×100 | f86 unix sec
//   Tencent: v_r_hkHSI="100~恒生指数~HSI~price~prevClose~open~volume(万)~...
//            [3]price [4]prevClose [5]open [30]"2026/09/25 18:31:13"
//            [33]high [34]low [36]amount(万元)
//   Sina:    rt_hkHSI="HSI,name,[2]open,[3]prevClose,[4]high,[5]low,[6]price,
//            [7]chg,[8]pct,,,[11]amount(千元),[12]volume,...,[17]date,[18]time
//            (verified live 2026-09-25: index 16/17 was off-by-one and broke
//            ts parsing → valid() rejected Sina → silently fell through to
//            Tencent, which has no share volume. Fixed to 17/18.)

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export async function onRequest(context) {
  const { request } = context;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(request.url);
  const debug = url.searchParams.get('debug') === '1';

  // Short edge cache (15s) — realtime data, but avoid hammering upstreams.
  const cacheKey = new Request('https://cache.internal/api/realtime?symbol=HSI', { method: 'GET' });
  const cache = caches.default;
  if (!debug) {
    const cached = await cache.match(cacheKey);
    if (cached) {
      const resp = new Response(cached.body, cached);
      resp.headers.set('X-Cache', 'HIT');
      return resp;
    }
  }

  const errors = [];
  let payload = null;

  for (const fetcher of [fetchEastmoney, fetchSina, fetchTencent]) {
    try {
      payload = await fetcher();
      if (payload) break;
    } catch (e) {
      errors.push(fetcher.name + ': ' + String(e && e.message || e));
    }
  }

  if (!payload) {
    return json({ error: 'all upstreams failed', detail: errors }, corsHeaders);
  }

  // Defensive volume backfill: whichever upstream won the race above may lack
  // share volume (e.g. Eastmoney's overseas host occasionally omits f47, or a
  // future reorder puts Tencent first). Sina always carries share volume, so
  // if the winning payload has none, ask Sina just for that field and merge.
  if (payload.volume == null && payload.source !== 'sina') {
    try {
      const sinaPayload = await fetchSina();
      if (typeof sinaPayload.volume === 'number' && sinaPayload.volume > 0) {
        payload.volume = sinaPayload.volume;
        payload.source = payload.source + '+sina';
      }
    } catch (e) {
      errors.push('sinaVolumeBackfill: ' + String(e && e.message || e));
    }
  }

  // Volume-scale note: EM/Sina report ~2.5× Yahoo's share-volume universe for
  // HSI, so raw upstream volume must NOT be drawn on the Yahoo-based
  // histogram. Instead we ship today's + prev-day turnover (amount, same
  // source → consistent) so the frontend can estimate today's volume in
  // Yahoo scale: estVol = prevYahooVol × (amount / prevAmount).
  if (typeof payload.amount === 'number' && payload.amount > 0) {
    try {
      const pa = await fetchTencentPrevAmount(payload.ts);
      if (pa) payload.prevAmount = pa;
    } catch (e) {
      errors.push('prevAmount: ' + String(e && e.message || e));
    }
  }

  if (debug) payload = { ...payload, debugErrors: errors };

  const response = json(payload, {
    ...corsHeaders,
    'Cache-Control': 'public, max-age=15, s-maxage=15',
    'X-Cache': 'MISS',
  });
  context.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

// sanity check: HSI should be a 5-digit-ish positive number
function valid(p) {
  return p && typeof p.price === 'number' && p.price > 1000 && p.price < 200000 &&
    typeof p.ts === 'number' && p.ts > 0;
}

async function fetchEastmoney() {
  // push2 blocks overseas CF edge IPs (502); push2delay is a second chance.
  const hosts = ['push2.eastmoney.com', 'push2delay.eastmoney.com'];
  let data = null, lastErr = null;
  for (const host of hosts) {
    try {
      const r = await fetch(
        `https://${host}/api/qt/stock/get?secid=100.HSI&fields=f43,f44,f45,f46,f47,f48,f57,f58,f60,f86`,
        {
          headers: { 'User-Agent': UA, Accept: 'application/json', Referer: 'https://quote.eastmoney.com/' },
          signal: AbortSignal.timeout(5000),
        }
      );
      if (!r.ok) { lastErr = new Error('HTTP ' + r.status); continue; }
      data = await r.json();
      break;
    } catch (e) { lastErr = e; }
  }
  if (!data) throw (lastErr || new Error('all hosts failed'));
  const d = data && data.data;
  if (!d || typeof d.f43 !== 'number' || d.f43 <= 0) throw new Error('no data');
  const scale = (v) => (typeof v === 'number' && v > 0 ? v / 100 : null);
  const p = {
    symbol: 'HSI',
    price: scale(d.f43),
    high: scale(d.f44),
    low: scale(d.f45),
    open: scale(d.f46),
    volume: typeof d.f47 === 'number' && d.f47 > 0 ? d.f47 : null,
    amount: typeof d.f48 === 'number' && d.f48 > 0 ? d.f48 : null,
    prevClose: scale(d.f60),
    ts: typeof d.f86 === 'number' ? d.f86 : null,
    source: 'eastmoney',
  };
  if (!valid(p)) throw new Error('invalid values');
  return p;
}

// Parse "2026/09/25 18:31:13" (Beijing/HK time) → unix seconds
function cnTimeToUnix(dateStr, timeStr) {
  const iso = String(dateStr).replace(/\//g, '-') + 'T' + timeStr + '+08:00';
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

// Upstream bodies are GBK; ASCII digits/delimiters are single-byte and survive
// a lossy utf-8 decode, so numeric parsing stays safe without a GBK decoder.
async function fetchText(url, headers) {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const buf = await r.arrayBuffer();
  return new TextDecoder('utf-8', { fatal: false }).decode(buf);
}

async function fetchTencent() {
  const text = await fetchText('https://qt.gtimg.cn/q=r_hkHSI', {
    'User-Agent': UA, Referer: 'https://gu.qq.com/',
  });
  const m = text.match(/"([^"]+)"/);
  if (!m) throw new Error('unexpected body');
  const f = m[1].split('~');
  const num = (i) => { const v = parseFloat(f[i]); return Number.isFinite(v) && v > 0 ? v : null; };
  const p = {
    symbol: 'HSI',
    price: num(3),
    prevClose: num(4),
    open: num(5),
    high: num(33),
    low: num(34),
    volume: null, // tencent index feed has no share volume
    amount: num(36) != null ? Math.round(num(36) * 10000) : null, // 万元 → 元
    ts: f[30] ? cnTimeToUnix(f[30].split(' ')[0], f[30].split(' ')[1] || '00:00:00') : null,
    source: 'tencent',
  };
  if (!valid(p)) throw new Error('invalid values');
  return p;
}

async function fetchSina() {
  const text = await fetchText('https://hq.sinajs.cn/list=rt_hkHSI', {
    'User-Agent': UA, Referer: 'https://finance.sina.com.cn/',
  });
  const m = text.match(/"([^"]+)"/);
  if (!m) throw new Error('unexpected body');
  const f = m[1].split(',');
  const num = (i) => { const v = parseFloat(f[i]); return Number.isFinite(v) && v > 0 ? v : null; };
  const p = {
    symbol: 'HSI',
    open: num(2),
    prevClose: num(3),
    high: num(4),
    low: num(5),
    price: num(6),
    amount: num(11) != null ? Math.round(num(11) * 1000) : null, // 千元 → 元
    volume: num(12),
    ts: f[17] && f[18] ? cnTimeToUnix(f[17], f[18]) : null,
    source: 'sina',
  };
  if (!valid(p)) throw new Error('invalid values');
  return p;
}

// Tencent daily kline: rows [date, open, close, high, low, amount(元)].
// Verified 2026-09-25: ["2026-09-25",...,"102202959184.000"] = today's turnover.
// Returns the most recent completed trading day's amount before quoteTs's day.
async function fetchTencentPrevAmount(quoteTs) {
  const text = await fetchText(
    'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=hkHSI,day,,,5,qfq',
    { 'User-Agent': UA, Referer: 'https://gu.qq.com/' }
  );
  const data = JSON.parse(text);
  const node = data && data.data && data.data.hkHSI;
  const rows = node && (node.day || node.qfqday);
  if (!Array.isArray(rows) || rows.length < 2) throw new Error('no kline rows');
  const quoteDay = typeof quoteTs === 'number'
    ? new Date((quoteTs + 28800) * 1000).toISOString().slice(0, 10)
    : null;
  for (let i = rows.length - 1; i >= 0; i--) {
    const [date, , , , , amt] = rows[i];
    if (quoteDay && date >= quoteDay) continue; // skip today's (live) row
    const v = parseFloat(amt);
    if (Number.isFinite(v) && v > 0) return v;
  }
  throw new Error('no prev amount');
}

function json(obj, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...extraHeaders,
    },
  });
}
