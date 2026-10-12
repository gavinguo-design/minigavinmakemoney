#!/usr/bin/env python3
"""One-time look at 2026 (2026-01-01..2026-10-09) for the only passing data experiment E2, vs v4 on the same rows.
Both models trained on all feature-available rows < 2026 (same as walk-forward for Y=2026). Appends to research/v5/data-experiments.json."""
import json, os, sys, importlib.util, numpy as np
H = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(H, '..')
spec = importlib.util.spec_from_file_location('e', os.path.join(H, 'v5-data-experiments.py')); E = importlib.util.module_from_spec(spec); spec.loader.exec_module(E)
WF, L, y, years, dates = E.WF, E.L, E.y, E.years, E.WF.dates
F, _ = E.bar_feats()
for k, v in F.items(): WF.COLS[k] = v
V4 = E.V4; V5 = V4 + ['nf_move_atr', 'nf_imp_up_atr', 'nf_imp_lo_atr']
m = ~np.isnan(WF.X_of(V5)).any(1); tr = m & (years < 2026); te = m & (years == 2026)
Pb = WF.lr_fit_predict(tr, te, V4)[0]; Pc = WF.lr_fit_predict(tr, te, V5)[0]
def mt(P, yy):
    Pr = L.round_all(P); return {'n': len(yy), 'brier': float(L.brier_rows(Pr, yy).mean()), 'logloss': float(L.logloss_rows(Pr, yy).mean()), 'hit': float(L.hit_rows(Pr, yy).mean()), 'ece': float(L.ece(Pr, yy))}
yy = y[te]; d = L.brier_rows(L.round_all(Pc), yy) - L.brier_rows(L.round_all(Pb), yy)
late = dates[te] >= '2026-05-18'
prev = np.array([WF.KI[s['prev_zone']] for s in WF.S])[te]; rev = yy != prev
out = {'v4_same_rows': mt(Pb, yy), 'E2': mt(Pc, yy), 'delta_day_block_ci': L.day_block_ci(d),
       'late_2026_05_18_plus': {'n': int(late.sum()), 'delta': float(d[late].mean()), 'ci': L.day_block_ci(d[late])},
       'reversal_days': {'n': int(rev.sum()), 'v4': float(L.brier_rows(L.round_all(Pb[rev]), yy[rev]).mean()), 'E2': float(L.brier_rows(L.round_all(Pc[rev]), yy[rev]).mean())}}
print(out)
R = json.load(open(os.path.join(ROOT, 'research/v5/data-experiments.json'))); R['E2_holdout_2026_looked_once'] = out
json.dump(R, open(os.path.join(ROOT, 'research/v5/data-experiments.json'), 'w'), indent=1, default=float)

# Fairness check: v4 as actually frozen (trained on full 2014+ history) vs E2 on the E2 eval rows 2021-2025 and 2026.
P4 = np.array([[np.nan] * 3 if r['p'] is None else r['p'] for r in json.load(open(os.path.join(ROOT, 'research/v5/v4-oos-preds.json')))['rows']], float)
Pe = np.full((len(y), 3), np.nan)
for Y in range(2021, 2027):
    trm = m & (years < Y); tem = m & (years == Y); Pe[tem] = WF.lr_fit_predict(trm, tem, V5)[0]
fair = {}
for lab, mm in (('2021_2025', m & (years >= 2021) & (years <= 2025)), ('2026', m & (years == 2026))):
    dd = L.brier_rows(L.round_all(Pe[mm]), y[mm]) - L.brier_rows(L.round_all(P4[mm]), y[mm])
    fair[lab] = {'v4_full_history': mt(P4[mm], y[mm]), 'E2': mt(Pe[mm], y[mm]),
                 'ci': L.year_block_ci(dd, years[mm]) if lab != '2026' else L.day_block_ci(dd),
                 'years_won': int(sum(dd[years[mm] == Y].mean() < 0 for Y in range(2021, 2026))) if lab != '2026' else None}
print('FAIR', fair)
R = json.load(open(os.path.join(ROOT, 'research/v5/data-experiments.json'))); R['E2_vs_v4_full_history'] = fair
json.dump(R, open(os.path.join(ROOT, 'research/v5/data-experiments.json'), 'w'), indent=1, default=float)
