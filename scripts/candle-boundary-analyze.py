#!/usr/bin/env python3
"""research/candle-boundary: execute research/candle-boundary/preregistration.md.
Inputs: research/v4/data/{sessions,HSI}.json, research/candle-boundary/patterns-by-date.json (point-in-time patterns).
Outputs: research/candle-boundary/{results.json, search-ledger.json, events.csv}. Research only.
"""
import json, os, math, importlib.util
import numpy as np
from scipy import stats
from scipy.optimize import minimize

H = os.path.dirname(__file__); ROOT = os.path.join(H, '..'); OUT = os.path.join(ROOT, 'research/candle-boundary')
S = json.load(open(os.path.join(ROOT, 'research/v4/data/sessions.json')))['rows']
HSI = json.load(open(os.path.join(ROOT, 'research/v4/data/HSI.json')))['rows']
PAT = json.load(open(os.path.join(OUT, 'patterns-by-date.json')))['patterns']
hidx = {r['date']: i for i, r in enumerate(HSI)}

BEAR = ['bearEngulf', 'darkCloud', 'eveningStar', 'shootingStar', 'hangingMan', 'doji']
BULL = ['bullEngulf', 'piercing', 'morningStar', 'hammer', 'invHammer', 'doji']
SIDES = {'upper': BEAR, 'lower': BULL}
ledger = []

def rows_for(side, k):
    out = []
    for s in S:
        bnd = s[side]; atr = s['atr14']
        if abs(s['base_close'] - bnd) > k * atr: continue
        p = PAT.get(s['baseline']); pid = p['id'] if p else None
        ev = pid in SIDES[side]
        i = hidx[s['date']]
        c0 = s['close']
        r1 = (c0 < bnd) if side == 'upper' else (c0 >= bnd)
        r3 = None
        if i + 2 < len(HSI):
            cs = [HSI[i + j]['close'] for j in range(3)]
            r3 = all(c < bnd for c in cs) if side == 'upper' else all(c >= bnd for c in cs)
        ret = (c0 - s['base_close']) / atr * (-1 if side == 'upper' else 1)
        dist = (s['base_close'] - bnd) / atr
        out.append(dict(date=s['date'], baseline=s['baseline'], year=int(s['date'][:4]), side=side, pattern=pid, event=ev,
                        r1=bool(r1), r3=r3, ret=ret, dist=dist, outcome=s['outcome']))
    return out

def wilson(x, n, z=1.959964):
    if n == 0: return (float('nan'),) * 2
    p = x / n; d = 1 + z * z / n; c = (p + z * z / (2 * n)) / d; h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return c - h, c + h

def newcombe(x1, n1, x2, n2):
    l1, u1 = wilson(x1, n1); l2, u2 = wilson(x2, n2); p1, p2 = x1 / n1, x2 / n2; d = p1 - p2
    return d, d - math.sqrt((p1 - l1) ** 2 + (u2 - p2) ** 2), d + math.sqrt((u1 - p1) ** 2 + (p2 - l2) ** 2)

def fisher(x1, n1, x2, n2):
    return float(stats.fisher_exact([[x1, n1 - x1], [x2, n2 - x2]])[1])

def year_block_diff(ev, ctl, reps=4000, seed=20261012):
    rs = np.random.default_rng(seed); yrs = sorted(set(r['year'] for r in ev + ctl))
    E = {y: [r['r1'] for r in ev if r['year'] == y] for y in yrs}; C = {y: [r['r1'] for r in ctl if r['year'] == y] for y in yrs}
    v = []
    for _ in range(reps):
        pk = rs.integers(0, len(yrs), len(yrs)); e = sum((E[yrs[i]] for i in pk), []); c = sum((C[yrs[i]] for i in pk), [])
        if e and c: v.append(np.mean(e) - np.mean(c))
    v = np.sort(v); return float(v[int(0.025 * len(v))]), float(v[int(np.ceil(0.975 * len(v))) - 1])

