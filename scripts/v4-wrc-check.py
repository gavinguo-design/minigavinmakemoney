#!/usr/bin/env python3
"""EBTA Ch6 data-mining check on the v4 walk-forward search (round1 C1; ported from data/books/ebta-wrc-check.py).
Read-only on research/v4/predictions.csv + search-ledger.json; writes research/v4/wrc-report.json.
Loss = 3-class Brier after production boundedRound. d_k,t = Brier(bench)_t - Brier(cand_k)_t (positive = candidate better).
White Reality Check (best-of-K, centred bootstrap) with calendar-year blocks (4000) and stationary bootstrap (L=20, 1000);
Romano-Wolf step-down (FWER 5%, year blocks, studentised). Benchmarks: v3_retrain_lam0.01, persistence, and the zero-parameter
random walk rw_gauss / rw_emp (same formula as scripts/v4-walkforward.py rw_baselines()).
"""
import csv, json, os, sys, importlib.util
import numpy as np
ROOT = os.path.join(os.path.dirname(__file__), '..')
spec = importlib.util.spec_from_file_location('VL', os.path.join(os.path.dirname(__file__), 'v4-lib.py')); VL = importlib.util.module_from_spec(spec); spec.loader.exec_module(VL)
# reuse RW construction from v4-walkforward.py without running its main
spec2 = importlib.util.spec_from_file_location('WF', os.path.join(os.path.dirname(__file__), 'v4-walkforward.py')); WF = importlib.util.module_from_spec(spec2); spec2.loader.exec_module(WF)
YMAX = int(os.environ.get('YMAX', '2025'))
pred = {r['date']: r for r in csv.DictReader(open(os.path.join(ROOT, 'research/v4/predictions.csv')))}
att = json.load(open(os.path.join(ROOT, 'research/v4/search-ledger.json')))['attempts']
cands = [a['id'] for a in att if a['kind'] != 'fixed']
sel = np.array([2016 <= int(d[:4]) <= YMAX and d in pred for d in WF.dates]) & ~np.isnan(WF.RW['rw_emp']).any(1)
dates = WF.dates[sel]; yrs = WF.years[sel]; y = WF.y[sel]; n = len(dates); O = np.eye(3)[y]
def brier_model(m):
    P = np.array([[float(pred[d][f'{m}_{k}'] or 'nan') for k in 'ABC'] for d in dates]); return ((VL.round_all(np.nan_to_num(P, nan=1/3)) - O) ** 2).sum(1)
def brier_rw(k): return ((VL.round_all(WF.RW[k][sel]) - O) ** 2).sum(1)
rs = np.random.default_rng(20261019); U = np.unique(yrs); grp = [np.where(yrs == u)[0] for u in U]
def yb(): return np.concatenate([grp[i] for i in rs.integers(0, len(U), len(U))])
def sb(L=20):
    idx = np.empty(n, int); i = rs.integers(n)
    for t in range(n):
        if t: i = rs.integers(n) if rs.random() < 1 / L else (i + 1) % n
        idx[t] = i
    return idx
B = {c: brier_model(c) for c in cands}
benches = {'v3_retrain_lam0.01': B.get('v3_retrain_lam0.01'), 'persistence': brier_model('persistence'), 'rw_gauss': brier_rw('rw_gauss'), 'rw_emp': brier_rw('rw_emp')}
report = {'generated_by': 'scripts/v4-wrc-check.py', 'n': int(n), 'years': [int(U[0]), int(U[-1])], 'K_candidates': len(cands), 'results': {}}
for bench, bb in benches.items():
    cs = [c for c in cands if c != bench]; D = np.stack([bb - B[c] for c in cs], 1); dbar = D.mean(0); Dc = D - dbar
    wrc = {}
    for name, f, reps in [('year_block', yb, 4000), ('stationary_L20', sb, 1000)]:
        mx = np.array([Dc[f()].mean(0).max() for _ in range(reps)])
        wrc[name] = {'p': float((mx >= dbar.max()).mean()), 'null_E_max': float(mx.mean()), 'reps': reps}
    boot = np.array([D[yb()].mean(0) - dbar for _ in range(4000)]); se = boot.std(0); t = dbar / se; tb = boot / se
    act = list(range(len(cs))); rej = []; steps = []
    while act:
        crit = float(np.quantile(tb[:, act].max(1), .95)); new = [j for j in act if t[j] > crit]; steps.append({'crit_t': crit, 'rejected': [cs[j] for j in new]})
        if not new: break
        rej += new; act = [j for j in act if j not in new]
    per = {cs[j]: {'delta_brier': float(dbar[j]), 't': float(t[j]), 'rw_rejected_fwer5': j in rej} for j in range(len(cs))}
    best = int(dbar.argmax())
    report['results'][bench] = {'best': cs[best], 'best_delta_brier': float(dbar[best]), 'wrc': wrc, 'romano_wolf_rejected': len(rej), 'romano_wolf_steps': steps,
                                'production_v4': per.get('v3+overnight+struct+imp'), 'candidates': per}
    print(f"[{bench}] K={len(cs)} n={n} best={cs[best]} dBrier={dbar[best]:.4f} WRC p(year)={wrc['year_block']['p']:.4f} p(SB)={wrc['stationary_L20']['p']:.4f} "
          f"E0[max]={wrc['year_block']['null_E_max']:.4f} | RW rejected {len(rej)}/{len(cs)} | v4 rejected={per.get('v3+overnight+struct+imp', {}).get('rw_rejected_fwer5')}")
json.dump(report, open(os.path.join(ROOT, 'research/v4/wrc-report.json'), 'w'), indent=1)
