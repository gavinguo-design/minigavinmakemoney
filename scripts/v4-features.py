#!/usr/bin/env python3
"""v4 research: build the pre-open (08:45 HKT) feature table for every regenerated session.

Point-in-time rules (strict):
  * Session t (HKT date), cutoff t 08:45 HKT. HK baseline b = last completed HK session < t (16:10 HKT b).
  * US series (^GSPC ^IXIC EWH FXI KWEB ^VIX): bar for US date d closes 16:00 ET = 04:00 (EDT) / 05:00 (EST) HKT on d+1,
    always < 08:45 HKT. Known at cutoff: US dates d < t. Known at HK baseline close (16:10 HKT b): US dates d < b.
    "Overnight" move = log(close at last US date < t) - log(close at last US date < b)  (cumulative over every US session
    that closed after the HK baseline close; 0 sessions -> 0.0 with n_us=0, which is a real 'no new US session', not imputation).
  * CNY=X (Yahoo USD/CNY; CNH=X has no Yahoo history): daily bar keyed by London date; London midnight = 07:00/08:00 HKT,
    so London dates < t are complete at 08:45 HKT t. Same differencing (dates < t) - (dates < b).
  * HSI volume: prior-day volume / mean of the 20 sessions before it (all <= b).
  * Features needing data that is missing are emitted as None and listed; models drop rows with None in used features.
Output: research/v4/data/features.json
"""
import json, os, math, bisect

ROOT = os.path.join(os.path.dirname(__file__), '..')
D = os.path.join(ROOT, 'research/v4/data')

def load(name):
    rows = json.load(open(os.path.join(D, name + '.json')))['rows']
    return [r['date'] for r in rows], rows

def last_before(dates, rows, day):
    i = bisect.bisect_left(dates, day) - 1
    return (i, rows[i]) if i >= 0 else (None, None)

def main():
    S = json.load(open(os.path.join(D, 'sessions.json')))['rows']
    hd, hr = load('HSI')
    hidx = {d: i for i, d in enumerate(hd)}
    ext = {k: load(k) for k in ('GSPC', 'IXIC', 'EWH', 'FXI', 'KWEB', 'VIX', 'CNY')}
    out, missing = [], {}
    for s in S:
        t, b = s['date'], s['baseline']
        f = {'date': t, 'baseline': b}
        atrp = s['atr14'] / s['base_close']  # ATR as fraction of price (from bars <= b)
        f['atr_pct'] = atrp
        for k, (dates, rows) in ext.items():
            i1, r1 = last_before(dates, rows, t)
            i0, r0 = last_before(dates, rows, b)
            # sanity: anything used must be strictly before t (date-level) -> guaranteed by bisect_left
            if r1 is None or r0 is None:
                f[k + '_ret'] = None; missing.setdefault(k, []).append(t); continue
            assert r1['date'] < t and r0['date'] < b
            f[k + '_n'] = i1 - i0
            f[k + '_ret'] = math.log(r1['close'] / r0['close'])
            f[k + '_last'] = r1['date']
            if k == 'VIX':
                f['VIX_lvl'] = math.log(r1['close'])
        # normalised overnight moves (in HSI-ATR units)
        for k in ('GSPC', 'IXIC', 'EWH', 'FXI', 'KWEB', 'CNY'):
            f[k + '_atr'] = None if f.get(k + '_ret') is None else max(-4, min(4, f[k + '_ret'] / atrp))
        f['VIX_chg'] = f.get('VIX_ret')
        # HSI own history (<= b)
        j = hidx[b]
        hb = hr[j]
        vols = [hr[x]['volume'] for x in range(j - 20, j)] if j >= 20 else []
        f['vol_ratio'] = (math.log(hb['volume'] / (sum(vols) / 20)) if vols and all(vols) and hb['volume'] else None)
        f['ret1_atr'] = max(-4, min(4, math.log(hb['close'] / hr[j - 1]['close']) / atrp)) if j >= 1 else None
        f['ret5_atr'] = max(-6, min(6, math.log(hb['close'] / hr[j - 5]['close']) / atrp)) if j >= 5 else None
        rng = (s['upper'] - s['lower']) / s['atr14']
        f['width_atr'] = min(rng, 10)
        f['dist_up_atr'] = max(-4, min(4, (s['upper'] - s['base_close']) / s['atr14']))
        f['dist_lo_atr'] = max(-4, min(4, (s['base_close'] - s['lower']) / s['atr14']))
        # EWH-implied pre-open position: where the overnight HK proxy move puts the index relative to the triggers
        if f.get('EWH_ret') is not None:
            imp = s['base_close'] * math.exp(f['EWH_ret'])
            f['imp_up_atr'] = max(-4, min(4, (s['upper'] - imp) / s['atr14']))
            f['imp_lo_atr'] = max(-4, min(4, (imp - s['lower']) / s['atr14']))
        else:
            f['imp_up_atr'] = f['imp_lo_atr'] = None
        out.append(f)
    json.dump({'generated_by': 'scripts/v4-features.py', 'n': len(out), 'missing': {k: len(v) for k, v in missing.items()}, 'rows': out},
              open(os.path.join(D, 'features.json'), 'w'), separators=(',', ':'))
    print(len(out), {k: len(v) for k, v in missing.items()}, sum(1 for f in out if f['vol_ratio'] is None))
    print(out[1000])

if __name__ == '__main__':
    main()