def compare(ev, ctl, key='r1'):
    e = [r[key] for r in ev if r[key] is not None]; c = [r[key] for r in ctl if r[key] is not None]
    x1, n1, x2, n2 = sum(e), len(e), sum(c), len(c)
    if n1 == 0: return dict(n_event=0, n_control=n2, rate_control=x2 / n2 if n2 else None)
    d, lo, hi = newcombe(x1, n1, x2, n2)
    return dict(n_event=n1, x_event=int(x1), rate_event=x1 / n1, ci_event=wilson(x1, n1), n_control=n2, x_control=int(x2), rate_control=x2 / n2,
                ci_control=wilson(x2, n2), diff=d, newcombe_ci=[lo, hi], fisher_p=fisher(x1, n1, x2, n2))

def ret_cmp(ev, ctl):
    e = np.array([r['ret'] for r in ev]); c = np.array([r['ret'] for r in ctl])
    if len(e) < 2: return None
    t = stats.ttest_ind(e, c, equal_var=False); mw = stats.mannwhitneyu(e, c)
    se = math.sqrt(e.var(ddof=1) / len(e) + c.var(ddof=1) / len(c)); d = e.mean() - c.mean()
    return dict(mean_event=float(e.mean()), mean_control=float(c.mean()), diff=float(d), ci=[float(d - 1.96 * se), float(d + 1.96 * se)],
                welch_p=float(t.pvalue), mannwhitney_p=float(mw.pvalue), pos_rate_event=float((e > 0).mean()), pos_rate_control=float((c > 0).mean()))

def logit_adj(rows):
    """R1 ~ 1 + event + dist ; Wald CI on event coefficient (numpy/scipy only)."""
    y = np.array([r['r1'] for r in rows], float); X = np.column_stack([np.ones(len(rows)), [r['event'] for r in rows], [r['dist'] for r in rows]]).astype(float)
    def f(b):
        z = X @ b; p = 1 / (1 + np.exp(-z)); ll = -(y * np.log(np.clip(p, 1e-12, 1)) + (1 - y) * np.log(np.clip(1 - p, 1e-12, 1))).sum()
        return ll, X.T @ (p - y)
    b = minimize(f, np.zeros(3), jac=True, method='BFGS').x
    p = 1 / (1 + np.exp(-(X @ b))); I = X.T @ (X * (p * (1 - p))[:, None]); se = np.sqrt(np.diag(np.linalg.inv(I)))
    z = b[1] / se[1]
    return dict(coef_event=float(b[1]), ci=[float(b[1] - 1.96 * se[1]), float(b[1] + 1.96 * se[1])], p=float(2 * stats.norm.sf(abs(z))),
                coef_dist=float(b[2]), odds_ratio=float(math.exp(b[1])), n=len(rows))

def holm(ps):
    m = len(ps); o = sorted(range(m), key=lambda i: ps[i]); adj = [0] * m; run = 0
    for r, i in enumerate(o): run = max(run, min(1, (m - r) * ps[i])); adj[i] = run
    return adj

def bh(ps):
    m = len(ps); o = sorted(range(m), key=lambda i: ps[i]); adj = [0] * m; run = 1
    for r in range(m - 1, -1, -1): i = o[r]; run = min(run, ps[i] * m / (r + 1)); adj[i] = min(1, run)
    return adj

