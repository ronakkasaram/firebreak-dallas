"""Two checks a city would ask for before using the watch list, both on the held-out cutoff.

1. Lead time (the Chicago food-inspection metric). Chicago's model was judged by how many days
   earlier inspectors found violations when they visited in model order instead of the usual order.
   Here: an inspection crew can visit C buildings a day, in score order, starting on the cutoff.
   A case counts as "reached early" when the crew gets there before the first 311 report. The
   complaint-driven status quo reaches no case early, by definition.

2. Fairness by city council district (the Aequitas audit DSSG used in Cincinnati). For each of
   Dallas's 14 districts: share of flags vs share of real cases, precision and recall of the watch
   list. A district whose recall is under 0.8 of the citywide recall is under-served by the list;
   one whose false discovery rate is over 1.25 of citywide gets extra visits for nothing.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.spatial import cKDTree

from .geo import xy
from .model import HORIZON, World, _window

CAPACITY = 50  # buildings a crew visits per day


def first_report_day(w: World, T: pd.Timestamp) -> np.ndarray:
    """Days from T to each building's first property report in [T, T + 90 days); NaN if none."""
    s = _window(w.prop_t, T, T + HORIZON)
    first = np.full(len(w.parcels), np.nan)
    for t, k in zip(w.prop_t[s], w.prop_key[s]):
        i = w.key_index.get(k)
        if i is not None and np.isnan(first[i]):
            first[i] = (t - T.value) / 86_400e9
    return first


def lead_time(first: np.ndarray, scores: dict[str, np.ndarray], capacity: int = CAPACITY) -> dict:
    """For each ranking: cases reached before their first report, and how many days before."""
    cases = ~np.isnan(first)
    visits = int(capacity * HORIZON.days)
    out = {"capacity_per_day": capacity, "visits": visits, "cases": int(cases.sum()), "rankings": {}}
    for name, s in scores.items():
        order = np.argsort(-s)[:visits]
        visit_day = np.arange(len(order)) // capacity
        f = first[order]
        early = ~np.isnan(f) & (visit_day < f)
        ahead = (f - visit_day)[early]
        out["rankings"][name] = {
            "cases_reached_early": int(early.sum()),
            "share_of_cases": round(float(early.sum() / max(cases.sum(), 1)), 4),
            "median_days_ahead": round(float(np.median(ahead)), 1) if len(ahead) else None,
            "mean_days_ahead": round(float(ahead.mean()), 1) if len(ahead) else None,
        }
    return out


def districts(parcels: pd.DataFrame, events: pd.DataFrame) -> np.ndarray:
    """Council district of each building: the district of the nearest 311 record that has one."""
    e = events[events.district > 0]
    if not len(e):
        return np.zeros(len(parcels), dtype=int)
    _, j = cKDTree(xy(e.lat, e.lon)).query(xy(parcels.lat, parcels.lon))
    return e.district.to_numpy()[j]


def fairness(district: np.ndarray, y: np.ndarray, s: np.ndarray, watch: int = 2000) -> dict:
    flag = np.zeros(len(y), bool)
    flag[np.argsort(-s)[:watch]] = True
    tp = flag & (y == 1)
    city_recall = tp.sum() / max(y.sum(), 1)
    city_fdr = 1 - tp.sum() / max(flag.sum(), 1)
    rows = []
    for d in sorted(set(district.tolist()) - {0}):
        m = district == d
        n_flag, n_case, n_tp = int(flag[m].sum()), int(y[m].sum()), int(tp[m].sum())
        recall = n_tp / n_case if n_case else None
        fdr = 1 - n_tp / n_flag if n_flag else None
        rows.append({
            "district": int(d), "buildings": int(m.sum()), "cases": n_case, "flagged": n_flag,
            "case_share": round(float(n_case / max(y.sum(), 1)), 4), "flag_share": round(n_flag / watch, 4),
            "precision": None if fdr is None else round(1 - fdr, 4),
            "recall": None if recall is None else round(recall, 4),
            "recall_ratio": None if recall is None else round(float(recall / city_recall), 2),
            "fdr_ratio": None if fdr is None else round(float(fdr / city_fdr), 2),
        })
    for r in rows:
        r["under_served"] = bool(r["recall_ratio"] is not None and r["recall_ratio"] < 0.8)
        r["over_flagged"] = bool(r["fdr_ratio"] is not None and r["fdr_ratio"] > 1.25)
    return {"watch_list": watch, "city_recall": round(float(city_recall), 4), "city_precision": round(float(1 - city_fdr), 4),
            "districts": rows}


def fair_rerank(district: np.ndarray, s: np.ndarray, watch: int = 2000) -> np.ndarray:
    """Give each district watch-list slots in proportion to the cases the model itself expects
    there (the sum of its probabilities), then fill each district's slots in score order.
    No labels are used, so this can run on the live list. Returns a score whose top `watch`
    entries are the re-ranked list."""
    expected = pd.Series(s).groupby(district).sum()
    expected = expected[expected.index != 0]
    raw = watch * expected / expected.sum()
    slots = np.floor(raw).astype(int)
    for d in (raw - slots).sort_values(ascending=False).index[: watch - slots.sum()]:
        slots[d] += 1
    out = np.full(len(s), -1.0)
    for d, k in slots.items():
        idx = np.where(district == d)[0]
        top = idx[np.argsort(-s[idx])[:k]]
        out[top] = 1.0 + s[top]
    return np.where(out > 0, out, s - 1.0)
