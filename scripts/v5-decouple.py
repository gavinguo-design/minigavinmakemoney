#!/usr/bin/env python3
"""v5 direction 2: HK-US decoupling (pre-registered D1..D6, research/v5/preregistration.md).
Decoupling indicator, strictly point-in-time: for session t with baseline b, use the N most recent completed HK trading days
d <= b (every HSI trading day, not only generated sessions). For each such day d with previous HK day d-1:
   hk_ret(d)  = log(HSI close d / HSI close d-1)
   us_ovn(d)  = log(last US close with date < d) - log(last US close with date < d-1)   (same rule as v4 overnight features)
rho_N(t) = Pearson corr over those N days. Everything used is known at HSI close b (16:10 HKT) < cutoff t 08:45.
Writes research/v5/decouple-features.json, research/v5/decouple.json, research/v5/search-ledger.json (decoupling part)."""
import json, os, sys, bisect, importlib.util, math
import numpy as np

H = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(H, '..'); D = os.path.join(ROOT, 'research/v4/data')
spec = importlib.util.spec_from_file_location('wf', os.path.join(H, 'v4-walkforward.py')); WF = importlib.util.module_from_spec(spec); spec.loader.exec_module(WF)
L = WF.L; y = WF.y; years = WF.years; S = WF.S
V4 = [c for c in WF.CANDIDATES if c[0] == 'v3+overnight+struct+imp'][0][2]
US3 = ['GSPC_atr', 'IXIC_atr', 'VIX_chg']


def rows(n): return json.load(open(os.path.join(D, n + '.json')))['rows']


def daily_pairs(hsi, us):
    ud = [r['date'] for r in us]; uc = [r['close'] for r in us]
    def last(day):
        i = bisect.bisect_left(ud, day) - 1; return uc[i] if i >= 0 else None
    out = {}
    for j in range(1, len(hsi)):
        d, p = hsi[j]['date'], hsi[j - 1]['date']; a, b = last(d), last(p)
        if a and b: out[d] = (math.log(hsi[j]['close'] / hsi[j - 1]['close']), math.log(a / b))
    return out


def rolling_rho(pairs, hsi_dates, base, N):
    i = bisect.bisect_right(hsi_dates, base)  # days <= base
    win = [pairs[d] for d in hsi_dates[max(0, i - N):i] if d in pairs]
    if len(win) < N * 0.9: return None
    a = np.array(win); 
    if a[:, 1].std() == 0 or a[:, 0].std() == 0: return 0.0
    return float(np.corrcoef(a[:, 0], a[:, 1])[0, 1])


def build_features():
    hsi = rows('HSI'); hd = [r['date'] for r in hsi]
    ps = daily_pairs(hsi, rows('GSPC')); pe = daily_pairs(hsi, rows('EWH'))
    out = []
    for s in S:
        b = s['baseline']
        out.append({'date': s['date'], 'rho_spx_60': rolling_rho(ps, hd, b, 60), 'rho_spx_120': rolling_rho(ps, hd, b, 120), 'rho_ewh_60': rolling_rho(pe, hd, b, 60)})
    json.dump({'generated_by': 'scripts/v5-decouple.py', 'rows': out}, open(os.path.join(ROOT, 'research/v5/decouple-features.json'), 'w'), separators=(',', ':'))
    return out