res = {'protocol': 'research/candle-boundary/preregistration.md', 'n_sessions': len(S)}
# ---------- primary + sensitivity ----------
for k in (0.5, 0.25, 1.0):
    for side in ('upper', 'lower'):
        R = rows_for(side, k); ev = [r for r in R if r['event']]; ctl = [r for r in R if not r['event']]
        key = f'k{k}_{side}'
        res[key] = {'n_near': len(R), 'r1': compare(ev, ctl), 'r3': compare(ev, ctl, 'r3'), 'ret_atr': ret_cmp(ev, ctl),
                    'r1_year_block_ci': year_block_diff(ev, ctl) if ev else None, 'adj_logit': logit_adj(R) if ev else None,
                    'pattern_counts': {p: sum(1 for r in ev if r['pattern'] == p) for p in SIDES[side]}}
        ledger.append({'id': f'merged_{"bear@upper" if side == "upper" else "bull@lower"}_k{k}', 'role': 'PRIMARY' if k == 0.5 else 'sensitivity',
                       'n_event': res[key]['r1']['n_event'], 'n_control': res[key]['r1']['n_control'],
                       'rate_event': res[key]['r1'].get('rate_event'), 'rate_control': res[key]['r1']['rate_control'],
                       'diff': res[key]['r1'].get('diff'), 'newcombe_ci': res[key]['r1'].get('newcombe_ci'), 'fisher_p': res[key]['r1'].get('fisher_p')})
        ledger.append({'id': f'adj_logit_{side}_k{k}', 'role': 'secondary', **(res[key]['adj_logit'] or {})})
        ledger.append({'id': f'r3_{side}_k{k}', 'role': 'secondary', **{x: res[key]['r3'].get(x) for x in ('n_event', 'rate_event', 'rate_control', 'diff', 'newcombe_ci', 'fisher_p')}})
        ledger.append({'id': f'ret_atr_{side}_k{k}', 'role': 'secondary', **(res[key]['ret_atr'] or {})})
        if k == 0.5:
            yrs = sorted(set(r['year'] for r in R)); by = {}
            for y in yrs:
                e = [r['r1'] for r in ev if r['year'] == y]; c = [r['r1'] for r in ctl if r['year'] == y]
                by[y] = dict(n_event=len(e), rate_event=np.mean(e) if e else None, n_control=len(c), rate_control=np.mean(c) if c else None)
            res[key]['by_year'] = by
            el = [y for y in yrs if by[y]['n_event'] >= 3 and by[y]['n_control']]
            res[key]['years_event_higher'] = [sum(by[y]['rate_event'] > by[y]['rate_control'] for y in el), len(el)]
            # single patterns
            singles = {}
            for p in SIDES[side]:
                sub = [r for r in ev if r['pattern'] == p]
                singles[p] = compare(sub, ctl) if sub else {'n_event': 0}
            res[key]['singles'] = singles
            # dump events
            with open(os.path.join(OUT, f'events-{side}-k0.5.csv'), 'w') as fh:
                fh.write('date,baseline,pattern,event,dist_atr,close_rejected_r1,rejected_3d_r3,ret_atr_reversal_dir,outcome\n')
                for r in R: fh.write(f"{r['date']},{r['baseline']},{r['pattern'] or ''},{int(r['event'])},{r['dist']:.4f},{int(r['r1'])},{'' if r['r3'] is None else int(r['r3'])},{r['ret']:.4f},{r['outcome']}\n")

# primary Holm across the 2 primary tests
pp = [res['k0.5_upper']['r1']['fisher_p'], res['k0.5_lower']['r1']['fisher_p']]
res['primary_holm'] = dict(zip(['bear@upper', 'bull@lower'], holm(pp)))
# single-pattern multiple comparison (12 tests)
names, ps = [], []
for side in ('upper', 'lower'):
    for p, v in res[f'k0.5_{side}']['singles'].items():
        if v.get('n_event'):
            names.append(f'{side}:{p}'); ps.append(v['fisher_p'])
        else:
            names.append(f'{side}:{p}'); ps.append(1.0)
hh, bb = holm(ps), bh(ps)
res['singles_corrected'] = {n: {'p': p, 'holm': h, 'bh': b} for n, p, h, b in zip(names, ps, hh, bb)}
for n, p, h, b in zip(names, ps, hh, bb):
    side, pat = n.split(':'); v = res[f'k0.5_{side}']['singles'][pat]
    ledger.append({'id': f'single_{n}_k0.5', 'role': 'single-pattern (descriptive)', 'n_event': v.get('n_event'), 'rate_event': v.get('rate_event'),
                   'rate_control': v.get('rate_control'), 'diff': v.get('diff'), 'newcombe_ci': v.get('newcombe_ci'), 'fisher_p': p, 'holm_p': h, 'bh_q': b})

# ---------- v4 increment (walk-forward, same protocol as scripts/v4-walkforward.py) ----------
spec = importlib.util.spec_from_file_location('wf', os.path.join(H, 'v4-walkforward.py')); WF = importlib.util.module_from_spec(spec); spec.loader.exec_module(WF)
L = WF.L
assert [s['date'] for s in WF.S] == [s['date'] for s in S]
def flag(s, side, k, need_near=True):
    p = PAT.get(s['baseline']); pid = p['id'] if p else None
    near = abs(s['base_close'] - s[side]) <= k * s['atr14']
    return float((near or not need_near) and pid in SIDES[side])
