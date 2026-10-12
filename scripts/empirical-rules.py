#!/usr/bin/env python3
"""Empirical A/B/C rules research (see research/empirical-rules/preregistration.md).
Discovery D = sessions < 2022-01-01; out-of-sample O = 2022..2025 (single run); 2026 = observation only.
Writes research/empirical-rules/{search-ledger.json,results.json}."""
import json, os, math, csv, itertools, collections
from scipy.stats import binomtest

ROOT = os.path.join(os.path.dirname(__file__), '..')
D = os.path.join(ROOT, 'research/v4/data'); OUT = os.path.join(ROOT, 'research/empirical-rules')
S = json.load(open(os.path.join(D, 'sessions.json')))['rows']
F = {f['date']: f for f in json.load(open(os.path.join(D, 'features.json')))['rows']}
H = json.load(open(os.path.join(D, 'HSI.json')))['rows']; hd = [h['date'] for h in H]; hi = {d: i for i, d in enumerate(hd)}
PRED = {r['date']: r for r in csv.DictReader(open(os.path.join(ROOT, 'research/v4/predictions.csv')))}
K = ['A', 'B', 'C']; MK = 'v3+overnight+struct+imp'

def zone(c, s): return 'A' if c >= s['upper'] else 'C' if c < s['lower'] else 'B'
def b3(x, lo, hi_): return 'lt' if x < lo else 'gt' if x > hi_ else 'mid'

rows = []
for s in S:
    f = F[s['date']]; atr = s['atr14']; bc = s['base_close']; lo, up = s['lower'], s['upper']
    r = {'date': s['date'], 'period': 'D' if s['date'] < '2022' else 'O' if s['date'] < '2026' else 'X', 'h1': s['outcome']}
    i = hi[s['date']]
    r['h3'] = zone(H[i + 2]['close'], s) if i + 2 < len(H) else None
    c = {}
    c['PZ'] = s['prev_zone']
    if bc < lo: c['POS'] = 'inC'
    elif bc >= up: c['POS'] = 'inA'
    else:
        p = (bc - lo) / (up - lo); c['POS'] = 'Blow' if p < 1/3 else 'Bmid' if p < 2/3 else 'Bhigh'
    z = zone(bc, s); d = (bc - up) / atr if z == 'A' else (lo - bc) / atr if z == 'C' else min(bc - lo, up - bc) / atr
    c['EDGE'] = '<0.3' if d < 0.3 else '0.3-1' if d < 1 else '>=1'
    for k in ('FXI', 'KWEB', 'EWH'):
        c[k] = {'lt': '<-1%', 'mid': '-1~+1%', 'gt': '>+1%'}[b3(f[k + '_ret'], -0.01, 0.01)]
    w = (up - lo) / atr; c['WID'] = '<2' if w < 2 else '2-3.5' if w < 3.5 else '>=3.5'
    j = hi[s['baseline']]; g = (H[j]['open'] - H[j - 1]['close']) / atr
    c['GAP'] = 'down' if g < -0.3 else 'up' if g > 0.3 else 'none'
    a = s['adx14']; c['ADX'] = '<20' if a < 20 else '20-25' if a < 25 else '>=25'
    r['c'] = c
    p = PRED.get(s['date'])
    if p and p[MK + '_A']:
        pr = [float(p[MK + '_' + k]) for k in K]; r['mp'] = pr; r['mtop'] = K[max(range(3), key=lambda q: pr[q])]
    rows.append(r)

DIMS = ['PZ', 'POS', 'EDGE', 'FXI', 'KWEB', 'EWH', 'WID', 'GAP', 'ADX']
LEVELS = {d: sorted({r['c'][d] for r in rows}) for d in DIMS}
cells = [((d, l),) for d in DIMS for l in LEVELS[d]]
for d1, d2 in itertools.combinations(DIMS, 2):
    cells += [((d1, l1), (d2, l2)) for l1 in LEVELS[d1] for l2 in LEVELS[d2]]

