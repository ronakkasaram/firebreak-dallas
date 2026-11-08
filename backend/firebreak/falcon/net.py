"""FALCON on Dallas: the ST-MotionNet ("Toya") predictor from the FALCON research, retrained on 311.

FALCON reconstructs a hidden signal field from sparse sensors and predicts how it moves. Dallas 311 has
the same shape: the "signal" is property distress, the sensors are fixed (buildings), and a reading only
arrives when somebody calls. So the city becomes a 256 x 256 grid (about 190 m cells) and each week is one
frame with FALCON's four-channel input contract, unchanged:

  1. observed signal: log(1 + new property reports in the cell that week)
  2. sensor mask: cells that contain buildings (fixed for all frames, the stationary-sensor setting)
  3. building map: log(1 + buildings in the cell), scaled to 0..1
  4. unknown-region mask: building cells with no report in the previous 12 weeks (blind spots)

The two Toya heads keep their roles:

  heatmap      -> expected new property reports in the next 90 days (log rate, Poisson loss)
  localization -> where a new hotspot ignites: a cell with no report in the last 90 days that gets
                  2 or more in the next 90 (FALCON's focal loss, alpha 0.75, gamma 3)

Training is honest about time. Every frame's target window must end on or before the backtest cutoff
(2026-07-01), the same cutoff the boosted model was frozen on. The test is the frame that ends on the
cutoff, scored on the 90 days after it, against three baselines at the same cell level: the boosted
model summed per cell, last year's report count per cell, and the last 90 days.

Run (needs jax, equinox, optax; the FALCON uv environment has them):
  ~/developer/falcon-stationary-sensors/.venv/bin/python -m firebreak.falcon.net   (from backend/)
Writes web/public/data/falcon.bin and falcon.json.
"""

from __future__ import annotations

import json
import math
import sys
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[3]
DATA = ROOT / "web" / "public" / "data"
G = 256
WEEK = 7
CHUNK = 13          # frames per truncated-BPTT chunk (state carries across chunks without gradient)
HORIZON = 90
BLIND_WEEKS = 12
PROPERTY_KINDS = (0, 1, 2, 4, 5)   # code, rental, tenant, vacancy, nuisance (construction unused, infra excluded)


def read_cols(path: Path, layout: list[dict]) -> dict[str, np.ndarray]:
    buf = path.read_bytes()
    return {c["name"]: np.frombuffer(buf, dtype=np.dtype(c["dtype"]).newbyteorder("<"), count=c["length"], offset=c["offset"])
            for c in layout}


def grid_of(lon, lat, box):
    x0, y0, step = box
    gx = np.floor((lon - x0) / step[0]).astype(np.int64)
    gy = np.floor((y0 - lat) / step[1]).astype(np.int64)     # row 0 = north
    ok = (gx >= 0) & (gx < G) & (gy >= 0) & (gy < G)
    return gy, gx, ok


