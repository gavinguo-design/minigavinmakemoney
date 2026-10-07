// Cloudflare Pages Function: /api/hsi-participation
// Combines the latest official HSI constituent/weight baseline with current
// Tencent quotes.  It returns breadth and approximate point contribution.
// The frontend may tilt scenario weights only when coverage and reconciliation
// pass; triggers, stops and targets are never changed by this endpoint.

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36';

export async function onRequest(context) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  if (context.request.method === 'OPTIONS') return new Response(null, { headers: cors });

  const cache = caches.default;
  const cacheKey = new Request('https://cache.internal/api/hsi-participation', { method:'GET' });
  const cached = await cache.match(cacheKey);
  if (cached) {
    const response = new Response(cached.body, cached);
    response.headers.set('X-Cache', 'HIT');
    return response;
  }

  try {
    const baseline = await readBaseline(context);
    const codes = baseline.constituents.map((row) => row.security_id.split('.')[0]);
    const quotes = await fetchTencentQuotes(codes.concat(['HSI']));
    const payload = buildSnapshot(baseline, quotes);
    const response = json(payload, 200, {
      ...cors,
      'Cache-Control': 'public, max-age=30, s-maxage=30',
      'X-Cache': 'MISS',
    });
    context.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  } catch (error) {
    return json({ status:'unavailable', error:'participation fetch failed', detail:String(error && error.message || error) }, 200, cors);
  }
}

async function readBaseline(context) {
  if (!context.env || !context.env.ASSETS) throw new Error('ASSETS binding unavailable');
  const url = new URL('/chart/hsi-participation.json', context.request.url);
  const response = await context.env.ASSETS.fetch(new Request(url, { method:'GET' }));
  if (!response.ok) throw new Error('baseline HTTP ' + response.status);
  const data = await response.json();
  if (!data || !Array.isArray(data.constituents) || !data.constituents.length) throw new Error('invalid baseline');
  return data;
}

function quoteSymbol(code) {
  return code === 'HSI' ? 'r_hkHSI' : 'r_hk' + String(code).padStart(5, '0');
}

async function fetchTencentQuotes(codes) {
  const result = new Map();
  for (let offset = 0; offset < codes.length; offset += 35) {
    const chunk = codes.slice(offset, offset + 35);
    const query = chunk.map(quoteSymbol).join(',');
    const response = await fetch('https://qt.gtimg.cn/q=' + query, {
      headers: { 'User-Agent':UA, Referer:'https://gu.qq.com/' },
      signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) throw new Error('Tencent HTTP ' + response.status);
    const body = new TextDecoder('utf-8', { fatal:false }).decode(await response.arrayBuffer());
    for (const match of body.matchAll(/v_r_hk([A-Za-z0-9]+)="([^"]*)"/g)) {
      const fields = match[2].split('~');
      const price = parseFloat(fields[3]), previousClose = parseFloat(fields[4]);
      if (!(price > 0) || !(previousClose > 0)) continue;
      const stamp = fields[30] || '';
      result.set(match[1], { price, previousClose, return:(price / previousClose) - 1, timestamp:stamp });
    }
  }
  return result;
}

