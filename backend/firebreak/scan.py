"""Emerging-cluster alarms: where are reports piling up faster than this place's own history says?

Method: the expectation-based Poisson scan statistic (Neill, Moore, Sabhnani & Daniel 2005) with
the fast subset scan under a proximity constraint (Neill 2012, JRSS-B 74(2), "Fast subset scan
for spatial pattern detection"). Prospective, like Kulldorff's (2001) surveillance scan: on a
given day it only looks at windows that end that day.

    cells      150 m squares that contain at least one building
    counts     distinct buildings with a new case in the window, not reports: one loud apartment
               complex is a hot building, many houses at once is spread
    baseline   b_i(w) = the cell's average distinct-building count over w-day blocks in the year
               before the windows, x the
               citywide ratio of reports in the window to the city's own rate (so a citywide surge,
               a holiday or a season does not raise alarms; only local excess does)
    score      F(S) = C log(C / B) + B - C   when C > B, else 0     (C, B summed over the subset S)
    subsets    for every cell, any subset of its k = 24 nearest cells. The score has the linear-time
               subset scanning property: sorting cells by c_i / b_i, the best subset is always a
               prefix of that order, so 2^24 subsets reduce to 24.
    windows    the last 7, 14 or 28 days
    alarm      311 counts are overdispersed, so a Poisson Monte Carlo flags something every week.
               Instead, like New York City's health department scan, each score is compared with the
               city's own history: the best score of every week in the previous year. The share of
               those weekly maxima that beat today's cluster is its p-value; 1 / p in weeks is its
               recurrence interval ("a cluster this strong appears once every N weeks").
               The Poisson Monte Carlo is kept as a reported secondary check.

Backtest: every week from mid-2025, the alarms that fired are followed for 60 days. If alarms
are real, their area keeps reporting above its baseline afterwards.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.spatial import cKDTree

from .geo import xy

CELL_M = 150.0
K = 24
WINDOWS = (7, 14, 28)
HISTORY = 365


class Grid:
    def __init__(self, pxy: np.ndarray):
        ij = np.floor(pxy / CELL_M).astype(np.int64)
        keys, inv = np.unique(ij[:, 0] * 1_000_003 + ij[:, 1], return_inverse=True)
        self.n = len(keys)
        self.bcell = inv
        self.center = np.zeros((self.n, 2))
        np.add.at(self.center, inv, pxy)
        self.center /= np.bincount(inv, minlength=self.n)[:, None]
        self.buildings = np.bincount(inv, minlength=self.n)
        _, self.nbr = cKDTree(self.center).query(self.center, k=K)  # includes the cell itself
        self.tree = cKDTree(self.center)

    def cell_of(self, exy: np.ndarray, max_d: float = CELL_M) -> np.ndarray:
        d, j = self.tree.query(exy)
        return np.where(d <= max_d, j, -1)


def _counts(cell: np.ndarray, t: np.ndarray, n: int, lo: np.datetime64, hi: np.datetime64) -> np.ndarray:
    m = (t >= lo) & (t < hi) & (cell >= 0)
    return np.bincount(cell[m], minlength=n).astype(float)


def _ltss(c: np.ndarray, b: np.ndarray, nbr: np.ndarray):
    """Best expectation-based Poisson score per centre over prefixes of its neighbours sorted by
    c / b. c, b: (..., n). Returns score (..., n) and the prefix length (..., n)."""
    cn, bn = c[..., nbr], b[..., nbr]                       # (..., n, K)
    order = np.argsort(-(cn / bn), axis=-1)
    C = np.cumsum(np.take_along_axis(cn, order, -1), -1)
    B = np.cumsum(np.take_along_axis(bn, order, -1), -1)
    with np.errstate(divide="ignore", invalid="ignore"):
        F = np.where(C > B, C * np.log(C / B) + B - C, 0.0)
    j = F.argmax(-1)
    return np.take_along_axis(F, j[..., None], -1)[..., 0], j + 1, order


def _distinct(cell, bid, t, n, lo, hi) -> np.ndarray:
    m = (t >= lo) & (t < hi) & (cell >= 0)
    pairs = np.unique(cell[m].astype(np.int64) * 10_000_000 + bid[m])
    return np.bincount(pairs // 10_000_000, minlength=n).astype(float)


def baselines(cell, t, n, T: pd.Timestamp, bid=None):
    T64 = np.datetime64(T)
    wmax = max(WINDOWS)
    h_hi = T64 - np.timedelta64(wmax, "D")
    h_lo = h_hi - np.timedelta64(HISTORY, "D")
    hist = _counts(cell, t, n, h_lo, h_hi)
    rate = (hist + 0.5) / HISTORY                           # cases per cell per day, for follow-ups
    out = {}
    for w in WINDOWS:
        blocks = [_distinct(cell, bid, t, n, h_lo + np.timedelta64(k * w, "D"), h_lo + np.timedelta64((k + 1) * w, "D"))
                  for k in range(HISTORY // w)]
        base = (np.sum(blocks, axis=0) + 0.5) / len(blocks)  # half a building of prior per cell
        c = _distinct(cell, bid, t, n, T64 - np.timedelta64(w, "D"), T64)
        factor = max(c.sum() / (np.sum(blocks) / len(blocks)), 0.25)
        out[w] = (c, base * factor)
    return out, rate


def scan_day(G: Grid, cell, t, T: pd.Timestamp, draws: int = 0, seed: int = 0, top: int = 12, bid=None):
    data, rate = baselines(cell, t, G.n, T, bid)
    best = {}
    for w, (c, b) in data.items():
        F, j, order = _ltss(c, b, G.nbr)
        best[w] = (F, j, order)
    obs = np.max(np.stack([best[w][0] for w in WINDOWS]), axis=0)  # best per centre over windows

    # Null maxima: nested Poisson draws so the 7, 14 and 28 day counts agree.
    rng = np.random.default_rng(seed)
    null_max = np.empty(draws)
    b7, b14, b28 = (data[w][1] for w in WINDOWS)
    for r in range(draws):
        c7 = rng.poisson(b7)
        c14 = c7 + rng.poisson(np.clip(b14 - b7, 0, None))
        c28 = c14 + rng.poisson(np.clip(b28 - b14, 0, None))
        null_max[r] = max(_ltss(cc.astype(float), bb, G.nbr)[0].max() for cc, bb in ((c7, b7), (c14, b14), (c28, b28)))

    # Report non-overlapping clusters, best first.
    taken = np.zeros(G.n, bool)
    clusters = []
    for centre in np.argsort(-obs):
        if len(clusters) >= top or obs[centre] <= 0:
            break
        w = max(WINDOWS, key=lambda w: best[w][0][centre])
        F, j, order = best[w]
        members = G.nbr[centre][order[centre][: j[centre]]]
        if taken[members].any():
            continue
        taken[members] = True
        c, b = data[w]
        p = (1 + (null_max >= F[centre]).sum()) / (draws + 1) if draws else None
        clusters.append({"centre": int(centre), "cells": members.tolist(), "window_days": w, "score": float(F[centre]),
                         "observed": int(c[members].sum()), "expected": round(float(b[members].sum()), 2),
                         "p_poisson": None if p is None else round(float(p), 4), "buildings": int(G.buildings[members].sum())})
    return clusters, rate


def history(G: Grid, cell, t, bid, start: str, end: str, log=print) -> list:
    """Weekly scans from start to end (no Monte Carlo): every week's clusters and best score."""
    out = []
    for T in pd.date_range(start, end, freq="7D"):
        clusters, rate = scan_day(G, cell, t, T, top=8, bid=bid)
        out.append((T, clusters, rate))
    log(f"  scan history: {len(out)} weeks")
    return out


