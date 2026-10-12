#!/usr/bin/env python3
"""v5 direction 3 experiments E1..E3 (pre-registered addendum in research/v5/preregistration.md).
E1 VHSI (daily, 2013-09+): full 2016-2025 protocol.  E2 HSI futures night session, E3 USD/CNH futures (60m bars, 2018-10+ / 2019-07+):
v4 vs v4+feature on the SAME rows (feature available), eval years 2021..2025.
Point-in-time: session t cutoff 08:45 HKT; baseline b. 60m bar time_key = bar END time (HKT); bar counts as known iff time_key <= cutoff.
Baseline futures price = last bar with time_key <= b 16:30 (end of day session; HSI cash closes 16:10). Writes research/v5/data-experiments.json"""
import json, os, sys, bisect, math, importlib.util
import numpy as np

H = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(H, '..'); D5 = os.path.join(ROOT, 'research/v5/data')
spec = importlib.util.spec_from_file_location('wf', os.path.join(H, 'v4-walkforward.py')); WF = importlib.util.module_from_spec(spec); spec.loader.exec_module(WF)
L = WF.L; y = WF.y; years = WF.years; S = WF.S
V4 = [c for c in WF.CANDIDATES if c[0] == 'v3+overnight+struct+imp'][0][2]
clip = lambda v, a: max(-a, min(a, v))


def load(n): return json.load(open(os.path.join(D5, n + '.json')))['rows']


def bar_feats():
    vh = load('VHSI'); vd = [r['t'][:10] for r in vh]; vc = [r['close'] for r in vh]
    fut = {k: load(k) for k in ('HSIF60', 'CUS60')}; ft = {k: [r['t'] for r in v] for k, v in fut.items()}
    out = {k: [] for k in ('VHSI_lvl', 'VHSI_chg', 'nf_move_atr', 'nf_imp_up_atr', 'nf_imp_lo_atr', 'cnh_atr', 'nf_hours')}
    roll_like = 0
    for s in S:
        t, b = s['date'], s['baseline']; atrp = s['atr14'] / s['base_close']
        i = bisect.bisect_right(vd, b) - 1
        if i >= 1 and vd[i] == b:
            out['VHSI_lvl'].append(math.log(vc[i])); out['VHSI_chg'].append(math.log(vc[i] / vc[i - 1]))
        else:
            out['VHSI_lvl'].append(np.nan); out['VHSI_chg'].append(np.nan)
        cut, base = t + ' 08:45:00', b + ' 16:30:00'
        for k, nm in (('HSIF60', 'nf'), ('CUS60', 'cnh')):
            T, R = ft[k], fut[k]
            i1 = bisect.bisect_right(T, cut) - 1; i0 = bisect.bisect_right(T, base) - 1
            ok = i0 >= 0 and i1 > i0 and T[i0][:10] == b and T[i0] >= b + ' 16:00:00'
            if not ok:
                if nm == 'nf': [out[x].append(np.nan) for x in ('nf_move_atr', 'nf_imp_up_atr', 'nf_imp_lo_atr', 'nf_hours')]
                else: out['cnh_atr'].append(np.nan)
                continue
            mv = math.log(R[i1]['close'] / R[i0]['close'])
            if nm == 'nf':
                if abs(mv) > 0.05: roll_like += 1
                out['nf_move_atr'].append(clip(mv / atrp, 4)); imp = s['base_close'] * math.exp(mv)
                out['nf_imp_up_atr'].append(clip((s['upper'] - imp) / s['atr14'], 4)); out['nf_imp_lo_atr'].append(clip((imp - s['lower']) / s['atr14'], 4))
                out['nf_hours'].append(i1 - i0)
            else:
                out['cnh_atr'].append(clip(mv / atrp, 4))
    return {k: np.array(v, float) for k, v in out.items()}, roll_like


def run(feats, mask, years_eval):
    P = np.full((len(S), 3), np.nan)
    for Y in years_eval + [2026]:
        tr = (years < Y) & mask; te = (years == Y) & mask
        if te.any(): P[te] = WF.lr_fit_predict(tr, te, feats)[0]
    return P


