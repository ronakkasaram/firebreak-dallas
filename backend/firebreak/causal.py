"""Does fixing a house protect its neighbours? A natural experiment in Dallas 311 case closures.

Every Dallas code case gets closed eventually, but some are closed within a week and some sit
open for months. If distress spreads, neighbours of quickly-closed cases should see fewer new
problems afterwards than neighbours of slowly-closed ones. No published study we found uses
closure speed this way; the design follows the spatial-spillover literature:

- Ring difference-in-differences (Linden & Rockoff 2008; Butts 2023, "Difference-in-differences
  with spatial spillovers"): the inner ring (0-150 m) is compared with an outer ring
  (250-500 m) around the same case, before and after, so area trends and seasons cancel.
- Treatment is fixed when the case is created (anchoring time there, not at closure, so slow cases
  are not selected on surviving), outcomes are counted from day 31 to day 180 after creation.
- Controls for what predicts slow closure: the inner and outer rings' report rates over the
  previous 180 days, report kind, council district and month.
- Inspector sweeps (one visit writing up a whole block) fake spillovers, so cases with 2+ other
  reports within 150 m on the same day are dropped. Same-day closures are dropped as likely
  administrative ("duplicate", "no violation").

Checks: a placebo outcome that closure speed cannot plausibly move (pipe, street and signal
failures in the same rings), and a pre-period placebo (the same comparison 180 days *before* the
case). Confidence intervals are a cluster bootstrap over 1 km grid squares.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.spatial import cKDTree

from .geo import xy

INNER, OUTER = (0.0, 150.0), (250.0, 500.0)
FAST, SLOW = (1.0, 7.0), (30.0, 3650.0)
POST, PRE = (31, 180), (-180, -1)


def _ring_counts(case_xy, case_t, ev_xy, ev_t, ev_b, case_b, ring, days):
    """Reports at *other* buildings in a distance ring and a day window around each case."""
    tree = cKDTree(ev_xy)
    lists = tree.query_ball_point(case_xy, ring[1])
    out = np.zeros(len(case_xy))
    lo, hi = np.timedelta64(days[0], "D"), np.timedelta64(days[1], "D")
    for i, js in enumerate(lists):
        if not js:
            continue
        js = np.asarray(js)
        d = np.linalg.norm(ev_xy[js] - case_xy[i], axis=1)
        dt = ev_t[js] - case_t[i]
        keep = (d >= ring[0]) & (dt >= lo) & (dt <= hi) & (ev_b[js] != case_b[i])
        out[i] = keep.sum()
    return out


def _ols(X: np.ndarray, y: np.ndarray) -> np.ndarray:
    return np.linalg.lstsq(X, y, rcond=None)[0]


def study(parcels: pd.DataFrame, events: pd.DataFrame, end: pd.Timestamp, n_cases: int = 24000,
          boots: int = 300, seed: int = 7, log=print) -> dict:
    rng = np.random.default_rng(seed)
    key_index = {k: i for i, k in enumerate(parcels.key)}
    pxy = xy(parcels.lat, parcels.lon)
    ev = events.copy()
    ev["b"] = ev.key.map(key_index).fillna(-1).astype(int)
    exy_all = xy(ev.lat, ev.lon)
    prop = ev.property.to_numpy()

    cases = ev[prop & (ev.kind == "code") & (ev.b >= 0) & ev.days_open.notna()
               & (ev.t >= pd.Timestamp("2023-01-01")) & (ev.t <= end - pd.Timedelta(days=POST[1]))].copy()
    cases["fast"] = cases.days_open.between(*FAST)
    cases["slow"] = cases.days_open.between(*SLOW)
    cases = cases[cases.fast | cases.slow]

    # Drop inspector sweeps: 2+ other property reports within 150 m on the same day.
    day = ev.t.dt.floor("D").to_numpy()
    tree = cKDTree(exy_all[prop])
    pday, pb = day[prop], ev.b.to_numpy()[prop]
    cxy = xy(cases.lat, cases.lon)
    near = tree.query_ball_point(cxy, INNER[1])
    cday, cb = cases.t.dt.floor("D").to_numpy(), cases.b.to_numpy()
    sweep = np.array([((pday[js] == cday[i]) & (pb[js] != cb[i])).sum() >= 2 for i, js in enumerate(near)])
    log(f"closure study: {len(cases)} cases, {sweep.mean():.1%} look like sweeps")
    cases = cases[~sweep]
    if len(cases) > n_cases:
        cases = cases.sample(n_cases, random_state=seed)

    cxy, ct, cb = xy(cases.lat, cases.lon), cases.t.to_numpy(), cases.b.to_numpy()
    p_xy, p_t, p_b = exy_all[prop], ev.t.to_numpy()[prop], ev.b.to_numpy()[prop]
    i_xy, i_t = exy_all[~prop], ev.t.to_numpy()[~prop]
    i_b = np.full(len(i_t), -2)

    # Buildings in each ring, to turn counts into rates per building.
    btree = cKDTree(pxy)
    nb_in = btree.query_ball_point(cxy, INNER[1], return_length=True) - 1
    nb_out = btree.query_ball_point(cxy, OUTER[1], return_length=True) - btree.query_ball_point(cxy, OUTER[0], return_length=True)
    nb_in, nb_out = np.maximum(nb_in, 1), np.maximum(nb_out, 1)

    def rates(ring, days, src_xy, src_t, src_b, nb):
        return _ring_counts(cxy, ct, src_xy, src_t, src_b, cb, ring, days) / nb * 1000  # per 1,000 buildings

    y = {}
    for name, (sx, st, sb) in {"prop": (p_xy, p_t, p_b), "infra": (i_xy, i_t, i_b)}.items():
        for when, days in {"post": POST, "pre": PRE, "prepre": (-360, -181)}.items():
            y[f"{name}_in_{when}"] = rates(INNER, days, sx, st, sb, nb_in)
            y[f"{name}_out_{when}"] = rates(OUTER, days, sx, st, sb, nb_out)
    log("closure study: ring counts done")

    T = cases.fast.to_numpy().astype(float)
    month = cases.t.dt.to_period("Q").astype(str).to_numpy()
    dist = cases.district.to_numpy() if "district" in cases else np.zeros(len(cases))
    fe = pd.get_dummies(pd.DataFrame({"m": month, "d": dist.astype(str)}), drop_first=True).to_numpy(float)
    cell = (np.floor(cxy[:, 0] / 1000).astype(np.int64) * 100_000 + np.floor(cxy[:, 1] / 1000).astype(np.int64))

    def did(prefix, post, pre):
        # (inner - outer) after, controlling for (inner - outer) before and both levels before.
        out = y[f"{prefix}_in_{post}"] - y[f"{prefix}_out_{post}"]
        X = np.column_stack([np.ones(len(T)), T, y[f"{prefix}_in_{pre}"], y[f"{prefix}_out_{pre}"], fe])
        return out, X

    def estimate(prefix, post, pre):
        out, X = did(prefix, post, pre)
        beta = _ols(X, out)[1]
        base = float(y[f"{prefix}_in_{post}"][T == 0].mean())
        cells = np.unique(cell)
        idx_by = {c: np.flatnonzero(cell == c) for c in cells}
        bs = []
        for _ in range(boots):
            pick = rng.choice(cells, len(cells))
            ii = np.concatenate([idx_by[c] for c in pick])
            bs.append(_ols(X[ii], out[ii])[1])
        lo, hi = np.percentile(bs, [2.5, 97.5])
        return {"effect_per_1000_buildings": round(float(beta), 2), "ci95": [round(float(lo), 2), round(float(hi), 2)],
                "slow_group_inner_rate": round(base, 2),
                "effect_pct": round(100 * float(beta) / base, 1) if base else None,
                "ci95_pct": [round(100 * float(lo) / base, 1), round(100 * float(hi) / base, 1)] if base else None}

    main = estimate("prop", "post", "pre")
    placebo_infra = estimate("infra", "post", "pre")
    placebo_pre = estimate("prop", "pre", "prepre")
    log(f"closure study: effect {main['effect_pct']}% ({main['ci95_pct']})")
    return {
        "cases": int(len(cases)), "fast_cases": int(T.sum()), "slow_cases": int((T == 0).sum()),
        "fast_days": list(FAST), "slow_days": [SLOW[0], None], "inner_m": list(INNER), "outer_m": list(OUTER),
        "outcome_days": list(POST), "bootstrap": boots,
        "main": main, "placebo_infrastructure": placebo_infra, "placebo_before_case": placebo_pre,
    }
