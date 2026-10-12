#!/usr/bin/env python3
"""v5 direction 3: read-only historical K-lines from the local Futu OpenD (127.0.0.1:11111) QUOTE context.
No login, no trade context, no subscriptions needed (request_history_kline only).
Writes research/v5/data/{VHSI,HSIF60,CUS60}.json + manifest."""
import json, os, hashlib, datetime
from futu import OpenQuoteContext, RET_OK, KLType
OUT = os.path.join(os.path.dirname(__file__), '..', 'research/v5/data')
JOBS = [('VHSI', 'HK.800125', KLType.K_DAY, '恒指波幅指数 VHSI 日线（HKT 交易日）'),
        ('HSIF60', 'HK.HSImain', KLType.K_60M, '恒指期货主连 60 分钟线（含夜盘，time_key = HKT 钟点，K 线结束时刻）'),
        ('CUS60', 'HK.CUSmain', KLType.K_60M, '港交所美元兑人民币(香港)期货主连 60 分钟线（CNH 代理）')]
q = OpenQuoteContext(host='127.0.0.1', port=11111); man = {'retrieved_at': datetime.datetime.utcnow().isoformat() + 'Z', 'source': 'Futu OpenD request_history_kline (quote only)', 'series': {}}
try:
    for name, code, kt, note in JOBS:
        rows, pk = [], None
        while True:
            ret, d, pk = q.request_history_kline(code, start='2006-01-01', end='2026-10-10', ktype=kt, max_count=1000, page_req_key=pk)
            assert ret == RET_OK, (code, d)
            rows += [{'t': r.time_key, 'open': float(r.open), 'high': float(r.high), 'low': float(r.low), 'close': float(r.close), 'volume': float(r.volume)} for r in d.itertuples()]
            if pk is None: break
        s = json.dumps(rows, separators=(',', ':'))
        json.dump({'code': code, 'note': note, 'rows': rows}, open(os.path.join(OUT, name + '.json'), 'w'), separators=(',', ':'))
        man['series'][name] = {'code': code, 'ktype': str(kt), 'note': note, 'n': len(rows), 'first': rows[0]['t'], 'last': rows[-1]['t'], 'rows_sha256': hashlib.sha256(s.encode()).hexdigest()}
        print(name, man['series'][name])
finally:
    q.close()
man['unavailable'] = {'VHSI futures (HK.VHSImain)': 'unknown code in Futu', 'stooq': 'all requests return a JS proof-of-work page (no CSV) from this host', 'Yahoo CNH=X / USDCNH=X': 'single row only'}
json.dump(man, open(os.path.join(OUT, 'manifest.json'), 'w'), indent=1, ensure_ascii=False)
