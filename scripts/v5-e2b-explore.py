#!/usr/bin/env python3
"""PHASE-2 EXPLORATORY (added after seeing E2 vs full-history v4; NOT used for the v5 recommendation).
E2b: train on full 2014+ history; when night-futures data is missing (pre-2018-10) fill nf_move_atr=EWH_atr-equivalent 0 + has_nf=0,
nf_imp_* = v4's EWH-implied distances. Compared with full-history v4 on E2 eval rows 2021-2025 and 2026."""
import json, os, importlib.util, numpy as np
H = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(H, '..')
spec = importlib.util.spec_from_file_location('e', os.path.join(H, 'v5-data-experiments.py')); E = importlib.util.module_from_spec(spec); spec.loader.exec_module(E)
WF, L, y, years = E.WF, E.L, E.y, E.years
F, _ = E.bar_feats(); has = ~np.isnan(F['nf_move_atr'])
WF.COLS['has_nf'] = has.astype(float)
WF.COLS['nfb_move'] = np.where(has, F['nf_move_atr'], 0.0)
WF.COLS['nfb_up'] = np.where(has, F['nf_imp_up_atr'], WF.X_of(['imp_up_atr'])[:, 0])
WF.COLS['nfb_lo'] = np.where(has, F['nf_imp_lo_atr'], WF.X_of(['imp_lo_atr'])[:, 0])
WF.NON_SCALED.add('has_nf')
feats = E.V4 + ['has_nf', 'nfb_move', 'nfb_up', 'nfb_lo']
ok = ~np.isnan(WF.X_of(feats)).any(1)
P = np.full((len(y), 3), np.nan)
for Y in range(2021, 2027):
    tr = ok & (years < Y); te = ok & (years == Y) & has; P[te] = WF.lr_fit_predict(tr, te, feats)[0]
P4 = np.array([[np.nan] * 3 if r['p'] is None else r['p'] for r in json.load(open(os.path.join(ROOT, 'research/v5/v4-oos-preds.json')))['rows']], float)
out = {}
for lab, mm in (('2021_2025', has & (years >= 2021) & (years <= 2025)), ('2026', has & (years == 2026))):
    b5 = L.brier_rows(L.round_all(P[mm]), y[mm]); b4 = L.brier_rows(L.round_all(P4[mm]), y[mm]); d = b5 - b4
    out[lab] = {'n': int(mm.sum()), 'v4': float(b4.mean()), 'E2b': float(b5.mean()), 'ece_v4': float(L.ece(L.round_all(P4[mm]), y[mm])), 'ece_E2b': float(L.ece(L.round_all(P[mm]), y[mm])),
                'hit_v4': float(L.hit_rows(L.round_all(P4[mm]), y[mm]).mean()), 'hit_E2b': float(L.hit_rows(L.round_all(P[mm]), y[mm]).mean()),
                'ci': L.year_block_ci(d, years[mm]) if lab != '2026' else L.day_block_ci(d),
                'years_won': int(sum(d[years[mm] == Y].mean() < 0 for Y in range(2021, 2026))) if lab != '2026' else None}
print(out)
R = json.load(open(os.path.join(ROOT, 'research/v5/data-experiments.json'))); R['PHASE2_E2b_full_history_with_indicator'] = out
json.dump(R, open(os.path.join(ROOT, 'research/v5/data-experiments.json'), 'w'), indent=1, default=float)
