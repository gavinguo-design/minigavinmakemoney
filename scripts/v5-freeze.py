#!/usr/bin/env python3
"""Freeze the v5 candidate = v4 features + HSI-futures night-session features (E2), LR with in-window lambda selection,
trained on every session < 2026-01-01 where the night-session feature exists (2018-10-09..2025-12-31).
Writes research/v5/model-v5.json (+ 2026 reference rows incl. the raw futures bars used, for JS parity)."""
import json, os, importlib.util, bisect, numpy as np
H = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(H, '..')
spec = importlib.util.spec_from_file_location('e', os.path.join(H, 'v5-data-experiments.py')); E = importlib.util.module_from_spec(spec); spec.loader.exec_module(E)
WF, L = E.WF, E.L
F, _ = E.bar_feats()
for k, v in F.items(): WF.COLS[k] = v
feats = E.V4 + ['nf_move_atr', 'nf_imp_up_atr', 'nf_imp_lo_atr']
X = WF.X_of(feats); ok = ~np.isnan(X).any(1)
tr = (WF.years < 2026) & ok; te = (WF.years == 2026) & ok
P, info = WF.lr_fit_predict(tr, te, feats); lam = info['lambda']
mu, sd = {}, {}
for j, f in enumerate(feats):
    if f in WF.NON_SCALED or f in WF.V3F: continue
    mu[f] = float(X[tr, j].mean()); sd[f] = float(X[tr, j].std() or 1)
Z = X.copy()
for j, f in enumerate(feats):
    if f in mu: Z[:, j] = (Z[:, j] - mu[f]) / sd[f]
W = L.fit_mlr(Z[tr], WF.y[tr], lam); P2 = L.predict_mlr(W, Z[te]); assert np.allclose(P, P2, atol=1e-6)
ref = [{'date': d, 'x': {f: float(X[i, j]) for j, f in enumerate(feats)}, 'raw': [float(v) for v in p], 'p': L.bounded_round(list(p))}
       for i, d, p in zip(np.where(te)[0], WF.dates[te], P2)]
json.dump({'version': 'rule-weights-v5-candidate', 'name': 'v4 + HSI futures night session (nf_move_atr, nf_imp_up_atr, nf_imp_lo_atr)',
           'trained_on': [str(WF.dates[tr][0]), str(WF.dates[tr][-1])], 'n_train': int(tr.sum()), 'lambda': lam, 'features': feats,
           'standardize': {'mean': mu, 'sd': sd}, 'W': W.tolist(), 'bounds': {'min': 0.10, 'max': 0.85, 'step': 0.05},
           'night_futures_rule': {'source': 'Futu OpenD HK.HSImain K_60M (quote only)', 'baseline_bar': 'last bar with time_key <= baseline 16:30:00, must be on baseline date and >= 16:00:00',
                                  'cutoff_bar': 'last bar with time_key <= session 08:45:00, must be after baseline bar', 'move': 'log(close_cutoff/close_baseline)',
                                  'fallback': 'missing/invalid -> throw; caller falls back to v4 (then v3)'},
           'reference_2026': ref}, open(os.path.join(ROOT, 'research/v5/model-v5.json'), 'w'), indent=1)
print(lam, int(tr.sum()), len(ref), ref[-1]['date'], ref[-1]['p'])
