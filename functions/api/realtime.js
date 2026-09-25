// Cloudflare Pages Function: /api/realtime
// Proxy for Eastmoney realtime quote (push2.eastmoney.com) — solves Yahoo's
// ~15min delay and missing latest-day volume for ^HSI.
// Usage: /api/realtime?symbol=HSI
// Returns normalized JSON:
//   { price, open, high, low, volume, amount, prevClose, ts, source: "eastmoney" }
// On any failure returns { error: "..." } with HTTP 200 so the frontend can
// gracefully fall back to pure-Yahoo data without special status handling.
//
// Field mapping (verified against live API on 2026-09-25, HSI ≈ 24510):
//   f43 latest price  ×100 (2451009 → 24510.09)
//   f44 day high      ×100
//   f45 day low       ×100
//   f46 day open      ×100
//   f47 volume        raw  (matches kline f56)
//   f48 amount        raw
//   f60 prev close    ×100 (2476113 → 24761.13)
//   f86 timestamp     unix seconds

const EM_SYMBOLS = {
  HSI: '100.HSI',   // 恒生指数
  HSCE: '100.HSCEI',
};
const DEFAULT_SYMBOL = 'HSI';

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
  const symbol = url.searchParams.get('symbol') || DEFAULT_SYMBOL;
  const secid = EM_SYMBOLS[symbol];
  if (!secid) {
    return json({ error: 'invalid symbol', allowed: Object.keys(EM_SYMBOLS) }, corsHeaders);
  }

  // Short edge cache (15s) — realtime data, but avoid hammering upstream.
  const cacheKey = new Request(
    `https://cache.internal/api/realtime?symbol=${encodeURIComponent(symbol)}`,
    { method: 'GET' }
  );
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) {
    const resp = new Response(cached.body, cached);
    resp.headers.set('X-Cache', 'HIT');
    return resp;
  }

  const emUrl =
    `https://push2.eastmoney.com/api/qt/stock/get?secid=${encodeURIComponent(secid)}` +
    `&fields=f43,f44,f45,f46,f47,f48,f57,f58,f60,f86`;

  let upstream;
  try {
    upstream = await fetch(emUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept': 'application/json',
        'Referer': 'https://quote.eastmoney.com/',
      },
    });
  } catch (e) {
    return json({ error: 'upstream fetch failed', detail: String(e) }, corsHeaders);
  }

  if (!upstream.ok) {
    return json({ error: 'upstream error', status: upstream.status }, corsHeaders);
  }

  let data;
  try {
    data = await upstream.json();
  } catch (e) {
    return json({ error: 'upstream returned non-JSON' }, corsHeaders);
  }

  const d = data && data.data;
  if (!d || typeof d.f43 !== 'number' || d.f43 <= 0) {
    return json({ error: 'no valid data from upstream' }, corsHeaders);
  }

  const scale = (v) => (typeof v === 'number' && v > 0 ? v / 100 : null);

  const payload = {
    symbol,
    name: d.f58 || null,
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

  const response = json(payload, {
    ...corsHeaders,
    'Cache-Control': 'public, max-age=15, s-maxage=15',
    'X-Cache': 'MISS',
  });

  context.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
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
