// Pre-open (08:45 HKT) overnight inputs for rule-weights-v4.
// Same source and date conventions as the research fetch (scripts/v4-fetch-data.py): Yahoo v8 chart daily bars,
// bar date = UTC timestamp shifted by a fixed exchange offset (US -5h, London +1h, HK +8h), closes rounded to 4dp.
// Fail-closed contract: this module never interpolates or fills. Any series that cannot be fetched, is empty,
// or is stale is reported in `errors`; build() then refuses v4 and falls back to v3 with an explicit annotation.
'use strict';
const SERIES = Object.freeze({
  HSI: {symbol: '^HSI', tz: 8, volume: true},
  EWH: {symbol: 'EWH', tz: -5}, GSPC: {symbol: '^GSPC', tz: -5}, IXIC: {symbol: '^IXIC', tz: -5},
  FXI: {symbol: 'FXI', tz: -5}, KWEB: {symbol: 'KWEB', tz: -5}, VIX: {symbol: '^VIX', tz: -5},
  CNY: {symbol: 'CNY=X', tz: 1},
});
const HOSTS = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];
const r4 = v => Math.round(v * 1e4) / 1e4;

function normalise(json, tz, withVolume) {
  const r = json?.chart?.result?.[0], q = r?.indicators?.quote?.[0];
  if (!r || !q || !Array.isArray(r.timestamp)) throw Error('malformed chart result');
  const m = new Map();
  r.timestamp.forEach((t, i) => {
    const c = q.close?.[i];
    if (!Number.isFinite(c) || ![q.open?.[i], q.high?.[i], q.low?.[i]].every(Number.isFinite)) return;
    const date = new Date(t * 1000 + tz * 3600e3).toISOString().slice(0, 10);
    m.set(date, withVolume ? {date, close: r4(c), volume: q.volume?.[i] ?? null} : {date, close: r4(c)});
  });
  return [...m.values()].sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchSeries(name, {fetchImpl = fetch, range = '6mo'} = {}) {
  const s = SERIES[name], errs = [];
  for (const host of HOSTS) {
    const url = host + '/v8/finance/chart/' + encodeURIComponent(s.symbol) + '?interval=1d&range=' + range;
    try {
      const r = await fetchImpl(url, {headers: {'User-Agent': 'Mozilla/5.0'}, signal: AbortSignal.timeout(15000)});
      if (!r.ok) throw Error('HTTP ' + r.status);
      const rows = normalise(await r.json(), s.tz, !!s.volume);
      if (!rows.length) throw Error('no rows');
      return {rows, url};
    } catch (e) { errs.push(host.replace('https://', '') + ': ' + e.message); }
  }
  throw Error(name + ' (' + s.symbol + ') unavailable: ' + errs.join('; '));
}

// Returns {status:'available'|'unavailable', fetched_at, source, series:{...}, errors:[...]}. Never throws.
async function fetchOvernight({now = Date.now(), fetchImpl = fetch} = {}) {
  const names = Object.keys(SERIES), errors = [], series = {}, urls = {};
  await Promise.all(names.map(async n => {
    try { const r = await fetchSeries(n, {fetchImpl}); series[n] = r.rows; urls[n] = r.url; }
    catch (e) { errors.push(e.message); }
  }));
  return {status: errors.length ? 'unavailable' : 'available', fetched_at: new Date(now).toISOString(),
    source: 'yahoo-finance-v8-chart', symbols: Object.fromEntries(names.map(n => [n, SERIES[n].symbol])), urls, series, errors};
}

module.exports = {SERIES, normalise, fetchSeries, fetchOvernight};
if (require.main === module) fetchOvernight().then(o => {
  const tail = Object.fromEntries(Object.entries(o.series).map(([k, v]) => [k, v.slice(-2)]));
  console.log(JSON.stringify({status: o.status, fetched_at: o.fetched_at, errors: o.errors, tail}, null, 1));
  if (o.status !== 'available') process.exitCode = 1;
});