def with_history_p(clusters, maxima: np.ndarray):
    for k in clusters:
        k["p"] = round(float((1 + (maxima >= k["score"]).sum()) / (len(maxima) + 1)), 4)
        k["recurrence_weeks"] = round(1 / k["p"], 1)
    return clusters


def backtest(G: Grid, cell, t, weeks: list, follow: int = 60, alpha: float = 0.05) -> tuple[dict, pd.DataFrame]:
    """For each week with a year of history behind it, the top 3 clusters by score (with their
    recurrence p-value against the previous 52 weekly maxima). Each cluster area is followed for `follow` days: observed reports
    against its own baseline rate x the citywide ratio over the same days. Control: the same
    number of cells, chosen as the top cells by raw count in the last 28 days (the obvious
    "where were the most calls" rule)."""
    maxima = np.array([max((k["score"] for k in c), default=0.0) for _, c, _ in weeks])
    rows = []
    for w, (T, clusters, rate) in enumerate(weeks):
        if w < 52 or T + pd.Timedelta(days=follow) > pd.Timestamp(t.max()):
            continue
        T64 = np.datetime64(T)
        nxt = _counts(cell, t, G.n, T64, T64 + np.timedelta64(follow, "D"))
        city_factor = nxt.sum() / (follow * rate.sum())
        recent = _counts(cell, t, G.n, T64 - np.timedelta64(28, "D"), T64)
        for k in with_history_p(clusters, maxima[w - 52:w])[:3]:
            m = np.array(k["cells"])
            ctrl = np.argsort(-recent)[: len(m)]
            rows.append({"date": T.strftime("%Y-%m-%d"), "window_days": k["window_days"], "p": k["p"],
                         "observed_after": int(nxt[m].sum()), "expected_after": float(follow * rate[m].sum() * city_factor),
                         "control_observed_after": int(nxt[ctrl].sum()),
                         "control_expected_after": float(follow * rate[ctrl].sum() * city_factor)})
    df = pd.DataFrame(rows)
    if df.empty:
        return {"alarms": 0}, df
    r = df.observed_after / df.expected_after
    rc = df.control_observed_after / df.control_expected_after
    return {
        "weeks": int(df.date.nunique()), "clusters_followed": int(len(df)), "rare_alarms": int((df.p <= alpha).sum()),
        "follow_days": follow, "alpha": alpha,
        "median_obs_over_exp_after": round(float(r.median()), 2),
        "pooled_obs_over_exp_after": round(float(df.observed_after.sum() / df.expected_after.sum()), 2),
        "share_still_hot": round(float((r > 1.5).mean()), 3),
        "control_median_obs_over_exp_after": round(float(rc.median()), 2),
        "control_pooled_obs_over_exp_after": round(float(df.control_observed_after.sum() / df.control_expected_after.sum()), 2),
    }, df


