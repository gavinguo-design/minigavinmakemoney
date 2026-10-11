#!/usr/bin/env python3
"""v4 research: rolling-origin (expanding window) walk-forward 2016..2025.
For eval year Y: fit on every session with date < Y-01-01; lambda chosen INSIDE the training window
(inner validation = last 245 training sessions, refit on full window); predict year Y. 2026 = reference only.
All candidates' probabilities pass through the production output format (boundedRound [0.10,0.85], step 0.05).
Writes research/v4/walkforward.json, research/v4/search-ledger.json, research/v4/predictions.csv
"""
import json, os, sys, importlib.util, time
import numpy as np

ROOT = os.path.join(os.path.dirname(__file__), '..')
spec = importlib.util.spec_from_file_location('v4lib', os.path.join(os.path.dirname(__file__), 'v4-lib.py')); L = importlib.util.module_from_spec(spec); spec.loader.exec_module(L)
D = os.path.join(ROOT, 'research/v4/data')
S = json.load(open(os.path.join(D, 'sessions.json')))['rows']
F = {f['date']: f for f in json.load(open(os.path.join(D, 'features.json')))['rows']}
KI = {k: i for i, k in enumerate(L.KEYS)}
dates = np.array([s['date'] for s in S]); years = np.array([int(d[:4]) for d in dates]); y = np.array([KI[s['outcome']] for s in S])
V3F = ['bias', 'v1_logodds_A_vs_B', 'v1_logodds_C_vs_B', 'position_z', 'adx14_norm', 'prev_zone_A', 'prev_zone_C', 'v2_regime_range']

def col(name):
    if name in V3F: return np.array([s['v3_x'][name] for s in S], float)
    return np.array([np.nan if F[s['date']].get(name) is None else F[s['date']][name] for s in S], float)

COLS = {}
def X_of(feats):
    for f in feats:
        if f not in COLS: COLS[f] = col(f)
    return np.stack([COLS[f] for f in feats], 1)

P_fixed = {k: np.array([[s[k][c] for c in L.KEYS] for s in S]) for k in ('v1', 'v21', 'v3')}
prevz = np.array([KI[s['prev_zone']] for s in S])
P_fixed['persistence'] = np.where(np.eye(3)[prevz] == 1, 0.6, 0.2)  # same as backtest-weights baselines() but on rule-consistent prev zone
# backtest-weights persistence uses the previous *outcome*; identical by construction except days after skipped sessions
prev_out = np.array([y[i - 1] if i else 1 for i in range(len(y))])
P_fixed['persistence_outcome'] = np.where(np.eye(3)[prev_out] == 1, 0.6, 0.2)

EVAL_YEARS = list(range(2016, 2026))
LAMS = [0.001, 0.003, 0.01, 0.03, 0.1, 0.3]
NON_SCALED = {'bias', 'prev_zone_A', 'prev_zone_C', 'v2_regime_range'}

def standardize(Xtr, Xte, feats):
    Xtr, Xte = Xtr.copy(), Xte.copy()
    for j, f in enumerate(feats):
        if f in NON_SCALED or f in V3F: continue
        m, sd = Xtr[:, j].mean(), Xtr[:, j].std() or 1
        Xtr[:, j] = (Xtr[:, j] - m) / sd; Xte[:, j] = (Xte[:, j] - m) / sd
    return Xtr, Xte

