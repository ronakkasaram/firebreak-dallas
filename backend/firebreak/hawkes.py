"""A self-exciting (Hawkes) model of building distress, house by house.

Every building i has a rate of new property reports per day:

    lambda_i(t) = mu_i  +  sum over earlier reports e within 250 m and 180 days of
                           w(e, i) * beta * exp(-beta * (t - t_e))

    mu_i      background rate, log-linear in the building's DCAD record (value, age, owner type...)
              and in log(1 + its reports in the year before the window): some houses are
              chronically in trouble, and a 30-day trigger alone would forget that
    w(e, i)   a_self[kind]                       if report e was at building i itself
              a_nb[kind] * exp(-d(e, i) / sigma)  if it was at another building d metres away
    beta      how fast a report's influence fades. Two time scales are fitted together:
              a fast one (hours: neighbours reporting the same problem) and a slow one
              (weeks: real spread). The simulator in the console uses only the slow one.

So a report does not just predict more reports: it *raises the rate* of the house it is on and of
the houses around it, by an amount that depends on its kind (vacancy, nuisance, code...).

Fitting uses expectation-maximisation with stochastic declustering, the method Mohler et al. (2011,
JASA, "Self-exciting point process modeling of crime") used for burglaries, and the covariate
background follows the Rome road-accident model (Alaimo Di Loro et al.). The E-step gives, for each
report, the probability that it was background or triggered by each earlier report. That gives:
- the share of Dallas distress reports that were triggered by an earlier nearby report,
- the most likely "parent" of each recent report, drawn in the console as arcs between houses.

The held-out test fits on 2025 and scores the first half of 2026 against a Poisson model with the
same covariates and no triggering.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from scipy.spatial import cKDTree
from sklearn.linear_model import PoissonRegressor

from .geo import xy

KINDS = ["code", "rental", "tenant", "vacancy", "nuisance"]
R = 250.0
DT_MAX = 180.0
SIGMAS = [25.0, 50.0, 100.0]
SHELLS = np.array([10, 25, 40, 60, 80, 100, 130, 160, 200, 250], dtype=float)
CLASS_CODE = {"home": 0, "multifamily": 1, "commercial": 2, "industrial": 3}
COND = {"UNSOUND": 0, "VERY POOR": 1, "POOR": 2, "FAIR": 3, "AVERAGE": 4, "GOOD": 5, "VERY GOOD": 6, "EXCELLENT": 7}
COVARIATES = ["log_value", "year_built", "condition", "absentee", "entity", "homestead", "out_of_state",
              "multifamily", "commercial", "industrial", "log_sqft", "chronic"]


def chronic(key_index: dict, events: pd.DataFrame, T: pd.Timestamp, n: int) -> np.ndarray:
    """log(1 + property reports at each building in the 365 days before T). Not standardised, so
    the same coefficient applies to every window."""
    e = events[events.property & (events.t >= T - pd.Timedelta(days=365)) & (events.t < T)]
    idx = e.key.map(key_index).dropna().astype(int).to_numpy()
    return np.log1p(np.bincount(idx, minlength=n).astype(float))


def with_chronic(Z: np.ndarray, key_index: dict, events: pd.DataFrame, T: pd.Timestamp) -> np.ndarray:
    return np.column_stack([Z, chronic(key_index, events, T, Z.shape[0])])


def covariates(p: pd.DataFrame) -> tuple[np.ndarray, dict]:
    """Standardised background covariates with an intercept column first."""
    c = pd.DataFrame({
        "log_value": np.log1p(p.value), "year_built": p.year_built, "condition": p.condition.map(COND),
        "absentee": p.absentee.astype(float), "entity": p.owner_is_entity.astype(float),
        "homestead": p.homestead.astype(float), "out_of_state": p.owner_out_of_state.astype(float),
        "multifamily": (p.asset_class == "multifamily").astype(float),
        "commercial": (p.asset_class == "commercial").astype(float),
        "industrial": (p.asset_class == "industrial").astype(float), "log_sqft": np.log1p(p.sqft),
    })
    c = c.fillna(c.median())
    mean, std = c.mean(), c.std().replace(0, 1)
    Z = np.column_stack([np.ones(len(c)), ((c - mean) / std).to_numpy()])
    return Z, {"mean": mean.round(4).to_dict(), "std": std.round(4).to_dict()}


@dataclass
class Window:
    """Everything the likelihood needs for one fitting or test window, in days since w0."""
    T: float
    src_t: np.ndarray       # source reports (history + window): time, kind, own building, position
    src_k: np.ndarray
    src_own: np.ndarray
    src_xy: np.ndarray
    G: dict                 # sigma -> sum over other buildings within R of exp(-d / sigma), per source
    tgt_b: np.ndarray       # target reports (inside the window, at a known building): building index
    tgt_src: np.ndarray     # the target's own row in the source arrays
    pair_t: np.ndarray      # (target, source) pairs within R and (0, DT_MAX] days
    pair_e: np.ndarray
    pair_dt: np.ndarray
    pair_d: np.ndarray
    pair_self: np.ndarray


def window(pxy: np.ndarray, key_index: dict, events: pd.DataFrame, h0, w0, w1) -> Window:
    ev = events[events.property & events.kind.isin(KINDS) & (events.t >= h0) & (events.t < w1)]
    # One problem reported several times is one case: drop repeats of the same kind at the same
    # address within 2 days.
    ev = ev.sort_values(["key", "kind", "t"])
    gap = ev.groupby(["key", "kind"]).t.diff()
    ev = ev[gap.isna() | (gap > pd.Timedelta(days=2))].sort_values("t")
    t = ((ev.t - w0).dt.total_seconds() / 86400).to_numpy()
    k = ev.kind.map({x: i for i, x in enumerate(KINDS)}).to_numpy()
    own = np.array([key_index.get(x, -1) for x in ev.key], dtype=np.int64)
    exy = xy(ev.lat, ev.lon)
    T = (w1 - w0).total_seconds() / 86400

    # Neighbor exposure of each source report, from building counts in distance shells.
    btree = cKDTree(pxy)
    counts = np.column_stack([btree.query_ball_point(exy, r, return_length=True) for r in SHELLS]).astype(float)
    counts[:, 0] -= (own >= 0)  # the report's own building is not a neighbor
    shell_n = np.diff(np.column_stack([np.zeros(len(exy)), counts]), axis=1).clip(min=0)
    mids = (np.concatenate([[0], SHELLS[:-1]]) + SHELLS) / 2
    G = {s: shell_n @ np.exp(-mids / s) for s in SIGMAS}

    tgt_rows = np.where((t >= 0) & (own >= 0))[0]
    stree = cKDTree(exy)
    pt, pe, pdt, pdd, ps = [], [], [], [], []
    for start in range(0, len(tgt_rows), 4000):
        rows = tgt_rows[start:start + 4000]
        bpos = pxy[own[rows]]
        lists = stree.query_ball_point(bpos, R)
        lens = np.fromiter((len(x) for x in lists), dtype=np.int64, count=len(lists))
        e = np.concatenate([np.asarray(x, dtype=np.int64) for x in lists]) if lens.sum() else np.zeros(0, np.int64)
        tt = np.repeat(np.arange(start, start + len(rows)), lens)
        dt = t[rows][tt - start] - t[e]
        keep = (dt > 0) & (dt <= DT_MAX)
        tt, e, dt = tt[keep], e[keep], dt[keep]
        d = np.linalg.norm(exy[e] - pxy[own[rows][tt - start]], axis=1)
        pt.append(tt); pe.append(e); pdt.append(dt); pdd.append(d); ps.append(own[e] == own[rows][tt - start])
    cat = lambda a, dt=None: np.concatenate(a) if a else np.zeros(0, dt or float)  # noqa: E731
    return Window(T=T, src_t=t, src_k=k, src_own=own, src_xy=exy, G=G, tgt_b=own[tgt_rows], tgt_src=tgt_rows,
                  pair_t=cat(pt, np.int64), pair_e=cat(pe, np.int64), pair_dt=cat(pdt), pair_d=cat(pdd),
                  pair_self=cat(ps, bool))


@dataclass
class Params:
    sigma: float
    beta: np.ndarray        # [fast, slow] decay per day
    pi: float               # share of triggered mass on the fast time scale
    a_self: np.ndarray
    a_nb: np.ndarray
    theta: np.ndarray
    history: list = field(default_factory=list)


def _trig(W: Window, P: Params) -> tuple[np.ndarray, np.ndarray]:
    k = W.src_k[W.pair_e]
    w = np.where(W.pair_self, P.a_self[k], P.a_nb[k] * np.exp(-W.pair_d / P.sigma))
    fast = w * P.pi * P.beta[0] * np.exp(-P.beta[0] * W.pair_dt)
    slow = w * (1 - P.pi) * P.beta[1] * np.exp(-P.beta[1] * W.pair_dt)
    return fast, slow


def _mass(W: Window, P: Params) -> np.ndarray:
    """Share of each source's kernel that falls inside the window."""
    a = np.clip(-W.src_t, 0, None)
    b = W.T - W.src_t
    f = lambda beta: np.exp(-beta * a) - np.exp(-beta * b)  # noqa: E731
    return P.pi * f(P.beta[0]) + (1 - P.pi) * f(P.beta[1])


