#!/usr/bin/env python3
"""v5 direction 1: post-hoc calibration layers on top of the v4 candidate (pre-registered C1..C5, research/v5/preregistration.md).
Calibrator for eval year Y is fit ONLY on v4's out-of-sample walk-forward predictions from years < Y
(2015 OOS preds come from a v4 fit on 2014 only, lambda fixed 0.01 because 2014 has <245 rows for inner validation).
Everything is then passed through the production boundedRound [0.10,0.85] step 0.05 and scored like v4.
Writes research/v5/calibration.json and research/v5/v4-oos-preds.json (raw v4 walk-forward probs, reused by other v5 scripts).
"""
import json, os, sys, importlib.util
import numpy as np
from scipy.optimize import minimize, minimize_scalar

H = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(H, '..')
spec = importlib.util.spec_from_file_location('wf', os.path.join(H, 'v4-walkforward.py')); WF = importlib.util.module_from_spec(spec); spec.loader.exec_module(WF)
L = WF.L; y = WF.y; years = WF.years
V4 = [c for c in WF.CANDIDATES if c[0] == 'v3+overnight+struct+imp'][0][2]
EPS = 1e-6


def v4_oos():
    X = WF.X_of(V4); ok = ~np.isnan(X).any(1); P = np.full((len(y), 3), np.nan); lam = {}
    for Y in range(2015, 2027):
        tr = (years < Y) & ok; te = (years == Y) & ok
        p, inf = WF.lr_fit_predict(tr, te, V4, **({'lam': 0.01} if Y == 2015 else {}))
        P[te] = p; lam[Y] = inf['lambda']
    return P, lam


# ---------- calibrators: fit(P, y) -> function(P) -> P ----------
def _logp(P): return np.log(np.clip(P, EPS, 1))


def fit_temperature(P, yy):
    Z = _logp(P)
    f = lambda t: L.logloss_rows(L.softmax(Z / t), yy).mean()
    T = minimize_scalar(f, bounds=(0.3, 5), method='bounded').x
    return (lambda Q: L.softmax(_logp(Q) / T)), {'T': float(T)}


def fit_vector(P, yy):
    Z = _logp(P); Yo = np.eye(3)[yy]
    def f(w):
        a, b = w[:3], w[3:]; Q = L.softmax(Z * a + b)
        g = Q - Yo; return -np.log(np.clip((Q * Yo).sum(1), 1e-12, None)).mean(), np.r_[(g * Z).mean(0), g.mean(0)]
    r = minimize(f, np.r_[np.ones(3), np.zeros(3)], jac=True, method='L-BFGS-B'); a, b = r.x[:3], r.x[3:]
    return (lambda Q: L.softmax(_logp(Q) * a + b)), {'a': a.tolist(), 'b': b.tolist()}


def _logit(p): p = np.clip(p, EPS, 1 - EPS); return np.log(p / (1 - p))


def fit_platt(P, yy):
    ab = []
    for k in range(3):
        z = _logit(P[:, k]); t = (yy == k).astype(float)
        def f(w):
            q = 1 / (1 + np.exp(-(w[0] * z + w[1]))); q = np.clip(q, 1e-12, 1 - 1e-12)
            return -(t * np.log(q) + (1 - t) * np.log(1 - q)).mean(), np.array([((q - t) * z).mean(), (q - t).mean()])
        ab.append(minimize(f, [1.0, 0.0], jac=True, method='L-BFGS-B').x)
    def apply(Q):
        R = np.stack([1 / (1 + np.exp(-(ab[k][0] * _logit(Q[:, k]) + ab[k][1]))) for k in range(3)], 1)
        return R / R.sum(1, keepdims=True)
    return apply, {'ab': [list(map(float, v)) for v in ab]}


def pav(x, t):
    o = np.argsort(x, kind='mergesort'); xs, ts = x[o], t[o].astype(float)
    vals, wts, xr = [], [], []
    for xi, ti in zip(xs, ts):
        vals.append(ti); wts.append(1.0); xr.append([xi, xi])
        while len(vals) > 1 and vals[-2] >= vals[-1]:
            v = (vals[-2] * wts[-2] + vals[-1] * wts[-1]) / (wts[-2] + wts[-1]); w = wts[-2] + wts[-1]; r = [xr[-2][0], xr[-1][1]]
            vals[-2:] = [v]; wts[-2:] = [w]; xr[-2:] = [r]
    knots_x = np.array([(a + b) / 2 for a, b in xr]); knots_y = np.array(vals)
    return knots_x, knots_y


