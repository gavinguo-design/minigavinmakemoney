#!/usr/bin/env python3
"""Freeze the v4 candidate: refit the pre-registered phase-1 winner (v3 features + overnight + struct + EWH-implied distances)
on all sessions < 2026-01-01 with the same in-window lambda selection used in walk-forward. Writes research/v4/model-v4.json
(coefficients + standardisation) and per-day 2026 reference probabilities for the JS parity test."""
import json, os, importlib.util, numpy as np
H = os.path.dirname(__file__)
spec = importlib.util.spec_from_file_location('wf', os.path.join(H, 'v4-walkforward.py')); WF = importlib.util.module_from_spec(spec); spec.loader.exec_module(WF)
L = WF.L
NAME = 'v3+overnight+struct+imp'
feats = [c for c in WF.CANDIDATES if c[0] == NAME][0][2]
X = WF.X_of(feats); ok = ~np.isnan(X).any(1)
tr = (WF.years < 2026) & ok; te = (WF.years == 2026) & ok
P, info = WF.lr_fit_predict(tr, te, feats)
lam = info['lambda']
# reproduce the fit to export coefficients
mu, sd = {}, {}
for j, f in enumerate(feats):
    if f in WF.NON_SCALED or f in WF.V3F: continue
    mu[f] = float(X[tr, j].mean()); sd[f] = float(X[tr, j].std() or 1)
Z = X.copy()
for j, f in enumerate(feats):
    if f in mu: Z[:, j] = (Z[:, j] - mu[f]) / sd[f]
W = L.fit_mlr(Z[tr], WF.y[tr], lam)
P2 = L.predict_mlr(W, Z[te]); assert np.allclose(P, P2, atol=1e-6)
ref = [{'date': d, 'x': {f: float(X[i, j]) for j, f in enumerate(feats)}, 'raw': [float(v) for v in p], 'p': L.bounded_round(list(p))}
       for i, d, p in zip(np.where(te)[0], WF.dates[te], P2)]
json.dump({'version': 'rule-weights-v4-candidate', 'name': NAME, 'trained_on': [str(WF.dates[tr][0]), str(WF.dates[tr][-1])], 'n_train': int(tr.sum()),
           'lambda': lam, 'features': feats, 'standardize': {'mean': mu, 'sd': sd}, 'W': W.tolist(), 'bounds': {'min': 0.10, 'max': 0.85, 'step': 0.05},
           'reference_2026': ref}, open(os.path.join(H, '..', 'research/v4/model-v4.json'), 'w'), indent=1)
print(NAME, lam, tr.sum(), len(ref), ref[-1])