def _compensator(W: Window, P: Params, Z: np.ndarray) -> float:
    w = P.a_self[W.src_k] * (W.src_own >= 0) + P.a_nb[W.src_k] * W.G[P.sigma]
    return float(W.T * np.exp(Z @ P.theta).sum() + (w * _mass(W, P)).sum())


def loglik(W: Window, P: Params, Z: np.ndarray):
    """Log-likelihood, background share per target, and per-pair [fast, slow] responsibilities."""
    mu = np.exp(Z[W.tgt_b] @ P.theta)
    fast, slow = _trig(W, P)
    lam = mu + np.bincount(W.pair_t, fast + slow, minlength=len(W.tgt_b))
    denom = lam[W.pair_t]
    return float(np.log(lam).sum() - _compensator(W, P, Z)), mu / lam, fast / denom, slow / denom


def fit(W: Window, Z: np.ndarray, sigma: float, iters: int = 40) -> Params:
    n_b = Z.shape[0]
    P = Params(sigma=sigma, beta=np.array([2.0, 1 / 30]), pi=0.5, a_self=np.full(len(KINDS), 0.2),
               a_nb=np.full(len(KINDS), 0.005), theta=np.zeros(Z.shape[1]))
    P.theta[0] = np.log(max(len(W.tgt_b), 1) / (W.T * n_b))
    k_pair = W.src_k[W.pair_e]
    reg = PoissonRegressor(alpha=1e-6, fit_intercept=False, max_iter=300)
    for it in range(iters):
        ll, p_bg, p_fast, p_slow = loglik(W, P, Z)
        p_pair = p_fast + p_slow
        P.history.append(ll)
        F = _mass(W, P)
        for k in range(len(KINDS)):
            src_k = W.src_k == k
            num_s = p_pair[W.pair_self & (k_pair == k)].sum()
            num_n = p_pair[~W.pair_self & (k_pair == k)].sum()
            den_s = ((W.src_own >= 0) & src_k).astype(float) @ F
            den_n = (W.G[sigma] * src_k) @ F
            P.a_self[k] = num_s / den_s if den_s > 0 else 0.0
            P.a_nb[k] = num_n / den_n if den_n > 0 else 0.0
        P.beta = np.array([p_fast.sum() / max((p_fast * W.pair_dt).sum(), 1e-9),
                           p_slow.sum() / max((p_slow * W.pair_dt).sum(), 1e-9)])
        if P.beta[0] < P.beta[1]:  # keep [fast, slow] order
            P.beta = P.beta[::-1].copy()
            p_fast, p_slow = p_slow, p_fast
        P.pi = float(p_fast.sum() / max(p_pair.sum(), 1e-9))
        bg = np.bincount(W.tgt_b, p_bg, minlength=n_b)
        reg.fit(Z, bg / W.T, sample_weight=np.full(n_b, W.T))
        P.theta = reg.coef_.copy()
        if it > 3 and abs(P.history[-1] - P.history[-2]) < 1e-7 * abs(P.history[-1]):
            break
    return P