def fit_isotonic(P, yy):
    ks = [pav(P[:, k], yy == k) for k in range(3)]
    def apply(Q):
        R = np.stack([np.clip(np.interp(Q[:, k], ks[k][0], ks[k][1]), 1e-3, 1 - 1e-3) for k in range(3)], 1)
        return R / R.sum(1, keepdims=True)
    return apply, {'n_knots': [len(k[0]) for k in ks]}


TGRID = np.round(np.arange(0.5, 2.01, 0.05), 2)


def fit_temp_rounded(P, yy):
    Z = _logp(P)
    sc = [(L.brier_rows(L.round_all(L.softmax(Z / t)), yy).mean(), abs(t - 1), t) for t in TGRID]
    T = min(sc)[2]
    return (lambda Q: L.softmax(_logp(Q) / T)), {'T': float(T)}


CALS = {'C1_temperature': fit_temperature, 'C2_vector': fit_vector, 'C3_platt': fit_platt, 'C4_isotonic': fit_isotonic, 'C5_temp_rounded_brier': fit_temp_rounded}
EVAL = list(range(2016, 2026))


def metrics(P, m, fmt=None):
    Pr = L.round_all(P[m], **(fmt or {})); yy = y[m]
    return {'n': int(m.sum()), 'brier': float(L.brier_rows(Pr, yy).mean()), 'logloss': float(L.logloss_rows(Pr, yy).mean()),
            'hit': float(L.hit_rows(Pr, yy).mean()), 'ece': float(L.ece(Pr, yy)), 'ece_raw': float(L.ece(P[m], yy)), 'brier_raw': float(L.brier_rows(P[m], yy).mean())}


def main():
    P4, lam = v4_oos()
    json.dump({'note': 'v4 candidate expanding-window OOS raw probabilities; 2015 trained on 2014 only (lambda 0.01)', 'lambda': {str(k): v for k, v in lam.items()},
               'rows': [{'date': d, 'p': None if np.isnan(p).any() else [round(float(v), 6) for v in p]} for d, p in zip(WF.dates, P4)]},
              open(os.path.join(ROOT, 'research/v5/v4-oos-preds.json'), 'w'), separators=(',', ':'))
    ok = ~np.isnan(P4).any(1); wf = ok & (years >= 2016) & (years <= 2025); ref = ok & (years == 2026)
    out = {'v4': {'wf': metrics(P4, wf), 'ref2026': metrics(P4, ref), 'by_year': {str(Y): metrics(P4, wf & (years == Y)) for Y in EVAL}}}
    br4 = L.brier_rows(L.round_all(np.nan_to_num(P4, nan=1 / 3)), y)
    assert abs(out['v4']['wf']['brier'] - 0.25846754313886605) < 1e-9, out['v4']['wf']  # reproduces published v4
    for name, fit in CALS.items():
        PC = np.full_like(P4, np.nan); params = {}
        for Y in EVAL + [2026]:
            trm = ok & (years >= 2015) & (years < Y); tem = ok & (years == Y)
            f, prm = fit(P4[trm], y[trm]); PC[tem] = f(P4[tem]); params[str(Y)] = prm
        brc = L.brier_rows(L.round_all(np.nan_to_num(PC, nan=1 / 3)), y); d = brc - br4
        r = {'wf': metrics(PC, wf), 'ref2026': metrics(PC, ref), 'by_year': {str(Y): metrics(PC, wf & (years == Y)) for Y in EVAL},
             'vs_v4': {'year_block_ci': L.year_block_ci(d[wf], years[wf]), 'years_won': int(sum(d[wf & (years == Y)].mean() < 0 for Y in EVAL)), 'ref2026_diff': float(d[ref].mean())},
             'params': params}
        w = r['wf']; v = out['v4']['wf']
        r['passes'] = bool(w['ece'] < v['ece'] and r['vs_v4']['year_block_ci'][2] < 0.001 and w['logloss'] <= v['logloss'])
        out[name] = r
        print(name, {k: round(x, 4) for k, x in w.items() if k != 'n'}, [round(x, 4) for x in r['vs_v4']['year_block_ci']], r['vs_v4']['years_won'], 'pass' if r['passes'] else '-', file=sys.stderr)
    print('v4', {k: round(x, 4) for k, x in out['v4']['wf'].items() if k != 'n'}, file=sys.stderr)
    # information only: output format alternatives (product decision, not a v5 candidate)
    out['info_format'] = {f'{a}-{b}': metrics(P4, wf, {'mn': a, 'mx': b}) for a, b in [(0.10, 0.85), (0.05, 0.90), (0.05, 0.95), (0.02, 0.96)]}
    for k, v in out['info_format'].items(): print('format', k, {a: round(x, 4) for a, x in v.items() if a != 'n'}, file=sys.stderr)
    json.dump(out, open(os.path.join(ROOT, 'research/v5/calibration.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()