def wilson(k, n, z=1.96):
    if n == 0: return (None, None)
    p = k / n; den = 1 + z * z / n; ctr = (p + z * z / (2 * n)) / den; hw = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return (ctr - hw, ctr + hw)

def sub(period, h): return [r for r in rows if r['period'] == period and r[h] is not None]
cond = {}  # P(outcome | PZ) per period & horizon
uncond = {}
for per in 'DOX':
    for h in ('h1', 'h3'):
        rs = sub(per, h); uncond[per, h] = {k: sum(r[h] == k for r in rs) / len(rs) for k in K}
        for pz in K:
            q = [r for r in rs if r['c']['PZ'] == pz]; cond[per, h, pz] = {k: sum(r[h] == k for r in q) / len(q) for k in K}

def match(r, cell): return all(r['c'][d] == l for d, l in cell)
def stats(per, h, cell):
    q = [r for r in sub(per, h) if match(r, cell)]; n = len(q)
    if n == 0: return {'n': 0}
    cnt = {k: sum(r[h] == k for r in q) for k in K}
    exp = {k: sum(cond[per, h, r['c']['PZ']][k] for r in q) / n for k in K}
    return {'n': n, 'cnt': cnt, 'p': {k: cnt[k] / n for k in K}, 'exp_persist': exp, 'uncond': uncond[per, h],
            'ci': {k: wilson(cnt[k], n) for k in K}}
def name(cell): return ' & '.join(f'{d}={l}' for d, l in cell)

ledger, cands = [], []
for h in ('h1', 'h3'):
    for cell in cells:
        sd = stats('D', h, cell); e = {'id': f'{h}|{name(cell)}', 'horizon': h, 'cell': name(cell), 'n_D': sd['n'], 'order': len(cell)}
        if sd['n']:
            dl = {k: sd['p'][k] - sd['exp_persist'][k] for k in K}; kk = max(K, key=lambda k: abs(dl[k]))
            pv = binomtest(sd['cnt'][kk], sd['n'], min(max(sd['exp_persist'][kk], 1e-6), 1 - 1e-6)).pvalue
            z = dl[kk] / math.sqrt(max(sd['exp_persist'][kk] * (1 - sd['exp_persist'][kk]), 1e-6) / sd['n'])
            e.update({'p_D': sd['p'], 'exp_persist_D': sd['exp_persist'], 'signal_class': kk, 'delta_D': dl[kk], 'pvalue_D': pv, 'z_D': z})
            e['candidate'] = sd['n'] >= 40 and abs(dl[kk]) >= 0.10 and pv < 0.01
        else: e['candidate'] = False
        ledger.append(e)
        if e['candidate']: cands.append((cell, e))

# ---- single out-of-sample run ----
results = []
for cell, e in cands:
    h, kk = e['horizon'], e['signal_class']; so = stats('O', h, cell); sx = stats('X', h, cell); sd = stats('D', h, cell)
    res = dict(e, D=sd, O=so, X=sx)
    if so['n']:
        do = so['p'][kk] - so['exp_persist'][kk]; ci = so['ci'][kk]
        res['delta_O'] = do; res['ci_width_O'] = ci[1] - ci[0]
        res['holds'] = so['n'] >= 30 and do * e['delta_D'] > 0 and abs(do) >= 0.05 and ci[1] - ci[0] <= 0.35
        res['strong'] = res['holds'] and not (ci[0] <= so['exp_persist'][kk] <= ci[1])
        res['same_sign'] = do * e['delta_D'] > 0
    else: res.update(holds=False, strong=False, same_sign=None, delta_O=None)
    results.append(res)
for e in ledger:
    r = next((x for x in results if x['id'] == e['id']), None)
    if r: e['oos'] = {'n_O': r['O']['n'], 'delta_O': r.get('delta_O'), 'holds': r['holds'], 'strong': r['strong']}