function buildSnapshot(baseline, quotes) {
  const rows = [];
  for (const base of baseline.constituents) {
    const code = base.security_id.split('.')[0].replace(/^0+/, '') || '0';
    const q = quotes.get(code.padStart(5, '0')) || quotes.get(code);
    if (!q) continue;
    rows.push({
      security_id:base.security_id, name:base.name, weight:base.weight,
      price:q.price, previous_close:q.previousClose, return:q.return,
      approximate_point_contribution:null, source_timestamp:q.timestamp,
    });
  }
  const indexQuote = quotes.get('HSI');
  const expectedWeight = baseline.constituents.reduce((sum, row) => sum + row.weight, 0);
  const weightCoverage = rows.reduce((sum, row) => sum + row.weight, 0);
  const indexPreviousClose = indexQuote && indexQuote.previousClose;
  rows.forEach((row) => {
    row.approximate_point_contribution = indexPreviousClose ? indexPreviousClose * row.weight * row.return : 0;
  });
  const advances = rows.filter((row) => row.return > 0).length;
  const declines = rows.filter((row) => row.return < 0).length;
  const unchanged = rows.length - advances - declines;
  const netPoints = rows.reduce((sum, row) => sum + row.approximate_point_contribution, 0);
  const grossPoints = rows.reduce((sum, row) => sum + Math.abs(row.approximate_point_contribution), 0);
  const positiveWeight = rows.filter((row) => row.return > 0).reduce((sum, row) => sum + row.weight, 0);
  const ranked = rows.slice().sort((a,b) => Math.abs(b.approximate_point_contribution) - Math.abs(a.approximate_point_contribution));
  const officialPoints = indexQuote ? indexQuote.price - indexQuote.previousClose : null;
  const tolerance = officialPoints == null ? 0 : Math.max(20, Math.abs(officialPoints) * 0.25);
  const difference = officialPoints == null ? null : netPoints - officialPoints;
  const quoteCoverage = rows.length / baseline.constituents.length;
  const reconciled = officialPoints != null && Math.abs(difference) <= tolerance;
  const timestamp = indexQuote && indexQuote.timestamp || rows.reduce((latest,row) => row.source_timestamp > latest ? row.source_timestamp : latest, '');
  const asOf = /^\d{8}/.test(timestamp) ? timestamp.slice(0,4) + '-' + timestamp.slice(4,6) + '-' + timestamp.slice(6,8) : baseline.as_of;
  const asOfMs = Date.parse(asOf + 'T00:00:00Z');
  const baselineMs = Date.parse(String(baseline.as_of || '') + 'T00:00:00Z');
  const baselineAgeDays = Number.isFinite(asOfMs) && Number.isFinite(baselineMs) ? Math.round((asOfMs - baselineMs) / 86400000) : null;
  // A prior-session weight panel is acceptable across a normal weekend/holiday,
  // but an abandoned updater must never keep tilting A/B/C with an old baseline.
  const baselineFresh = baselineAgeDays != null && baselineAgeDays >= 0 && baselineAgeDays <= 4;
  return {
    schema_version:'1.0.0', status:quoteCoverage >= 0.95 && Math.abs(weightCoverage - expectedWeight) <= 0.0005 && reconciled && baselineFresh ? 'available' : 'unavailable',
    mode:'intraday_preview', index_id:'HSI', as_of:asOf, baseline_date:baseline.as_of,
    updated_at:timestamp || null,
    source:{ name:'Tencent realtime quotes + Hang Seng Indexes official prior-session weights', kind:'intraday_weighted_estimate', baseline_sha256:baseline.source && baseline.source.sha256 },
    data_quality:{ constituent_count:baseline.constituents.length, quoted_count:rows.length, quote_coverage:quoteCoverage,
      weight_coverage:weightCoverage, expected_weight_coverage:expectedWeight, weight_rounding_tolerance:0.0005,
      baseline_age_days:baselineAgeDays, baseline_fresh:baselineFresh,
      reconciled, official_index_point_change:officialPoints, constituent_point_sum:netPoints,
      reconciliation_difference:difference, reconciliation_tolerance:tolerance,
      note:'点数贡献为前收盘权重近似值；覆盖或指数对账失败时不参与A/B/C校正。' },
    metrics:{ advances, declines, unchanged, equal_name_breadth:rows.length ? advances / rows.length : 0,
      weighted_breadth:weightCoverage ? positiveWeight / weightCoverage : 0,
      declining_weight_share:weightCoverage ? rows.filter((row)=>row.return<0).reduce((sum,row)=>sum+row.weight,0)/weightCoverage : 0,
      net_point_contribution:netPoints, gross_absolute_point_contribution:grossPoints,
      contribution_direction:grossPoints ? netPoints / grossPoints : 0,
      top_five_absolute_contribution_share:grossPoints ? ranked.slice(0,5).reduce((sum,row)=>sum+Math.abs(row.approximate_point_contribution),0)/grossPoints : 0,
      concentration_hhi:grossPoints ? rows.reduce((sum,row)=>sum + Math.pow(Math.abs(row.approximate_point_contribution)/grossPoints,2),0) : 0 },
    top_positive_contributors:rows.slice().sort((a,b)=>b.approximate_point_contribution-a.approximate_point_contribution).slice(0,5),
    top_negative_contributors:rows.slice().sort((a,b)=>a.approximate_point_contribution-b.approximate_point_contribution).slice(0,5),
  };
}

function json(body, status=200, headers={}) {
  return new Response(JSON.stringify(body), { status, headers:{ 'Content-Type':'application/json; charset=utf-8', ...headers } });
}

export const _test = { buildSnapshot, quoteSymbol };