def run(parcels: pd.DataFrame, pxy: np.ndarray, events: pd.DataFrame, today: pd.Timestamp, log=print) -> dict:
    from .geo import LAT0, M_LAT, M_LON
    G = Grid(pxy)
    ev = events[events.property].sort_values(["key", "kind", "t"])
    gap = ev.groupby(["key", "kind"]).t.diff()
    ev = ev[gap.isna() | (gap > pd.Timedelta(days=2))]  # count cases, not repeat calls
    cell = G.cell_of(xy(ev.lat, ev.lon))
    t = ev.t.values.astype("datetime64[ns]")
    bid = pd.factorize(ev.key)[0].astype(np.int64)
    log(f"scan grid: {G.n} cells")
    weeks = history(G, cell, t, bid, (today - pd.Timedelta(weeks=52 * 2)).strftime("%Y-%m-%d"), today.strftime("%Y-%m-%d"), log=log)
    summary, df = backtest(G, cell, t, weeks)
    maxima = np.array([max((k["score"] for k in c), default=0.0) for _, c, _ in weeks[-53:-1]])
    clusters, _ = scan_day(G, cell, t, today, draws=199, bid=bid)
    with_history_p(clusters, maxima)
    lonlat = lambda i: [round(float(G.center[i, 0] / M_LON - 96.8), 5), round(float(G.center[i, 1] / M_LAT + LAT0), 5)]  # noqa: E731
    out = []
    for k in clusters:
        m = np.array(k["cells"])
        out.append({**{x: k[x] for x in ("window_days", "score", "observed", "expected", "p", "recurrence_weeks", "p_poisson", "buildings")},
                    "cells": [lonlat(i) for i in m]})
    timeline = [{"date": T.strftime("%Y-%m-%d"), "max_score": round(max((k["score"] for k in c), default=0.0), 2),
                 "top": [lonlat(k["centre"]) + [round(k["score"], 1)] for k in c[:3]]} for T, c, _ in weeks]
    return {"as_of": today.strftime("%Y-%m-%d"), "cell_m": CELL_M, "k": K, "windows": list(WINDOWS),
            "clusters": out, "backtest": summary, "timeline": timeline}
