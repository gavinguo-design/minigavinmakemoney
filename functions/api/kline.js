// Cloudflare Pages Function: /api/kline
// Proxy for Yahoo Finance chart API to avoid browser CORS.
// Usage: /api/kline?symbol=^HSI&interval=1d&range=2y
// Whitelisted symbols/intervals/ranges only. Responses cached ~5 minutes.

const ALLOWED_INTERVALS = new Set(['1d', '1wk', '60m', '15m']);
const ALLOWED_RANGES = new Set(['5d', '1mo', '3mo', '6mo', '1y', '2y', '5y']);

// symbol whitelist (prevent open-proxy abuse)
const ALLOWED_SYMBOLS = new Set([
  '^HSI',      // 恒生指数
  '^HSCE',     // 国企指数
  '^GSPC',     // 标普500
  '^IXIC',     // 纳斯达克综合
  '^N225',     // 日经225
  '000001.SS', // 上证指数
  '399001.SZ', // 深证成指
  'QQQ',       // 纳指100 ETF
  'BTC-USD',   // 比特币
]);
const DEFAULT_SYMBOL = '^HSI';

// sane default range per interval
const DEFAULT_RANGE = {
  '1d': '2y',
  '1wk': '5y',
  '60m': '3mo',
  '15m': '1mo',
};

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
  const interval = url.searchParams.get('interval') || '1d';
  let range = url.searchParams.get('range') || DEFAULT_RANGE[interval] || '1y';
  const symbol = url.searchParams.get('symbol') || DEFAULT_SYMBOL;

  if (!ALLOWED_SYMBOLS.has(symbol)) {
    return json({ error: 'invalid symbol', allowed: [...ALLOWED_SYMBOLS] }, 400, corsHeaders);
  }
  if (!ALLOWED_INTERVALS.has(interval)) {
    return json({ error: 'invalid interval', allowed: [...ALLOWED_INTERVALS] }, 400, corsHeaders);
  }
  if (!ALLOWED_RANGES.has(range)) {
    range = DEFAULT_RANGE[interval] || '1y';
  }

  // Edge cache (keyed by normalized URL)
  const cacheKey = new Request(
    `https://cache.internal/api/kline?symbol=${encodeURIComponent(symbol)}&interval=${interval}&range=${range}`,
    { method: 'GET' }
  );
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) {
    const resp = new Response(cached.body, cached);
    resp.headers.set('X-Cache', 'HIT');
    return resp;
  }

  const yahooUrl =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}`;

  let upstream;
  try {
    upstream = await fetch(yahooUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept': 'application/json',
      },
    });
  } catch (e) {
    return json({ error: 'upstream fetch failed', detail: String(e) }, 502, corsHeaders);
  }

  if (!upstream.ok) {
    return json({ error: 'upstream error', status: upstream.status }, 502, corsHeaders);
  }

  let data;
  try {
    data = await upstream.json();
  } catch (e) {
    return json({ error: 'upstream returned non-JSON' }, 502, corsHeaders);
  }

  const result = data && data.chart && data.chart.result && data.chart.result[0];
  if (!result || !result.timestamp) {
    return json({ error: 'no data from upstream', upstream: data && data.chart && data.chart.error }, 502, corsHeaders);
  }

  // Slim down payload: only what the chart needs.
  const q = (result.indicators && result.indicators.quote && result.indicators.quote[0]) || {};
  const meta = result.meta || {};
  const payload = {
    symbol: meta.symbol || symbol,
    interval,
    range,
    gmtoffset: meta.gmtoffset || 28800,
    regularMarketPrice: meta.regularMarketPrice ?? null,
    previousClose: meta.chartPreviousClose ?? null,
    fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh ?? null,
    fiftyTwoWeekLow: meta.fiftyTwoWeekLow ?? null,
    timestamp: result.timestamp,
    open: q.open || [],
    high: q.high || [],
    low: q.low || [],
    close: q.close || [],
    volume: q.volume || [],
  };

  const response = json(payload, 200, {
    ...corsHeaders,
    'Cache-Control': 'public, max-age=300, s-maxage=300',
    'X-Cache': 'MISS',
  });

  context.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

function json(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...extraHeaders,
    },
  });
}
