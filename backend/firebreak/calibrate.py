"""Risk you can hold us to: calibrated intervals per house and a watch list with a stated error rate.

1. Venn-Abers intervals (Vovk & Petej 2014, inductive Venn-Abers predictors). For a house with
   score s, fit isotonic regression on the calibration scores plus (s, 0), and again plus (s, 1).
   The two fitted values at s give [p0, p1]: one of them is a perfectly calibrated probability,
   under exchangeability. The point estimate is p1 / (1 - p0 + p1). The width says how much the
   calibration data can vouch for this score: narrow in the crowd, wide at the extremes.

2. Conformal selection (Jin & Candes 2023, JMLR, "Selection by prediction with conformal
   p-values"). Each house gets a conformal p-value against calibration houses that did *not* get a
   report; Benjamini-Hochberg at level q then picks a watch list whose false discovery rate is at
   most q. Mondrian version: calibrate and select within each council district, so the guarantee
   holds district by district.

Time breaks exchangeability (2026 is not 2025), so every guarantee here is tested on a later,
held-out cutoff and the realised rates are shown next to the promised ones.
"""

from __future__ import annotations

import numpy as np
from sklearn.isotonic import IsotonicRegression

GRID = 512


def _binned(s: np.ndarray, y: np.ndarray, bins: int = 2000):
    """Collapse calibration data to weighted score bins so isotonic fits are fast."""
    q = np.unique(np.quantile(s, np.linspace(0, 1, bins + 1)))
    k = np.clip(np.searchsorted(q, s, side="right") - 1, 0, len(q) - 2)
    w = np.bincount(k, minlength=len(q) - 1).astype(float)
    pos = np.bincount(k, weights=y, minlength=len(q) - 1)
    mean_s = np.bincount(k, weights=s, minlength=len(q) - 1)
    keep = w > 0
    return mean_s[keep] / w[keep], pos[keep] / w[keep], w[keep]


def venn_abers(s_cal: np.ndarray, y_cal: np.ndarray, s_test: np.ndarray):
    """[p0, p1] and the merged probability for every test score (computed on a score grid,
    then interpolated)."""
    xs, ys, ws = _binned(s_cal, y_cal.astype(float))
    grid = np.unique(np.quantile(s_test, np.linspace(0, 1, GRID)))
    p0, p1 = np.empty(len(grid)), np.empty(len(grid))
    for j, g in enumerate(grid):
        for lab, out in ((0.0, p0), (1.0, p1)):
            iso = IsotonicRegression(out_of_bounds="clip", y_min=0, y_max=1)
            iso.fit(np.append(xs, g), np.append(ys, lab), sample_weight=np.append(ws, 1.0))
            out[j] = iso.predict([g])[0]
    lo = np.interp(s_test, grid, p0)
    hi = np.interp(s_test, grid, p1)
    return lo, hi, hi / (1 - lo + hi)


def conformal_pvalues(s_cal: np.ndarray, y_cal: np.ndarray, s_test: np.ndarray) -> np.ndarray:
    """p_j = (1 + #{calibration i: y_i = 0 and s_i >= s_j}) / (n + 1)."""
    null = np.sort(s_cal[y_cal == 0])
    ge = len(null) - np.searchsorted(null, s_test, side="left")
    return (1 + ge) / (len(s_cal) + 1)


def bh(p: np.ndarray, q: float) -> np.ndarray:
    """Benjamini-Hochberg: boolean mask of selected hypotheses."""
    n = len(p)
    order = np.argsort(p)
    ok = p[order] <= q * np.arange(1, n + 1) / n
    sel = np.zeros(n, bool)
    if ok.any():
        sel[order[: np.flatnonzero(ok).max() + 1]] = True
    return sel


def select(s_cal, y_cal, s_test, q: float, groups_cal=None, groups_test=None) -> np.ndarray:
    if groups_cal is None:
        return bh(conformal_pvalues(s_cal, y_cal, s_test), q)
    sel = np.zeros(len(s_test), bool)
    for g in np.unique(groups_test):
        mt, mc = groups_test == g, groups_cal == g
        if mc.sum() >= 50:
            sel[mt] = bh(conformal_pvalues(s_cal[mc], y_cal[mc], s_test[mt]), q)
    return sel


def evaluate(s_cal, y_cal, s_test, y_test, d_cal, d_test, qs=(0.1, 0.2, 0.3)) -> dict:
    """Promise vs. reality on a held-out cutoff."""
    lo, hi, p = venn_abers(s_cal, y_cal, s_test)
    # Calibration of the merged probability, in deciles of predicted risk.
    order = np.argsort(p)
    deciles = []
    for part in np.array_split(order, 10):
        deciles.append({"predicted": round(float(p[part].mean()), 4), "observed": round(float(y_test[part].mean()), 4),
                        "lo": round(float(lo[part].mean()), 4), "hi": round(float(hi[part].mean()), 4)})
    sel = {}
    for q in qs:
        for name, (gc, gt) in {"city": (None, None), "by_district": (d_cal, d_test)}.items():
            m = select(s_cal, y_cal, s_test, q, gc, gt)
            fdr = float(1 - y_test[m].mean()) if m.any() else 0.0
            row = {"q": q, "selected": int(m.sum()), "realised_fdr": round(fdr, 4), "cases_caught": int(y_test[m].sum())}
            if gt is not None:
                worst = max((float(1 - y_test[m & (gt == g)].mean()) for g in np.unique(gt) if (m & (gt == g)).sum() >= 10),
                            default=0.0)
                row["worst_district_fdr"] = round(worst, 4)
            sel[f"{name}_q{int(q * 100)}"] = row
    width = hi - lo
    return {"deciles": deciles, "median_width": round(float(np.median(width)), 4),
            "width_top_2000": round(float(np.median(width[np.argsort(-s_test)[:2000]])), 4),
            "brier_raw": round(float(np.mean((s_test - y_test) ** 2)), 5),
            "brier_venn_abers": round(float(np.mean((p - y_test) ** 2)), 5),
            "selection": sel}