def lr_fit_predict(tr, te, feats, lam=None, segment=None):
    X = X_of(feats)
    def one(trm, tem, lam_):
        Xtr, Xte = standardize(X[trm], X[tem], feats)
        if lam_ is None:  # inner validation on the last 245 training sessions
            idx = np.where(trm)[0]; a, b = idx[:-245], idx[-245:]
            Xa, Xb = standardize(X[a], X[b], feats); best = None
            for l in LAMS:
                W = L.fit_mlr(Xa, y[a], l); s = L.brier_rows(L.predict_mlr(W, Xb), y[b]).mean()
                if best is None or s < best[0]: best = (s, l)
            lam_ = best[1]
        W = L.fit_mlr(Xtr, y[trm], lam_)
        return L.predict_mlr(W, Xte), lam_
    if segment is None:
        P, l = one(tr, te, lam); return P, {'lambda': l}
    P = np.zeros((te.sum(), 3)); info = {}
    seg = segment
    te_idx = np.where(te)[0]
    for g in np.unique(seg):
        trm = tr & (seg == g); tem = te & (seg == g)
        if not tem.any(): continue
        if trm.sum() < 300:  # too few rows in segment -> pooled model
            p, l = one(tr, tem, lam)
        else:
            p, l = one(trm, tem, lam)
        P[np.isin(te_idx, np.where(tem)[0])] = p; info[str(g)] = l
    return P, {'lambda': info}

def gbt_fit_predict(tr, te, feats, **kw):
    X = X_of(feats); m = L.GBT(**kw).fit(X[tr], y[tr]); return m.predict(X[te]), kw

OVN = ['EWH_atr', 'GSPC_atr', 'IXIC_atr', 'FXI_atr', 'KWEB_atr', 'CNY_atr', 'VIX_chg', 'VIX_lvl']
STRUCT = ['dist_up_atr', 'dist_lo_atr', 'width_atr', 'ret1_atr', 'ret5_atr']
adx = np.array([s['adx14'] if s['adx14'] is not None else 20 for s in S])
SEG_ADX = np.where(adx >= 25, 2, np.where(adx < 20, 0, 1))
SEG_PZ = prevz

CANDIDATES = [
    ('v3_retrain_lam0.01', 'lr', V3F, {'lam': 0.01}),
    ('v3_retrain_cvlam', 'lr', V3F, {}),
]
for f in OVN + ['vol_ratio'] + STRUCT + ['imp_up_atr', 'imp_lo_atr']:
    CANDIDATES.append(('v3+' + f, 'lr', V3F + [f], {}))
CANDIDATES += [
    ('v3+imp(EWH-implied distances)', 'lr', V3F + ['imp_up_atr', 'imp_lo_atr'], {}),
    ('v3+EWH+imp', 'lr', V3F + ['EWH_atr', 'imp_up_atr', 'imp_lo_atr'], {}),
    ('v3+overnight_all', 'lr', V3F + OVN, {}),
    ('v3+overnight_all+vol', 'lr', V3F + OVN + ['vol_ratio'], {}),
    ('v3+struct', 'lr', V3F + STRUCT, {}),
    ('v3+overnight+struct+imp', 'lr', V3F + OVN + STRUCT + ['vol_ratio', 'imp_up_atr', 'imp_lo_atr'], {}),
    ('seg_prevzone:v3', 'lr_seg_pz', V3F, {}),
    ('seg_adx:v3', 'lr_seg_adx', V3F, {}),
    ('seg_prevzone:v3+EWH+imp', 'lr_seg_pz', V3F + ['EWH_atr', 'imp_up_atr', 'imp_lo_atr'], {}),
    # phase 2 (added after seeing phase-1 walk-forward; flagged in ledger, judged via nested selection)
    ('P2:v3+FXI+imp', 'lr', V3F + ['FXI_atr', 'imp_up_atr', 'imp_lo_atr'], {}),
    ('P2:v3+EWH+FXI+GSPC+imp', 'lr', V3F + ['EWH_atr', 'FXI_atr', 'GSPC_atr', 'imp_up_atr', 'imp_lo_atr'], {}),
    ('P2:v3+EWH+FXI+GSPC+VIXchg+imp+dist', 'lr', V3F + ['EWH_atr', 'FXI_atr', 'GSPC_atr', 'VIX_chg', 'imp_up_atr', 'imp_lo_atr', 'dist_up_atr', 'dist_lo_atr'], {}),
    ('gbt_d2:v3feat', 'gbt', V3F[1:], dict(n_rounds=150, lr=0.05, depth=2, min_leaf=80, lam=10.0)),
    ('gbt_d2:v3+overnight+struct', 'gbt', V3F[1:] + OVN + STRUCT + ['vol_ratio', 'imp_up_atr', 'imp_lo_atr'], dict(n_rounds=150, lr=0.05, depth=2, min_leaf=80, lam=10.0)),
    ('gbt_d3:v3+overnight+struct', 'gbt', V3F[1:] + OVN + STRUCT + ['vol_ratio', 'imp_up_atr', 'imp_lo_atr'], dict(n_rounds=120, lr=0.05, depth=3, min_leaf=100, lam=20.0)),
]