def poisson_baseline(W: Window, Z: np.ndarray) -> np.ndarray:
    """Same covariates, no triggering: the model a single owner's records would give."""
    y = np.bincount(W.tgt_b, minlength=Z.shape[0]) / W.T
    reg = PoissonRegressor(alpha=1e-6, fit_intercept=False, max_iter=300)
    return reg.fit(Z, y, sample_weight=np.full(Z.shape[0], W.T)).coef_


def poisson_loglik(W: Window, theta: np.ndarray, Z: np.ndarray) -> float:
    return float((Z[W.tgt_b] @ theta).sum() - W.T * np.exp(Z @ theta).sum())


def run(parcels: pd.DataFrame, pxy: np.ndarray, events: pd.DataFrame, today: pd.Timestamp, log=print) -> dict:
    """Fit on 2025, test on 2026 H1, then decluster the last 120 days for the console."""
    key_index = {k: i for i, k in enumerate(parcels.key)}
    Z0, zinfo = covariates(parcels)
    ts = pd.Timestamp
    Z = with_chronic(Z0, key_index, events, ts("2025-01-01"))
    Wtr = window(pxy, key_index, events, ts("2024-07-01"), ts("2025-01-01"), ts("2026-01-01"))
    log(f"hawkes train: {len(Wtr.tgt_b)} reports, {len(Wtr.pair_t)} pairs")
    best = None
    for s in SIGMAS:
        P = fit(Wtr, Z, s)
        ll = loglik(Wtr, P, Z)[0]
        log(f"  sigma {s}: loglik {ll:.0f}, beta {P.beta.round(4)}, pi {P.pi:.3f}")
        if best is None or ll > best[0]:
            best = (ll, P)
    ll_tr, P = best
    _, p_bg_tr, p_fast_tr, p_slow_tr = loglik(Wtr, P, Z)
    theta0 = poisson_baseline(Wtr, Z)

    Wte = window(pxy, key_index, events, ts("2025-07-01"), ts("2026-01-01"), ts("2026-07-01"))
    Zte = with_chronic(Z0, key_index, events, ts("2026-01-01"))
    ll_h = loglik(Wte, P, Zte)[0]
    ll_p = poisson_loglik(Wte, theta0, Zte)
    n_te = len(Wte.tgt_b)

    # Mean neighbor exposure, so the branching ratio means "offspring per report" in Dallas.
    mean_G = float(Wtr.G[P.sigma].mean())
    # Offspring per report on the slow (spread) time scale: to the same house and to neighbours.
    branching = {k: {"same_house": round(float(P.a_self[i] * (1 - P.pi)), 4),
                     "neighbours": round(float(P.a_nb[i] * mean_G * (1 - P.pi)), 4)} for i, k in enumerate(KINDS)}
    kind_share = np.bincount(Wtr.src_k[Wtr.tgt_src], minlength=len(KINDS)) / max(len(Wtr.tgt_src), 1)

    # Declustering of the last 120 days: most likely parent of each recent report.
    Wnow = window(pxy, key_index, events, today - pd.Timedelta(days=300), today - pd.Timedelta(days=120), today)
    _, p_bg_now, _, p_pair_now = loglik(Wnow, P, with_chronic(Z0, key_index, events, today - pd.Timedelta(days=120)))  # arcs use the slow (spread) component
    arcs = []
    if len(p_pair_now):
        order = np.lexsort((-p_pair_now, Wnow.pair_t))
        first = np.ones(len(order), bool)
        first[1:] = Wnow.pair_t[order][1:] != Wnow.pair_t[order][:-1]
        top = order[first]
        for q in top[(p_pair_now[top] > 0.25) & ~Wnow.pair_self[top]]:
            t_i, e_i = Wnow.pair_t[q], Wnow.pair_e[q]
            child = pxy[Wnow.tgt_b[t_i]]
            arcs.append([*_lonlat(Wnow.src_xy[e_i]), *_lonlat(child), round(float(p_pair_now[q]), 3),
                         round(float(Wnow.src_t[Wnow.tgt_src[t_i]]), 1), int(Wnow.src_k[e_i])])
    mu = np.exp(with_chronic(Z0, key_index, events, today) @ P.theta)
    return {
        "params": {"sigma_m": P.sigma, "beta_fast": round(float(P.beta[0]), 5), "beta_slow": round(float(P.beta[1]), 5),
                   "fast_share": round(P.pi, 4), "fast_delay_hours": round(24 / float(P.beta[0]), 1),
                   "slow_delay_days": round(1 / float(P.beta[1]), 1),
                   "radius_m": R, "window_days": DT_MAX,
                   "a_self": dict(zip(KINDS, np.round(P.a_self, 5).tolist())),
                   "a_nb": dict(zip(KINDS, np.round(P.a_nb, 6).tolist())),
                   "theta": dict(zip(["intercept"] + COVARIATES, np.round(P.theta, 4).tolist())),
                   "kind_share": dict(zip(KINDS, np.round(kind_share, 4).tolist())), "covariates": zinfo},
        "fit": {"train": "2025-01-01 to 2026-01-01", "test": "2026-01-01 to 2026-07-01", "sigmas_tried": SIGMAS,
                "train_reports": int(len(Wtr.tgt_b)), "train_pairs": int(len(Wtr.pair_t)), "em_loglik": P.history,
                "test_reports": int(n_te), "test_loglik_hawkes": round(ll_h, 1), "test_loglik_poisson": round(ll_p, 1),
                "test_gain_nats_per_report": round((ll_h - ll_p) / max(n_te, 1), 4),
                "triggered_share": round(float(1 - p_bg_tr.mean()), 4),
                "spread_share": round(float(np.bincount(Wtr.pair_t, p_slow_tr, minlength=len(Wtr.tgt_b)).mean()), 4),
                "triggered_share_recent": round(float(1 - p_bg_now.mean()), 4) if len(p_bg_now) else None,
                "mean_neighbor_exposure": round(mean_G, 3)},
        "branching": branching,
        "arcs": arcs,
        "arcs_columns": ["src_lon", "src_lat", "dst_lon", "dst_lat", "p", "day_since_window_start", "src_kind"],
        "arcs_window_start": (today - pd.Timedelta(days=120)).strftime("%Y-%m-%d"),
        "mu": mu.astype(np.float32),
        "_P": P, "_Z": Z0, "_key_index": key_index,
    }


