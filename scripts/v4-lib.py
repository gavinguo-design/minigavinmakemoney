"""v4 research helpers (numpy only; sklearn/lightgbm not installed on this host)."""
import math, json, os
import numpy as np
from scipy.optimize import minimize

KEYS = ['A', 'B', 'C']
ROOT = os.path.join(os.path.dirname(__file__), '..')


def bounded_round(raw, mn=0.10, mx=0.85, step=0.05):
    """Exact port of DA.boundedRound (scripts/daily-analysis.cjs)."""
    p = list(raw); fixed = [False] * len(p)
    for _ in range(5):
        changed = False
        for i, v in enumerate(p):
            if fixed[i]: continue
            if v < mn: fixed[i] = changed = True; p[i] = mn
            elif v > mx: fixed[i] = changed = True; p[i] = mx
        free = sum(v for i, v in enumerate(p) if not fixed[i]); left = 1 - sum(v for i, v in enumerate(p) if fixed[i])
        if free: p = [v if fixed[i] else v * left / free for i, v in enumerate(p)]
        if not changed: break
    n = round(1 / step); lo = round(mn / step); hi = round(mx / step)
    u = [min(hi, max(lo, math.floor(v * n + 1e-9))) for v in p]
    o = sorted([(i, v * n - math.floor(v * n + 1e-9)) for i, v in enumerate(p)], key=lambda x: (-x[1], x[0]))
    q = 0
    while sum(u) < n and q < 3 * n:
        i = o[q % len(o)][0]
        if u[i] < hi: u[i] += 1
        q += 1
    q = 0
    while sum(u) > n and q < 3 * n:
        i = o[len(o) - 1 - q % len(o)][0]
        if u[i] > lo: u[i] -= 1
        q += 1
    return [round(x * step * 100) / 100 for x in u]


def round_all(P, **kw):
    return np.array([bounded_round(list(p), **kw) for p in P])


def softmax(L):
    L = L - L.max(1, keepdims=True); e = np.exp(L); return e / e.sum(1, keepdims=True)


def fit_mlr(X, y, lam=0.01, sw=None):
    """Multinomial LR, full softmax parameterisation, L2 on non-bias weights (column 0 = bias).
    Objective = mean log-loss + lam/2*||W||^2 (same scaling as optimize-weights.cjs softmaxLR lambda)."""
    l2 = lam * len(y)
    n, d = X.shape; Y = np.eye(3)[y]; sw = np.ones(n) if sw is None else sw
    mask = np.ones((3, d)); mask[:, 0] = 0
    def f(w):
        W = w.reshape(3, d); P = softmax(X @ W.T)
        ll = -(sw * np.log(np.clip((P * Y).sum(1), 1e-12, None))).sum() / sw.sum()
        g = ((P - Y) * sw[:, None]).T @ X / sw.sum()
        return ll + 0.5 * l2 / n * (W * W * mask).sum(), (g + l2 / n * W * mask).ravel()
    r = minimize(f, np.zeros(3 * d), jac=True, method='L-BFGS-B', options={'maxiter': 2000})
    return r.x.reshape(3, d)


def predict_mlr(W, X):
    return softmax(X @ W.T)