WF.COLS['bear_rev_at_upper'] = np.array([flag(s, 'upper', 0.5) for s in S]); WF.COLS['bull_rev_at_lower'] = np.array([flag(s, 'lower', 0.5) for s in S])
WF.COLS['bear_rev_any'] = np.array([flag(s, 'upper', 0.5, False) for s in S]); WF.COLS['bull_rev_any'] = np.array([flag(s, 'lower', 0.5, False) for s in S])
base_feats = [c for c in WF.CANDIDATES if c[0] == 'v3+overnight+struct+imp'][0][2]
cands = [('v4_base_retrain', 'lr', base_feats, {}), ('v4+rev_at_boundary', 'lr', base_feats + ['bear_rev_at_upper', 'bull_rev_at_lower'], {}),
         ('v4+rev_any_position(variant)', 'lr', base_feats + ['bear_rev_any', 'bull_rev_any'], {})]
preds, meta = WF.run(cands)
y = WF.y; years = WF.years
near_any = np.array([abs(s['base_close'] - s['upper']) <= 0.5 * s['atr14'] or abs(s['base_close'] - s['lower']) <= 0.5 * s['atr14'] for s in S])
evmask = (WF.COLS['bear_rev_at_upper'] + WF.COLS['bull_rev_at_lower']) > 0
ok = np.all([~np.isnan(P).any(1) for P in preds.values()], 0)
wf = (years >= 2016) & (years <= 2025) & ok
br = {k: L.brier_rows(L.round_all(np.nan_to_num(P, nan=1 / 3)), y) for k, P in preds.items()}
inc = {}
for k in ('v4+rev_at_boundary', 'v4+rev_any_position(variant)'):
    d = br[k] - br['v4_base_retrain']; r = {}
    for nm, m in (('boundary_days', wf & near_any), ('event_days', wf & evmask), ('all_days', wf)):
        r[nm] = {'n': int(m.sum()), 'brier_base': float(br['v4_base_retrain'][m].mean()), 'brier_cand': float(br[k][m].mean()),
                 'delta_year_block_ci': L.year_block_ci(d[m], years[m]), 'years_won': int(sum(d[m & (years == Y)].mean() < 0 for Y in WF.EVAL_YEARS if (m & (years == Y)).any())),
                 'n_years': int(sum((m & (years == Y)).any() for Y in WF.EVAL_YEARS))}
    m26 = (years == 2026) & ok & near_any
    r['ref_2026_boundary_days'] = {'n': int(m26.sum()), 'delta': float(d[m26].mean())}
    r['by_year_boundary'] = {str(Y): float(d[wf & near_any & (years == Y)].mean()) for Y in WF.EVAL_YEARS}
    ci = r['boundary_days']['delta_year_block_ci']; r['passes_gate'] = bool(ci[2] < 0 and r['boundary_days']['years_won'] >= 7)
    r['lambda_per_year'] = meta[k]['per_year']
    inc[k] = r
    ledger.append({'id': f'v4_increment:{k}', 'role': 'PRIMARY-v4' if k == 'v4+rev_at_boundary' else 'variant', 'n_boundary_days': r['boundary_days']['n'],
                   'brier_base': r['boundary_days']['brier_base'], 'brier_cand': r['boundary_days']['brier_cand'], 'delta_ci': ci,
                   'years_won': r['boundary_days']['years_won'], 'passes_gate': r['passes_gate'], 'event_days_delta': r['event_days']['delta_year_block_ci']})
res['v4_increment'] = inc
res['v4_base_sanity_all_wf_brier'] = float(br['v4_base_retrain'][wf].mean())

json.dump(res, open(os.path.join(OUT, 'results.json'), 'w'), indent=1, default=float)
json.dump({'protocol': 'research/candle-boundary/preregistration.md', 'note': 'every attempt incl. non-significant; primary = merged bear@upper & bull@lower at k=0.5 (+ v4 increment)', 'attempts': ledger},
          open(os.path.join(OUT, 'search-ledger.json'), 'w'), indent=1, default=float)
print(json.dumps({k: res[k] for k in ('k0.5_upper', 'k0.5_lower', 'primary_holm')}, default=float, indent=1)[:6000])