def _lonlat(v: np.ndarray) -> list[float]:
    from .geo import LAT0, M_LAT, M_LON
    return [round(float(v[0] / M_LON - 96.8), 6), round(float(v[1] / M_LAT + LAT0), 6)]


def expected_reports(P: Params, Z: np.ndarray, pxy: np.ndarray, key_index: dict, events: pd.DataFrame,
                     T: pd.Timestamp, horizon: float = 90.0) -> np.ndarray:
    """Expected new reports per building in (T, T + horizon], from its background rate plus the
    slow (spread) part of every deduplicated report in the 180 days before T (Z: covariates without
    the chronic column, which is added here for T). First order: it does
    not count reports triggered by reports that have not happened yet (the console simulates those)."""
    W = window(pxy, key_index, events, T - pd.Timedelta(days=DT_MAX), T, T + pd.Timedelta(seconds=1))
    past = W.src_t < 0
    age = -W.src_t[past]
    k = W.src_k[past]
    # Share of each report's slow kernel that lands inside the horizon.
    b = P.beta[1]
    mass = (1 - P.pi) * (np.exp(-b * age) - np.exp(-b * (age + horizon)))
    m = horizon * np.exp(with_chronic(Z, key_index, events, T) @ P.theta)
    own = W.src_own[past]
    np.add.at(m, own[own >= 0], (P.a_self[k] * mass)[own >= 0])
    tree = cKDTree(pxy)
    lists = tree.query_ball_point(W.src_xy[past], R)
    for j, nb in enumerate(lists):
        nb = np.asarray(nb, dtype=np.int64)
        nb = nb[nb != own[j]]
        if len(nb):
            d = np.linalg.norm(pxy[nb] - W.src_xy[past][j], axis=1)
            m[nb] += P.a_nb[k[j]] * np.exp(-d / P.sigma) * mass[j]
    return m