def run(cands, out_years=EVAL_YEARS + [2026]):
    preds = {}; meta = {}
    for name, kind, feats, kw in cands:
        t0 = time.time(); P = np.full((len(S), 3), np.nan); info = {}
        ok = ~np.isnan(X_of(feats)).any(1)
        for Y in out_years:
            tr = (years < Y) & ok & (years >= 2014); te = (years == Y) & ok
            if kind == 'lr': p, inf = lr_fit_predict(tr, te, feats, **kw)
            elif kind == 'lr_seg_pz': p, inf = lr_fit_predict(tr, te, feats, segment=SEG_PZ, **kw)
            elif kind == 'lr_seg_adx': p, inf = lr_fit_predict(tr, te, feats, segment=SEG_ADX, **kw)
            elif kind == 'gbt': p, inf = gbt_fit_predict(tr, te, feats, **kw)
            P[te] = p; info[Y] = inf
        preds[name] = P; meta[name] = {'kind': kind, 'features': feats, 'params': kw, 'per_year': {str(k): v for k, v in info.items()}, 'secs': round(time.time() - t0, 1)}
        print(name, meta[name]['secs'], 's', file=sys.stderr)
    return preds, meta

def metrics(P, mask):
    Pr = L.round_all(P[mask]); yy = y[mask]
    return {'n': int(mask.sum()), 'brier': float(L.brier_rows(Pr, yy).mean()), 'brier_raw': float(L.brier_rows(P[mask], yy).mean()),
            'logloss': float(L.logloss_rows(Pr, yy).mean()), 'hit': float(L.hit_rows(Pr, yy).mean()), 'ece': float(L.ece(Pr, yy))}