def build_frames():
    meta = json.loads((DATA / "meta.json").read_text())
    b = read_cols(DATA / "buildings.bin", meta["buildings_layout"])
    e = read_cols(DATA / "events.bin", meta["events_layout"])
    lon, lat = b["lon"].astype(np.float64), b["lat"].astype(np.float64)
    # Square cells in metres over the 0.2-99.8 percentile extent of the buildings.
    lo_x, hi_x = np.percentile(lon, [0.2, 99.8]); lo_y, hi_y = np.percentile(lat, [0.2, 99.8])
    mid = math.radians((lo_y + hi_y) / 2)
    span_m = max((hi_x - lo_x) * 111320 * math.cos(mid), (hi_y - lo_y) * 110540)
    cell_m = span_m / G
    step = (cell_m / (111320 * math.cos(mid)), cell_m / 110540)
    cx, cy = (lo_x + hi_x) / 2, (lo_y + hi_y) / 2
    box = (cx - step[0] * G / 2, cy + step[1] * G / 2, step)

    by, bx, bok = grid_of(lon, lat, box)
    bcount = np.zeros((G, G), np.float32)
    np.add.at(bcount, (by[bok], bx[bok]), 1)
    sensor = (bcount > 0).astype(np.float32)
    bmap = np.log1p(bcount) / np.log1p(bcount).max()

    from datetime import date
    d0 = date.fromisoformat(meta["events_start"])
    cutoff = (date.fromisoformat(meta["backtest_cutoff"]) - d0).days
    today = (date.fromisoformat(meta["as_of"]) - d0).days
    # Weeks aligned so one frame ends exactly on the cutoff; the last frame runs to today.
    first_end = cutoff - WEEK * (cutoff // WEEK) + WEEK
    ends = list(range(first_end, today + 1, WEEK))
    if ends[-1] != today:
        ends.append(today)          # a short last frame, so the forecast starts from today

    prop = np.isin(e["kind"], PROPERTY_KINDS) & (e["new_case"] == 1)
    ey, ex, eok = grid_of(e["lon"].astype(np.float64), e["lat"].astype(np.float64), box)
    keep = prop & eok
    ey, ex, eday = ey[keep], ex[keep], e["day"][keep].astype(np.int64)
    daily = np.zeros((today + HORIZON + 1, G, G), np.uint16)   # days after today stay zero (unknown)
    np.add.at(daily, (eday, ey, ex), 1)
    cum = np.concatenate([np.zeros((1, G, G), np.int32), np.cumsum(daily, axis=0, dtype=np.int32)])

    def window(a, z):  # reports on days [a, z)
        a, z = max(a, 0), min(z, today + 1)
        return (cum[z] - cum[a]).astype(np.float32)

    T = len(ends)
    x = np.zeros((T, 4, G, G), np.float32)
    heat = np.zeros((T, 1, G, G), np.float32)
    ignite = np.zeros((T, 1, G, G), np.float32)
    prev = ends[0] - WEEK
    for t, z in enumerate(ends):
        wk = window(prev, z); prev = z
        x[t, 0] = np.log1p(wk) * sensor
        x[t, 1] = sensor
        x[t, 2] = bmap
        x[t, 3] = sensor * (window(z - BLIND_WEEKS * WEEK, z) == 0)
        fut = window(z, z + HORIZON)
        heat[t, 0] = fut
        ignite[t, 0] = sensor * (window(z - HORIZON, z) == 0) * (fut >= 2)
    info = dict(meta=meta, b=b, box=box, cell_m=cell_m, ends=ends, cutoff=cutoff, today=today, sensor=sensor,
                bcount=bcount, window=window, by=by, bx=bx, bok=bok)
    return x, heat, ignite, info


def train(x, heat, ignite, info, epochs=30, width=32, layers=2, seed=7):
    import jax
    import jax.numpy as jnp
    import equinox as eqx
    import optax
    from .toya import Toya

    ends, cutoff = info["ends"], info["cutoff"]
    k_test = ends.index(cutoff)
    # Supervise only frames whose 90-day target ends on or before the cutoff. Hold the last 8 of those
    # frames out to pick the epoch.
    sup = np.array([z + HORIZON <= cutoff for z in ends])
    n_sup = int(sup.sum())
    val = np.zeros(len(ends), bool); val[n_sup - 8:n_sup] = True
    trn = sup & ~val
    mask = jnp.asarray(info["sensor"])[None]

    model = Toya(4, width, 1, 3, 1, 1, layers, 8, 0.1, jax.random.PRNGKey(seed))
    total = epochs * math.ceil(len(ends) / CHUNK)
    sched = optax.warmup_cosine_decay_schedule(0.0, 1e-3, max(1, min(30, total // 5)), total, 1e-5)
    opt = optax.chain(optax.clip_by_global_norm(1.0), optax.adamw(sched, weight_decay=1e-4))
    params, static = eqx.partition(model, eqx.is_array)
    state0 = model.getInitState()
    opt_state = opt.init(params)

    def focal(logits, y, alpha=0.75, gamma=3.0):        # FALCON's localization loss
        log_p, log_not_p = jax.nn.log_sigmoid(logits), jax.nn.log_sigmoid(-logits)
        pos = -y * alpha * jnp.exp(gamma * log_not_p) * log_p
        neg = -(1 - y) * (1 - alpha) * jnp.exp(gamma * log_p) * log_not_p
        return pos + neg

    def loss_fn(p, xs, hs, gs, w, state, key):
        m = eqx.combine(p, static)
        (logr, loc), new_state = m(xs, state, key=key)
        rate = jnp.exp(jnp.clip(logr, -12, 6))
        pois = (rate - hs * logr) * mask                   # Poisson NLL up to a constant
        fl = focal(loc, gs) * mask
        per = pois.sum(axis=(1, 2, 3)) / mask.sum() + 20.0 * fl.sum(axis=(1, 2, 3)) / mask.sum()
        return (per * w).sum() / jnp.maximum(w.sum(), 1.0), new_state

    @eqx.filter_jit
    def step(p, o, xs, hs, gs, w, state, key):
        (l, ns), g = jax.value_and_grad(loss_fn, has_aux=True)(p, xs, hs, gs, w, state, key)
        upd, o = opt.update(g, o, p)
        return optax.apply_updates(p, upd), o, jax.lax.stop_gradient(ns), l

    @eqx.filter_jit
    def run(p, xs, state):
        (logr, loc), ns = eqx.combine(p, static)(xs, state)
        return logr, loc, ns

    def forward(p, upto):
        """Run the whole sequence with no gradient; returns per-frame log rates and ignition logits."""
        st, outs, outl = state0, [], []
        for a in range(0, upto, CHUNK):
            z = min(a + CHUNK, upto)
            xs = jnp.asarray(_pad(x[a:z]))
            lr, lc, st = run(p, xs, st)
            outs.append(np.asarray(lr[: z - a, 0])); outl.append(np.asarray(lc[: z - a, 0]))
        return np.concatenate(outs), np.concatenate(outl)

    def _pad(a):
        return a if len(a) == CHUNK else np.concatenate([a, np.zeros((CHUNK - len(a),) + a.shape[1:], a.dtype)])

    best, best_p, log = 1e9, params, []
    key = jax.random.PRNGKey(seed + 1)
    last_sup = int(np.nonzero(sup)[0].max()) + 1
    for ep in range(epochs):
        t0, st, tot = time.time(), state0, 0.0
        for a in range(0, last_sup, CHUNK):
            z = min(a + CHUNK, last_sup)
            w = np.zeros(CHUNK, np.float32); w[: z - a] = trn[a:z]
            key, sk = jax.random.split(key)
            params, opt_state, st, l = step(params, opt_state, jnp.asarray(_pad(x[a:z])), jnp.asarray(_pad(heat[a:z])),
                                            jnp.asarray(_pad(ignite[a:z])), jnp.asarray(w), st, sk)
            tot += float(l)
        lr, _ = forward(params, last_sup)
        vi = np.nonzero(val[:last_sup])[0]
        r = np.exp(np.clip(lr[vi], -12, 6)); h = heat[vi, 0]; s = info["sensor"]
        vloss = float(((r - h * np.log(r)) * s).sum() / (len(vi) * s.sum()))
        log.append(dict(epoch=ep + 1, train=round(tot, 4), val_poisson=round(vloss, 5), sec=round(time.time() - t0, 1)))
        print(log[-1], flush=True)
        if vloss < best:
            best, best_p = vloss, params
    lr, lc = forward(best_p, len(ends))
    return lr, lc, log, dict(width=width, layers=layers, epochs=epochs, frames=len(ends), train_frames=int(trn.sum()),
                             val_frames=int(val.sum()), test_frame=k_test, best_val_poisson=round(best, 5))


def capture(score, truth, sensor, frac):
    """Share of next-90-day reports that fall in the top `frac` of building cells by score."""
    idx = np.nonzero(sensor.ravel())[0]
    k = max(1, int(round(frac * len(idx))))
    s = score.ravel()[idx] + 1e-9 * np.random.default_rng(0).random(len(idx))
    top = idx[np.argsort(-s)[:k]]
    return float(truth.ravel()[top].sum() / max(truth.ravel()[idx].sum(), 1))


def precision_at(score, y, cand, k):
    idx = np.nonzero(cand.ravel())[0]
    s = score.ravel()[idx] + 1e-9 * np.random.default_rng(0).random(len(idx))
    top = idx[np.argsort(-s)[:k]]
    return float(y.ravel()[top].mean()), float(y.ravel()[idx].mean())


def crew_search(value, starts, steps, look=4, seed=0):
    """FALCON's search half with a greedy policy: K crews walk the grid one cell per step (8 neighbours),
    each step moving to the neighbour with the most unvisited value nearby (the cell itself plus the
    best cell within `look` cells, discounted 0.6 per cell of distance), or toward the best remaining cell when nothing is in sight. A visited
    cell's value drops to zero, so crews spread out instead of stacking: the same team reward VDN
    optimises, chosen greedily instead of learned."""
    from scipy.ndimage import maximum_filter
    V = value.astype(np.float64).copy()
    pos = [tuple(p) for p in starts]
    seen = set(pos)
    for p in pos: V[p] = 0
    moves = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
    rng = np.random.default_rng(seed)
    for _ in range(steps):
        # Best unvisited value within d cells, discounted 0.6 per cell of distance, so nearer belief pulls harder.
        M = np.max([maximum_filter(V, size=2 * d + 1, mode="constant") * 0.6 ** d for d in range(1, look + 1)], axis=0)
        for a, (r, c) in enumerate(pos):
            best, bv = None, -1.0
            for dr, dc in moves:
                rr, cc = r + dr, c + dc
                if 0 <= rr < G and 0 <= cc < G:
                    v = V[rr, cc] + M[rr, cc] + 1e-9 * rng.random()
                    if v > bv:
                        best, bv = (rr, cc), v
            if bv < 1e-6:                    # nothing within sight: head for the best remaining cell
                tr, tc = np.unravel_index(int(np.argmax(V)), V.shape)
                best = (r + int(np.sign(tr - r)), c + int(np.sign(tc - c)))
            pos[a] = best
            seen.add(best)
            V[best] = 0
    return seen


def search_eval(scores, truth, ign, sensor, crews=4, steps=150):
    """Backtest the crews: which cells do they inspect on the day after the cutoff, and how much of what
    happens next (reports, new ignitions) sits in those cells? Starts are the four quadrant centres of the
    building cells, the same for every policy."""
    ys, xs = np.nonzero(sensor)
    cy, cx = int(np.median(ys)), int(np.median(xs))
    starts = [(cy - 40, cx - 40), (cy - 40, cx + 40), (cy + 40, cx - 40), (cy + 40, cx + 40)][:crews]
    out = {"crews": crews, "steps_per_crew": steps, "starts": starts}
    for name, v in scores.items():
        seen = crew_search(v * sensor, starts, steps)
        rr = np.array([p[0] for p in seen]); cc = np.array([p[1] for p in seen])
        out[name] = {"cells": len(seen), "reports_found": int(truth[rr, cc].sum()), "ignitions_found": int(ign[rr, cc].sum())}
    rng = np.random.default_rng(1)
    walk = set()
    for (r, c) in starts:
        for _ in range(steps):
            r = int(np.clip(r + rng.integers(-1, 2), 0, G - 1)); c = int(np.clip(c + rng.integers(-1, 2), 0, G - 1)); walk.add((r, c))
    rr = np.array([p[0] for p in walk]); cc = np.array([p[1] for p in walk])
    out["random_walk"] = {"cells": len(walk), "reports_found": int(truth[rr, cc].sum()), "ignitions_found": int(ign[rr, cc].sum())}
    return out


def evaluate(lr, lc, heat, ignite, info):
    b, w, cutoff, s = info["b"], info["window"], info["cutoff"], info["sensor"]
    k = info["ends"].index(cutoff)
    truth, ign = heat[k, 0], ignite[k, 0]
    by, bx, ok = info["by"], info["bx"], info["bok"]
    gbm = np.zeros((G, G), np.float32)
    np.add.at(gbm, (by[ok], bx[ok]), b["risk_backtest"][ok].astype(np.float32) / 255)
    rankers = {
        "falcon": lr[k],
        "boosted_sum": gbm,
        "last_365_days": w(cutoff - 365, cutoff),
        "last_90_days": w(cutoff - 90, cutoff),
    }
    out = {"cells_with_buildings": int(s.sum()), "reports_next_90": int(truth.sum())}
    for frac in (0.01, 0.05):
        out[f"capture_top_{int(frac * 100)}pct"] = {n: round(capture(v, truth, s, frac), 4) for n, v in rankers.items()}
    # Ignition: among cells with no report in the 90 days before the cutoff, which get 2+ after it?
    cand = s * (w(cutoff - 90, cutoff) == 0)
    ign_rank = {"falcon": lc[k], "boosted_sum": gbm, "last_365_days": w(cutoff - 365, cutoff), "buildings": info["bcount"]}
    out["ignition"] = {"candidates": int(cand.sum()), "ignited": int((ign * cand).sum())}
    for kk in (100, 500):
        out["ignition"][f"precision_top_{kk}"] = {n: round(precision_at(v, ign, cand, kk)[0], 4) for n, v in ign_rank.items()}
    out["ignition"]["base_rate"] = round(precision_at(lc[k], ign, cand, 1)[1], 4)
    # Crews hunting for new ignitions: FALCON's belief (ignition chance x expected reports) against
    # patrolling last year's busiest cells and the boosted model.
    p_ign = 1 / (1 + np.exp(-lc[k]))
    out["crew_search"] = search_eval({"falcon": p_ign * cand + 1e-3 * np.exp(np.clip(lr[k], -12, 6)),
                                      "boosted_sum": gbm, "last_365_days": w(cutoff - 365, cutoff)},
                                     truth, ign * cand, s)
    np.savez_compressed(Path(__file__).with_name("test_frame.npz"), lograte=lr[k], ignite_logit=lc[k], truth=truth, ignite=ign)
    return out


def export(lr, lc, info, evalres, log, cfg):
    k = len(info["ends"]) - 1
    rate = np.exp(np.clip(lr[k], -12, 6)) * info["sensor"]
    ign = 1 / (1 + np.exp(-lc[k])) * info["sensor"] * (info["window"](info["today"] - 90, info["today"]) == 0)
    # Blind spots: building cells the network expects to report, where nobody has called in 12 weeks.
    blind = info["sensor"] * (info["window"](info["today"] - BLIND_WEEKS * WEEK, info["today"] + 1) == 0)
    q = lambda a, scale: np.clip(np.round(a / scale), 0, 65535).astype("<u2")
    r_scale = float(max(rate.max(), 1e-6) / 65535)
    i_scale = float(max(ign.max(), 1e-6) / 65535)
    body = q(rate, r_scale).tobytes() + q(ign, i_scale).tobytes() + blind.astype(np.uint8).tobytes()
    (DATA / "falcon.bin").write_bytes(body)
    x0, y0, step = info["box"]
    js = {
        "grid": G, "cell_m": round(info["cell_m"], 1), "west": x0, "north": y0, "dlon": step[0], "dlat": step[1],
        "layout": [{"name": "rate", "dtype": "uint16", "scale": r_scale, "offset": 0},
                   {"name": "ignite", "dtype": "uint16", "scale": i_scale, "offset": 2 * G * G},
                   {"name": "blind", "dtype": "uint8", "offset": 4 * G * G}],
        "as_of": info["meta"]["as_of"], "cutoff": info["meta"]["backtest_cutoff"],
        "expected_reports_90d": round(float(rate.sum()), 1),
        "model": cfg, "training_log": log, "backtest": evalres,
        "inputs": ["log(1 + new property reports that week)", "sensor mask (cells with buildings)",
                   "building map", "unknown region (no report in 12 weeks)"],
        "source": "FALCON ST-MotionNet (Toya) predictor, retrained on Dallas 311 weekly frames",
    }
    (DATA / "falcon.json").write_text(json.dumps(js, indent=1))
    print(json.dumps(evalres, indent=1))


def rescore_search():
    """Re-run only the crew-search backtest from the saved test frame (no retraining) and patch falcon.json."""
    x, heat, ignite, info = build_frames()
    t = np.load(Path(__file__).with_name("test_frame.npz"))
    b, w, cutoff, s = info["b"], info["window"], info["cutoff"], info["sensor"]
    by, bx, ok = info["by"], info["bx"], info["bok"]
    gbm = np.zeros((G, G), np.float32)
    np.add.at(gbm, (by[ok], bx[ok]), b["risk_backtest"][ok].astype(np.float32) / 255)
    cand = s * (w(cutoff - 90, cutoff) == 0)
    p_ign = 1 / (1 + np.exp(-t["ignite_logit"]))
    res = search_eval({"falcon": p_ign * cand + 1e-3 * np.exp(np.clip(t["lograte"], -12, 6)), "boosted_sum": gbm,
                       "last_365_days": w(cutoff - 365, cutoff)}, t["truth"], t["ignite"] * cand, s)
    js = json.loads((DATA / "falcon.json").read_text())
    js["backtest"]["crew_search"] = res
    (DATA / "falcon.json").write_text(json.dumps(js, indent=1))
    print(json.dumps(res, indent=1))


if __name__ == "__main__" and sys.argv[1:2] == ["rescore"]:
    rescore_search()
elif __name__ == "__main__":
    x, heat, ignite, info = build_frames()
    print("frames", x.shape, "cell_m", round(info["cell_m"], 1), "test frame ends", info["cutoff"], flush=True)
    lr, lc, log, cfg = train(x, heat, ignite, info, epochs=int(sys.argv[1]) if len(sys.argv) > 1 else 30)
    res = evaluate(lr, lc, heat, ignite, info)
    export(lr, lc, info, res, log, cfg)