# ---- "don't trust the model" rules ----
def mstats(per, cell):
    q = [r for r in rows if r['period'] == per and 'mp' in r and r['date'] >= '2016' and match(r, cell)]; n = len(q)
    if not n: return {'n': 0}
    hit = sum(r['mtop'] == r['h1'] for r in q); br = sum(sum((r['mp'][i] - (r['h1'] == K[i])) ** 2 for i in range(3)) for r in q) / n
    pr = {k: sum(r['h1'] == k for r in q) / n for k in K}
    rev = sum(r['h1'] != r['c']['PZ'] for r in q) / n
    return {'n': n, 'hit': hit / n, 'hits': hit, 'brier': br, 'p': pr, 'maxp': max(pr.values()), 'reversal': rev, 'hit_ci': wilson(hit, n)}
allD, allO, allX = mstats('D', ()), mstats('O', ()), mstats('X', ())
mledger, mres = [], []
for cell in cells:
    sd = mstats('D', cell); e = {'cell': name(cell), 'order': len(cell), 'D': sd}
    if sd['n'] >= 40:
        pv = binomtest(sd['hits'], sd['n'], allD['hit']).pvalue
        e['low_hit'] = sd['hit'] <= allD['hit'] - 0.10 and pv < 0.01; e['uniform'] = sd['maxp'] <= 0.50; e['pvalue_D'] = pv
    else: e['low_hit'] = e['uniform'] = False
    e['candidate'] = e['low_hit'] or e['uniform']
    if e['candidate']:
        so = mstats('O', cell); sx = mstats('X', cell); e['O'] = so; e['X'] = sx
        ok_hit = e['low_hit'] and so['n'] >= 30 and so['hit'] <= allO['hit'] - 0.05
        ok_uni = e['uniform'] and so['n'] >= 30 and so['maxp'] <= 0.55
        e['holds'] = bool(ok_hit or ok_uni)
        mres.append(e)
    mledger.append({k: v for k, v in e.items() if k in ('cell', 'order', 'candidate', 'low_hit', 'uniform', 'pvalue_D', 'holds')} | {'n_D': sd['n'], 'hit_D': sd.get('hit')})

json.dump({'protocol': 'see preregistration.md', 'n_cells': len(cells), 'attempts': ledger, 'model_trust_attempts': mledger},
          open(os.path.join(OUT, 'search-ledger.json'), 'w'), indent=0, default=str)
json.dump({'uncond': {f'{a}|{b}': v for (a, b), v in uncond.items()}, 'cond_pz': {f'{a}|{b}|{c}': v for (a, b, c), v in cond.items()},
           'n': {f'{p}|{h}': len(sub(p, h)) for p in 'DOX' for h in ('h1', 'h3')},
           'rules': results, 'model_all': {'D': allD, 'O': allO, 'X': allX}, 'model_rules': mres},
          open(os.path.join(OUT, 'results.json'), 'w'), indent=1, default=str)
print('cells', len(cells), 'attempts', len(ledger), 'cands', len(cands), 'holds', sum(r['holds'] for r in results), 'strong', sum(r['strong'] for r in results))
print('model cands', len(mres), 'holds', sum(e['holds'] for e in mres))

# ---- preregistered cheat-sheet selection (section 8) ----
LD = {a['id']: a for a in ledger}
sel = []
for r in results:
    if not r['holds']: continue
    k = r['signal_class']
    if r['order'] == 2:
        pd = [LD[f"{r['horizon']}|{p}"]['p_D'][k] - LD[f"{r['horizon']}|{p}"]['exp_persist_D'][k] for p in r['cell'].split(' & ')]
        if not all(abs(r['delta_D']) >= abs(x) + 0.05 for x in pd): continue
    sel.append(r)