def main():
    fr = build_features()
    for k in ('rho_spx_60', 'rho_spx_120', 'rho_ewh_60'):
        WF.COLS[k] = np.array([np.nan if f[k] is None else f[k] for f in fr], float)
    rs60 = WF.COLS['rho_spx_60']; re60 = WF.COLS['rho_ewh_60']
    g60 = np.clip(rs60 / 0.5, 0, 1); g120 = np.clip(WF.COLS['rho_spx_120'] / 0.5, 0, 1)
    base = {f: WF.X_of([f])[:, 0] for f in V4 + US3}
    for f in US3:
        WF.COLS[f + '*rho60'] = base[f] * rs60; WF.COLS[f + '*g60'] = base[f] * g60; WF.COLS[f + '*g120'] = base[f] * g120
    for f in ('EWH_atr', 'imp_up_atr', 'imp_lo_atr'): WF.COLS[f + '*rhoE60'] = base[f] * re60
    rep = lambda suf: [f + suf if f in US3 else f for f in V4]
    CANDS = [
        ('v4', 'lr', V4, {}),
        ('D1:v4+rho_spx_60', 'lr', V4 + ['rho_spx_60'], {}),
        ('D2:v4+US3*rho60', 'lr', V4 + [f + '*rho60' for f in US3], {}),
        ('D3:v4,US3 x g60 (downweight when decoupled)', 'lr', rep('*g60'), {}),
        ('D4:v4,US3 x g120', 'lr', rep('*g120'), {}),
        ('D5:v4+rho_ewh_60+EWH/imp*rhoE60', 'lr', V4 + ['rho_ewh_60', 'EWH_atr*rhoE60', 'imp_up_atr*rhoE60', 'imp_lo_atr*rhoE60'], {}),
        ('D6:v4+rho_spx_60+US3*rho60+rho_ewh_60', 'lr', V4 + ['rho_spx_60'] + [f + '*rho60' for f in US3] + ['rho_ewh_60'], {}),
    ]
    # common row mask: rows where every candidate has all features (rho needs ~60 prior HK days -> 2014 rows drop, eval years unaffected)
    ok = np.all([~np.isnan(WF.X_of(c[2])).any(1) for c in CANDS], 0)
    preds = {}
    for name, kind, feats, kw in CANDS:
        P = np.full((len(S), 3), np.nan)
        for Y in list(range(2016, 2027)):
            tr = (years < Y) & ok; te = (years == Y) & ok
            p, _ = WF.lr_fit_predict(tr, te, feats, **kw); P[te] = p
        preds[name] = P
    EV = list(range(2016, 2026)); wf = ok & (years >= 2016) & (years <= 2025); hold = ok & (years == 2026)
    br = {k: L.brier_rows(L.round_all(np.nan_to_num(P, nan=1 / 3)), y) for k, P in preds.items()}
    def m(P, mask):
        Pr = L.round_all(P[mask]); yy = y[mask]
        return {'n': int(mask.sum()), 'brier': float(L.brier_rows(Pr, yy).mean()), 'logloss': float(L.logloss_rows(Pr, yy).mean()), 'hit': float(L.hit_rows(Pr, yy).mean()), 'ece': float(L.ece(Pr, yy))}
    dec = wf & (years >= 2017) & (years <= 2019)
    res = {}
    for k, P in preds.items():
        r = {'wf': m(P, wf), 'y2017_2019': m(P, dec), 'by_year': {str(Y): m(P, wf & (years == Y)) for Y in EV},
             'low_corr_days(rho_spx_60<0.2)': m(P, wf & (rs60 < 0.2))}
        if k != 'v4':
            d = br[k] - br['v4']
            r['vs_v4'] = {'year_block_ci': L.year_block_ci(d[wf], years[wf]), 'years_won': int(sum(d[wf & (years == Y)].mean() < 0 for Y in EV)),
                          'delta_2017_2019': float(d[dec].mean()), 'delta_low_corr_days': float(d[wf & (rs60 < 0.2)].mean())}
            v = r['vs_v4']; r['passes'] = bool(v['year_block_ci'][2] < 0 and v['years_won'] >= 6 and v['delta_2017_2019'] < 0)
        res[k] = r
        print(k, {a: round(b, 4) for a, b in r['wf'].items() if a != 'n'}, r.get('vs_v4') and ([round(x, 4) for x in r['vs_v4']['year_block_ci']], r['vs_v4']['years_won'], round(r['vs_v4']['delta_2017_2019'], 4), round(r['vs_v4']['delta_low_corr_days'], 4)), r.get('passes'), file=sys.stderr)
    # pre-registered selection: lowest wf Brier among D1..D6
    Dk = [k for k in res if k != 'v4']; sel = min(Dk, key=lambda k: res[k]['wf']['brier'])
    # nested selection over {v4, D1..D6}
    byY = {k: {Y: br[k][wf & (years == Y)].mean() for Y in EV} for k in preds}; nested = np.full(len(S), np.nan); picks = {}
    for Y in EV[2:]:
        k = min(preds, key=lambda c: np.mean([byY[c][z] for z in EV if z < Y])); picks[str(Y)] = k; mm = wf & (years == Y); nested[mm] = br[k][mm]
    nm = wf & (years >= 2018); dn = nested[nm] - br['v4'][nm]
    nres = {'picks': picks, 'brier_nested_2018_2025': float(nested[nm].mean()), 'brier_v4_2018_2025': float(br['v4'][nm].mean()), 'delta_year_block_ci': L.year_block_ci(dn, years[nm])}
    print('selected', sel, 'passes', res[sel]['passes'], 'NESTED', nres, file=sys.stderr)
    # holdout 2026 looked at ONCE, after selection, for the selected candidate and v4 only
    hres = {'note': '2026-01-01..2026-10-09; looked at once after selection; 2026-05-18+ part is not fully clean (see v4 report)',
            'v4': m(preds['v4'], hold), sel: m(preds[sel], hold), 'delta_day_block_ci': L.day_block_ci((br[sel] - br['v4'])[hold])}
    print('HOLDOUT', hres, file=sys.stderr)
    # correlation regime description
    desc = {str(Y): {'rho_spx_60_mean': float(np.nanmean(rs60[years == Y])), 'rho_ewh_60_mean': float(np.nanmean(re60[years == Y]))} for Y in range(2015, 2027)}
    print('rho by year', {k: round(v['rho_spx_60_mean'], 2) for k, v in desc.items()}, file=sys.stderr)
    json.dump({'results': res, 'selected': sel, 'selected_passes': res[sel]['passes'], 'nested': nres, 'holdout_2026': hres, 'rho_by_year': desc, 'n_wf': int(wf.sum())},
              open(os.path.join(ROOT, 'research/v5/decouple.json'), 'w'), indent=1, default=float)


if __name__ == '__main__':
    main()