if __name__ == '__main__':
    preds, meta = run(CANDIDATES)
    for k in ('v1', 'v21', 'v3', 'persistence', 'persistence_outcome'): preds[k + ('_frozen' if k == 'v3' else '')] = P_fixed[k].astype(float)
    # fixed models are already rounded production outputs; round_all is idempotent on them
    wf = (years >= 2016) & (years <= 2025); ref = years == 2026; ref_oos = dates >= '2026-05-18'
    ok_all = np.all([~np.isnan(P).any(1) for P in preds.values()], 0)
    wf &= ok_all; ref &= ok_all; ref_oos &= ok_all
    base = 'v3_retrain_lam0.01'
    res = {}
    br = {k: L.brier_rows(L.round_all(np.nan_to_num(P, nan=1/3)), y) for k, P in preds.items()}
    for k, P in preds.items():
        r = {'walkforward_2016_2025': metrics(P, wf), 'by_year': {str(Y): metrics(P, wf & (years == Y)) for Y in EVAL_YEARS},
             'ref_2026_all': metrics(P, ref), 'ref_2026_05_18_to_10_09_NOT_CLEAN': metrics(P, ref_oos)}
        if k != base:
            d = br[k] - br[base]
            r['vs_v3_retrain'] = {'wf_year_block_ci': L.year_block_ci(d[wf], years[wf]), 'wf_day_block_ci': L.day_block_ci(d[wf]),
                                  'years_won': int(sum(d[wf & (years == Y)].mean() < 0 for Y in EVAL_YEARS)),
                                  'ref2026_diff': float(d[ref].mean()), 'ref_oos_day_block_ci': L.day_block_ci(d[ref_oos])}
        res[k] = r
    # Nested (honest) selection: for eval year Y, pick the candidate (LR/GBT search set, not fixed baselines) with the best
    # mean Brier over eval years 2016..Y-1, use its Y predictions. Measures the selection procedure itself, not a winner picked in hindsight.
    pool = [k for k in meta]; byY = {k: {Y: br[k][wf & (years == Y)].mean() for Y in EVAL_YEARS} for k in pool}
    nested = np.full(len(S), np.nan); picks = {}
    for Y in EVAL_YEARS[2:]:
        k = min(pool, key=lambda c: np.mean([byY[c][z] for z in EVAL_YEARS if z < Y])); picks[Y] = k
        m = wf & (years == Y); nested[m] = br[k][m]
    nm = wf & (years >= 2018); dn = nested[nm] - br[base][nm]
    nested_res = {'picks': {str(k): v for k, v in picks.items()}, 'brier_nested_2018_2025': float(nested[nm].mean()), 'brier_v3_retrain_2018_2025': float(br[base][nm].mean()),
                  'delta_year_block_ci': L.year_block_ci(dn, years[nm]), 'years_won': int(sum(dn[years[nm] == Y].mean() < 0 for Y in EVAL_YEARS[2:])), 'n_years': len(EVAL_YEARS[2:])}
    print('NESTED', nested_res)
    for k in res:
        if k != 'v3_retrain_cvlam':
            d = br[k] - br['v3_retrain_cvlam']; res[k]['vs_v3_retrain_cvlam'] = {'wf_year_block_ci': L.year_block_ci(d[wf], years[wf]), 'years_won': int(sum(d[wf & (years == Y)].mean() < 0 for Y in EVAL_YEARS))}
    json.dump({'generated_by': 'scripts/v4-walkforward.py', 'nested_selection': nested_res, 'base_for_ci': base, 'eval_years': EVAL_YEARS, 'n_wf': int(wf.sum()),
               'note': 'Brier = 3-class sum (uniform 0.667). All probs after production boundedRound [0.10,0.85] step 0.05. Year-block bootstrap 4000 reps; 2026 reference only.',
               'results': res, 'meta': meta}, open(os.path.join(ROOT, 'research/v4/walkforward.json'), 'w'), indent=1, default=float)
    # ledger
    ledger = []
    for k in res:
        w = res[k]['walkforward_2016_2025']; v = res[k].get('vs_v3_retrain')
        ledger.append({'id': k, 'kind': meta.get(k, {}).get('kind', 'fixed'), 'features': meta.get(k, {}).get('features'), 'params': meta.get(k, {}).get('params'),
                       'wf_brier': round(w['brier'], 4), 'wf_logloss': round(w['logloss'], 4), 'wf_hit': round(w['hit'], 4), 'wf_ece': round(w['ece'], 4),
                       'delta_vs_v3_retrain': None if not v else [round(x, 4) for x in v['wf_year_block_ci']], 'years_won': None if not v else v['years_won'],
                       'passes_gate': bool(v and v['wf_year_block_ci'][2] < 0 and v['years_won'] >= 7), 'phase': 2 if k.startswith('P2:') else 1})
    json.dump({'protocol': 'walk-forward expanding window, eval 2016..2025, gate: year-block CI of ΔBrier vs retrained v3 < 0 AND >=7/10 years won; 2026 not used for selection',
               'attempts': ledger}, open(os.path.join(ROOT, 'research/v4/search-ledger.json'), 'w'), indent=1)
    for e in sorted(ledger, key=lambda e: e['wf_brier']): print(e['id'], e['wf_brier'], e['wf_hit'], e['wf_ece'], e['delta_vs_v3_retrain'], e['years_won'], e['passes_gate'])
    with open(os.path.join(ROOT, 'research/v4/predictions.csv'), 'w') as fh:
        ks = list(preds); fh.write('date,outcome,' + ','.join(f'{k}_{c}' for k in ks for c in L.KEYS) + '\n')
        for i in range(len(S)):
            fh.write(dates[i] + ',' + L.KEYS[y[i]] + ',' + ','.join('' if np.isnan(preds[k][i, j]) else f'{preds[k][i, j]:.4f}' for k in ks for j in range(3)) + '\n')