# ---------- tiny multiclass gradient boosting (depth<=3, histogram splits, shrinkage, leaf L2) ----------
class GBT:
    def __init__(self, n_rounds=150, lr=0.05, depth=2, min_leaf=60, lam=5.0, bins=16, subsample=0.8, seed=0):
        self.__dict__.update(locals()); del self.__dict__['self']

    def _bin(self, X):
        return np.stack([np.searchsorted(self.edges[j], X[:, j], side='right') for j in range(X.shape[1])], 1)

    def fit(self, X, y):
        rs = np.random.default_rng(self.seed)
        self.edges = [np.unique(np.quantile(X[:, j], np.linspace(0, 1, self.bins + 1)[1:-1])) for j in range(X.shape[1])]
        B = self._bin(X); n = len(y); Y = np.eye(3)[y]
        prior = np.log(np.clip(Y.mean(0), 1e-3, None)); self.prior = prior - prior.mean()
        F = np.tile(self.prior, (n, 1)); self.trees = []
        for _ in range(self.n_rounds):
            P = softmax(F); G = P - Y; H = np.clip(P * (1 - P), 1e-6, None)
            idx = rs.random(n) < self.subsample
            rnd = []
            for k in range(3):
                t = self._grow(B, G[:, k], H[:, k], idx, 0)
                F[:, k] += self.lr * self._apply(t, B) * 2 / 3  # (K-1)/K scaling
                rnd.append(t)
            self.trees.append(rnd)
        return self

    def _grow(self, B, g, h, idx, depth):
        G, H = g[idx].sum(), h[idx].sum()
        leaf = ('leaf', -G / (H + self.lam))
        if depth >= self.depth or idx.sum() < 2 * self.min_leaf: return leaf
        best = None; base = G * G / (H + self.lam)
        for j in range(B.shape[1]):
            b = B[idx, j]; nb = len(self.edges[j]) + 1
            gs = np.bincount(b, g[idx], nb); hs = np.bincount(b, h[idx], nb); cs = np.bincount(b, minlength=nb)
            gl, hl, cl = np.cumsum(gs)[:-1], np.cumsum(hs)[:-1], np.cumsum(cs)[:-1]
            ok = (cl >= self.min_leaf) & (idx.sum() - cl >= self.min_leaf)
            if not ok.any(): continue
            gain = gl ** 2 / (hl + self.lam) + (G - gl) ** 2 / (H - hl + self.lam) - base
            gain[~ok] = -np.inf; s = int(np.argmax(gain))
            if gain[s] > 0 and (best is None or gain[s] > best[0]): best = (gain[s], j, s)
        if best is None: return leaf
        _, j, s = best; left = idx & (B[:, j] <= s); right = idx & (B[:, j] > s)
        return ('split', j, s, self._grow(B, g, h, left, depth + 1), self._grow(B, g, h, right, depth + 1))

    def _apply(self, t, B):
        if t[0] == 'leaf': return np.full(len(B), t[1])
        _, j, s, l, r = t; m = B[:, j] <= s; out = np.empty(len(B)); out[m] = self._apply(l, B[m]); out[~m] = self._apply(r, B[~m]); return out

    def predict(self, X):
        B = self._bin(X); F = np.tile(self.prior, (len(X), 1))
        for rnd in self.trees:
            for k, t in enumerate(rnd): F[:, k] += self.lr * self._apply(t, B) * 2 / 3
        return softmax(F)


# ---------- metrics ----------
def brier_rows(P, y):
    return ((P - np.eye(3)[y]) ** 2).sum(1)


def logloss_rows(P, y):
    return -np.log(np.clip(P[np.arange(len(y)), y], 1e-6, None))


def hit_rows(P, y):
    m = P.max(1, keepdims=True); top = np.abs(P - m) < 1e-9
    return top[np.arange(len(y)), y] / top.sum(1)


def ece(P, y):
    Y = np.eye(3)[y]; p = P.ravel(); o = Y.ravel(); b = np.minimum(9, np.floor(p * 10 + 1e-9)).astype(int)
    tot = 0
    for k in range(10):
        m = b == k
        if m.any(): tot += m.sum() / len(p) * abs(p[m].mean() - o[m].mean())
    return tot


def year_block_ci(diff, years, reps=4000, seed=20261012):
    """Bootstrap over calendar-year blocks: resample years with replacement, mean of day-level diffs."""
    rs = np.random.default_rng(seed); uy = sorted(set(years)); groups = [diff[years == u] for u in uy]
    means = []
    for _ in range(reps):
        pick = rs.integers(0, len(uy), len(uy)); v = np.concatenate([groups[i] for i in pick]); means.append(v.mean())
    means = np.sort(means)
    return float(diff.mean()), float(means[int(0.025 * reps)]), float(means[int(np.ceil(0.975 * reps)) - 1])


def day_block_ci(diff, block=10, reps=2000, seed=20261012):
    rs = np.random.default_rng(seed); n = len(diff); means = []
    for _ in range(reps):
        st = rs.integers(0, n, n // block + 1); idx = (st[:, None] + np.arange(block)).ravel()[:n] % n; means.append(diff[idx].mean())
    means = np.sort(means)
    return float(diff.mean()), float(means[int(0.025 * reps)]), float(means[int(np.ceil(0.975 * reps)) - 1])