def summarize(name, Pb, Pc, mask, ev):
    wf = mask & np.isin(years, ev); br = lambda P: L.brier_rows(L.round_all(np.nan_to_num(P, nan=1 / 3)), y)
    def m(P, mm):
        Pr = L.round_all(P[mm]); yy = y[mm]
        return {'n': int(mm.sum()), 'brier': float(L.brier_rows(Pr, yy).mean()), 'logloss': float(L.logloss_rows(Pr, yy).mean()), 'hit': float(L.hit_rows(Pr, yy).mean()), 'ece': float(L.ece(Pr, yy))}
    d = br(Pc) - br(Pb)
    r = {'eval_years': ev, 'v4_same_rows': m(Pb, wf), 'candidate': m(Pc, wf), 'year_block_ci': L.year_block_ci(d[wf], years[wf]),
         'years_won': int(sum(d[wf & (years == Y)].mean() < 0 for Y in ev)),
         'by_year_delta': {str(Y): float(d[wf & (years == Y)].mean()) for Y in ev}}
    need = 7 if len(ev) == 10 else 4
    r['passes'] = bool(r['year_block_ci'][2] < 0 and r['years_won'] >= need)
    print(name, {k: round(v, 4) for k, v in r['v4_same_rows'].items()}, '->', {k: round(v, 4) for k, v in r['candidate'].items()}, [round(x, 4) for x in r['year_block_ci']], r['years_won'], '/', len(ev), r['passes'], file=sys.stderr)
    return r


def main():
    F, roll_like = bar_feats()
    for k, v in F.items(): WF.COLS[k] = v
    base_ok = ~np.isnan(WF.X_of(V4)).any(1)
    res = {'coverage': {k: {'n_sessions': int((~np.isnan(v)).sum()), 'first': str(WF.dates[~np.isnan(v)][0])} for k, v in F.items()},
           'nf_abs_move_gt_5pct': roll_like, 'nf_hours_hist': {str(int(h)): int((F['nf_hours'] == h).sum()) for h in np.unique(F['nf_hours'][~np.isnan(F['nf_hours'])])}}
    # sanity: overnight futures move vs actual next-day HSI open gap (same rows)
    m = ~np.isnan(F['nf_move_atr']); gap = np.array([math.log(s['open'] / s['base_close']) / (s['atr14'] / s['base_close']) for s in S])
    res['corr_nf_move_vs_open_gap'] = float(np.corrcoef(F['nf_move_atr'][m], gap[m])[0, 1])
    res['corr_EWH_vs_open_gap_same_rows'] = float(np.corrcoef(WF.X_of(['EWH_atr'])[m, 0], gap[m])[0, 1])
    print(res, file=sys.stderr)
    EV10 = list(range(2016, 2026)); EV5 = list(range(2021, 2026))
    m1 = base_ok & ~np.isnan(F['VHSI_lvl']) & ~np.isnan(F['VHSI_chg'])
    res['E1_VHSI'] = summarize('E1 VHSI', run(V4, m1, EV10), run(V4 + ['VHSI_lvl', 'VHSI_chg'], m1, EV10), m1, EV10)
    m2 = base_ok & ~np.isnan(F['nf_move_atr'])
    res['E2_night_futures'] = summarize('E2 night futures', run(V4, m2, EV5), run(V4 + ['nf_move_atr', 'nf_imp_up_atr', 'nf_imp_lo_atr'], m2, EV5), m2, EV5)
    m3 = base_ok & ~np.isnan(F['cnh_atr'])
    res['E3_CNH'] = summarize('E3 CNH', run(V4, m3, EV5), run([f if f != 'CNY_atr' else 'cnh_atr' for f in V4], m3, EV5), m3, EV5)
    json.dump(res, open(os.path.join(ROOT, 'research/v5/data-experiments.json'), 'w'), indent=1, default=float)


if __name__ == '__main__':
    main()