sel.sort(key=lambda r: -abs(r['z_D'])); cnt = {}; top = []
for r in sel:
    g = tuple(sorted(p.split('=')[0] for p in r['cell'].split(' & ')))
    if cnt.get(g, 0) >= 2: continue
    cnt[g] = cnt.get(g, 0) + 1; top.append(r)
    if len(top) == 10: break
pc = lambda x: f'{x*100:.0f}%'
def line(st, k):
    if not st['n']: return 'n=0'
    lo, hi_ = st['ci'][k]
    return f"A/B/C={pc(st['p']['A'])}/{pc(st['p']['B'])}/{pc(st['p']['C'])}，{k}={pc(st['p'][k])} [CI {pc(lo)}~{pc(hi_)}]，持续基线 {pc(st['exp_persist'][k])}，无条件 {pc(st['uncond'][k])}，n={st['n']}"
md = ['| # | 结局 | 条件 | 信号 | 发现期 2014-21 | 样本外 2022-25 | 2026 观察 | 强 |', '|---|---|---|---|---|---|---|---|']
for i, r in enumerate(top, 1):
    k = r['signal_class']
    md.append(f"| {i} | {'次日' if r['horizon']=='h1' else '第3日'} | {r['cell']} | {k} {'↑' if r['delta_D']>0 else '↓'} | {line(r['D'],k)} | {line(r['O'],k)} | {line(r['X'],k)} | {'是' if r['strong'] else '否'} |")
md += ['', '## 样本外未确认/推翻', '| 结局 | 条件 | 信号 | 发现期 | 样本外 | 原因 |', '|---|---|---|---|---|---|']
for r in sorted(results, key=lambda r: -abs(r['z_D'])):
    if r['holds']: continue
    k = r['signal_class']; o = r['O']
    why = 'n<30' if o['n'] < 30 else ('方向反了' if not r['same_sign'] else ('偏离<5pp' if abs(r['delta_O']) < 0.05 else 'CI过宽'))
    md.append(f"| {r['horizon']} | {r['cell']} | {k} | {line(r['D'],k)} | {line(o,k)} | {why} |")
md += ['', '## 全部样本外成立规则（含未入速查表）', '| 结局 | 条件 | 信号 | 发现期 | 样本外 | 强 |', '|---|---|---|---|---|---|']
for r in sorted(results, key=lambda r: -abs(r['z_D'])):
    if r['holds']:
        k = r['signal_class']; md.append(f"| {r['horizon']} | {r['cell']} | {k} | {line(r['D'],k)} | {line(r['O'],k)} | {'是' if r['strong'] else '否'} |")
def mline(st):
    if not st.get('n'): return 'n=0'
    lo, hi_ = st['hit_ci']; return f"命中 {pc(st['hit'])} [CI {pc(lo)}~{pc(hi_)}]，Brier {st['brier']:.3f}，反转率 {pc(st['reversal'])}，A/B/C={pc(st['p']['A'])}/{pc(st['p']['B'])}/{pc(st['p']['C'])}，n={st['n']}"
md += ['', '## 模型可信度（v4 结构 walk-forward 首选命中）', f"全样本：发现期 {mline(allD)}；样本外 {mline(allO)}；2026 {mline(allX)}", '',
       '| 条件 | 触发 | 发现期 2016-21 | 样本外 2022-25 | 2026 | 成立 |', '|---|---|---|---|---|---|']
for e in sorted(mres, key=lambda e: e['D']['hit']):
    md.append(f"| {e['cell']} | {'低命中' if e['low_hit'] else ''}{' 近均匀' if e['uniform'] else ''} | {mline(e['D'])} | {mline(e['O'])} | {mline(e['X'])} | {'是' if e['holds'] else '否'} |")
open(os.path.join(OUT, 'tables.md'), 'w').write('# 自动生成表（scripts/empirical-rules.py）\n\n## 速查表候选（按预注册第 8 节机械选取）\n' + '\n'.join(md) + '\n')
print('\n'.join(md[:12]))
