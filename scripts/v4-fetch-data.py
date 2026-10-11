#!/usr/bin/env python3
"""v4 research data: fetch Yahoo v8 chart daily history (2014-01-01 .. now) for HSI and pre-open
overnight series, normalise to research/v4/data/*.json with checksums. Research only.
Usage: python3 scripts/v4-fetch-data.py [raw_dir]   (raw_dir: reuse already downloaded raw JSON)
No interpolation: rows with null close are dropped and listed in `dropped_null_rows`.
"""
import json, sys, os, hashlib, datetime as D, urllib.request, time

ROOT = os.path.join(os.path.dirname(__file__), '..')
OUT = os.path.join(ROOT, 'research/v4/data')
P1, P2 = 1388534400, 1792000000  # 2014-01-01 .. 2026-10-14
SERIES = {
  # name: (yahoo symbol, tz offset hours used to derive the bar's *exchange-local* date, note)
  'HSI': ('^HSI', 8, 'Hang Seng Index cash; bar date = HKT date'),
  'GSPC': ('^GSPC', -5, 'S&P 500; bar date = US/Eastern date (timestamps are 09:30 ET, offset -4/-5 irrelevant for date)'),
  'IXIC': ('^IXIC', -5, 'Nasdaq Composite; bar date = US/Eastern date'),
  'EWH': ('EWH', -5, 'iShares MSCI Hong Kong ETF (US-listed); proxy for HK overnight move; bar date = US/Eastern'),
  'FXI': ('FXI', -5, 'iShares China Large-Cap ETF (US-listed); bar date = US/Eastern'),
  'KWEB': ('KWEB', -5, 'KraneShares China Internet ETF; bar date = US/Eastern'),
  'VIX': ('^VIX', -5, 'CBOE VIX (VHSI not available on Yahoo); bar date = US date'),
  'CNY': ('CNY=X', 1, 'Yahoo USD/CNY FX quote (CNH=X has no history on Yahoo); bar timestamp = 00:00 London (23:00Z in BST, 00:00Z in GMT) so +1h gives the London date; bar for London date d is complete at 24:00 London = 07:00/08:00 HKT d+1 (< 08:45)'),
}
UNAVAILABLE = {
  'CNH=X': 'Yahoo returns a single row (no history)',
  '^VHSI': 'Not Found on Yahoo',
  'HSI=F': 'Not Found on Yahoo (no HSI futures continuous / night session history)',
}

def fetch(sym, raw_dir):
    fn = os.path.join(raw_dir, sym.replace('^', '%5E').replace('=', '%3D') + '.json') if raw_dir else None
    if fn and os.path.exists(fn):
        raw = open(fn, 'rb').read()
    else:
        url = f'https://query1.finance.yahoo.com/v8/finance/chart/{urllib.request.quote(sym)}?interval=1d&period1={P1}&period2={P2}&events=history'
        raw = urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'}), timeout=30).read()
        time.sleep(1)
    return raw

def norm(raw, tz):
    r = json.loads(raw)['chart']['result'][0]
    q = r['indicators']['quote'][0]
    rows, dropped = [], []
    for i, t in enumerate(r['timestamp']):
        d = (D.datetime.fromtimestamp(t, D.UTC) + D.timedelta(hours=tz)).strftime('%Y-%m-%d')
        o, h, l, c, v = (q[k][i] for k in ('open', 'high', 'low', 'close', 'volume'))
        if c is None or o is None or h is None or l is None:
            dropped.append(d); continue
        rows.append({'date': d, 'open': round(o, 4), 'high': round(h, 4), 'low': round(l, 4), 'close': round(c, 4), 'volume': v})
    # dedupe (keep last)
    m = {}
    for x in rows: m[x['date']] = x
    return [m[k] for k in sorted(m)], dropped, r['meta'].get('exchangeTimezoneName')

def main():
    raw_dir = sys.argv[1] if len(sys.argv) > 1 else None
    os.makedirs(OUT, exist_ok=True)
    manifest = {'retrieved_at': D.datetime.now(D.UTC).isoformat(), 'source': 'yahoo-finance-v8-chart', 'unavailable': UNAVAILABLE, 'series': {}}
    for name, (sym, tz, note) in SERIES.items():
        raw = fetch(sym, raw_dir)
        rows, dropped, tzname = norm(raw, tz)
        if name == 'HSI':
            for x in rows:
                for k in ('open', 'high', 'low', 'close'): x[k] = round(x[k], 2)
        body = {'symbol': sym, 'name': name, 'note': note, 'exchange_tz': tzname, 'raw_response_sha256': hashlib.sha256(raw).hexdigest(),
                'dropped_null_rows': dropped, 'n': len(rows), 'first': rows[0]['date'], 'last': rows[-1]['date'], 'rows': rows}
        body['rows_sha256'] = hashlib.sha256(json.dumps(rows, separators=(',', ':')).encode()).hexdigest()
        json.dump(body, open(os.path.join(OUT, name + '.json'), 'w'), separators=(',', ':'))
        manifest['series'][name] = {k: body[k] for k in ('symbol', 'note', 'exchange_tz', 'n', 'first', 'last', 'dropped_null_rows', 'rows_sha256', 'raw_response_sha256')}
        print(name, len(rows), rows[0]['date'], rows[-1]['date'], 'dropped', dropped[:5])
    # cross-check HSI vs repo snapshot
    repo = json.load(open(os.path.join(ROOT, 'research/backtest/data/hsi-daily-2024-06_2026-10.json')))
    hsi = {x['date']: x for x in json.load(open(os.path.join(OUT, 'HSI.json')))['rows']}
    diffs, miss, maxd = [], [], 0
    for c in repo['candles']:
        y = hsi.get(c['date'])
        if not y: miss.append(c['date']); continue
        d = max(abs(y[k] - c[k]) for k in ('open', 'high', 'low', 'close'))
        maxd = max(maxd, d)
        if d > 0.011: diffs.append({'date': c['date'], 'max_abs': round(d, 2)})
    extra = [d for d in hsi if repo['candles'][0]['date'] <= d <= repo['candles'][-1]['date'] and d not in {c['date'] for c in repo['candles']}]
    manifest['hsi_crosscheck'] = {'against': 'research/backtest/data/hsi-daily-2024-06_2026-10.json', 'overlap': len(repo['candles']) - len(miss),
                                  'missing_in_new': miss, 'extra_in_new': extra, 'max_abs_ohlc_diff': round(maxd, 4), 'diffs_gt_0.01': diffs[:50], 'n_diffs': len(diffs)}
    print(json.dumps(manifest['hsi_crosscheck'])[:600])
    json.dump(manifest, open(os.path.join(OUT, 'manifest.json'), 'w'), indent=1)

if __name__ == '__main__':
    main()
