"""Run the whole pipeline and write the console's data files to web/public/data/.

    uv run python -m firebreak.fetch_311   # once, about 2 minutes
    uv run python -m firebreak.dcad        # once, needs DCAD_ZIP
    uv run python -m firebreak.build       # about 4 minutes

Outputs (see docs/CONTRACT.md for every field):
    meta.json        as-of date, counts, model scores, contagion edges, assumptions, layout of the .bin files
    buildings.bin    one record per building, packed columns (Float32 position, Uint8 scores)
    events.bin       every property report in the last 24 months (position, day, kind)
    hotspots.json    the 400 buildings where stabilizing now prevents the most damage, with plans
"""

from __future__ import annotations

import json
import pickle
import sys
from pathlib import Path

import numpy as np
import pandas as pd

from . import geo, model, plan

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / "data" / "work"
OUT = ROOT / "web" / "public" / "data"
KIND_CODE = {"code": 0, "rental": 1, "tenant": 2, "construction": 3, "vacancy": 4, "nuisance": 5, "infra": 6}
EVAL_TRAIN = ["2024-01-01", "2024-07-01", "2025-01-01", "2025-07-01", "2026-01-01", "2026-04-01"]
EVAL_TEST = "2026-07-01"
EDGE_TESTS = ["2025-07-01", "2026-01-01", "2026-04-01", "2026-07-01"]


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def _pool_edges(w: model.World) -> dict:
    """Average each edge's contagion ratio over several cutoffs, weighted by exposed buildings."""
    runs = []
    for c in EDGE_TESTS:
        T = pd.Timestamp(c)
        runs.append(model.contagion(w, model.features(w, T), model.labels(w, T)))
    out = {}
    for name in runs[0]:
        rs = [r[name] for r in runs]
        n = sum(r["exposed_buildings"] for r in rs)
        r1 = sum(r["rate_exposed"] * r["exposed_buildings"] for r in rs) / n
        r0 = sum(r["rate_matched"] * r["exposed_buildings"] for r in rs) / n
        out[name] = {"edge": rs[0]["edge"], "exposed_buildings": n, "rate_exposed": round(r1, 4),
                     "rate_matched": round(r0, 4), "ratio": round(r1 / r0, 2),
                     "per_cutoff": {c: r["ratio"] for c, r in zip(EDGE_TESTS, rs)}}
    return out


def _u8(x: np.ndarray) -> np.ndarray:
    return np.clip(np.round(np.nan_to_num(x) * 255), 0, 255).astype(np.uint8)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    events = geo.load_events(ROOT / "data" / "raw" / "dallas_311.csv.gz")
    parcels = geo.place(pd.read_parquet(WORK / "parcels.parquet"), events)
    log("placed", len(parcels))
    w = model.world(parcels, events)
    today = events.t.max().normalize()

    log("evaluate")
    net_eval, base_eval, report, (Xt, yt, sn) = model.train(w, EVAL_TRAIN, EVAL_TEST)
    edges = _pool_edges(w)
    log(json.dumps(edges))

    log("train live model")
    live_cutoffs = EVAL_TRAIN + [EVAL_TEST, (today - model.HORIZON - pd.Timedelta(days=1)).strftime("%Y-%m-%d")]
    Xs, ys = [], []
    for c in live_cutoffs:
        T = pd.Timestamp(c)
        Xs.append(model.features(w, T)); ys.append(model.labels(w, T))
    X, y = pd.concat(Xs, ignore_index=True), np.concatenate(ys)
    net, base = model._fit(X[model.ALL], y), model._fit(X[model.BASE], y)
    pickle.dump({"net": net, "base": base}, open(WORK / "models.pkl", "wb"))

    Xn = model.features(w, today)
    risk = net.predict_proba(Xn[model.ALL])[:, 1]
    risk_base = base.predict_proba(Xn[model.BASE])[:, 1]
    lift_pts = np.clip(risk - risk_base, 0, None)

    log("firebreak value")
    broadcasters = np.where(Xn.own90.to_numpy() > 0)[0]
    cand = broadcasters[np.argsort(-risk[broadcasters])][:4000]
    fb = plan.firebreak_value(w, Xn, risk, net, cand)
    money = plan.dollars(parcels, risk, w.pxy, fb.idx.to_numpy(), fb.prevented_nearby.to_numpy())
    fb = pd.concat([fb.reset_index(drop=True), money], axis=1)
    fb["score"] = fb.exposure_usd
    top = fb.sort_values("score", ascending=False).head(400)

    buyers = plan.repeat_buyers(parcels, today)
    by_owner = parcels.groupby("owner_id").indices
    hotspots = []
    for r in top.itertuples():
        i = r.idx
        row = parcels.iloc[i].copy()
        for c in ("own90", "own365", "own_all", "nb50_30", "nb250_90", "infra250_180", "portfolio365", "portfolio_size"):
            row[c] = Xn[c].iat[i]
        row["neighbors_250"], row["exposure_usd"] = r.neighbors_250, r.exposure_usd
        kinds = events[(events.key == row.key) & events.property].kind.value_counts().to_dict()
        hotspots.append({
            "i": int(i), "parcel_id": row.parcel_id, "address": row.street.title(), "zip": row.zip,
            "lat": round(float(row.lat), 6), "lon": round(float(row.lon), 6),
            "asset_class": row.asset_class, "name": (row.property_name or "") if isinstance(row.property_name, str) else "",
            "building_type": row.building_type if isinstance(row.building_type, str) else "",
            "value": float(row.value), "year_built": None if pd.isna(row.year_built) else int(row.year_built),
            "sqft": None if pd.isna(row.sqft) else float(row.sqft), "units": None if pd.isna(row.units) else int(row.units),
            "tenants": int(row.tenants), "homestead": bool(row.homestead), "absentee": bool(row.absentee),
            "owner": {"id": row.owner_id, "label": row.owner_label, "buildings": int(row.portfolio_size),
                      "reports_elsewhere_365": int(row.portfolio365)},
            "risk": round(float(risk[i]), 4), "risk_base": round(float(risk_base[i]), 4),
            "history": {"last_90": int(row.own90), "last_365": int(row.own365), "all": int(row.own_all), "kinds": kinds},
            "block": {"reports_50m_30d": int(row.nb50_30), "reports_250m_90d": int(row.nb250_90),
                      "infra_250m_180d": int(row.infra250_180), "buildings_250m": int(r.neighbors_250)},
            "prevented_nearby": round(float(r.prevented_nearby), 3),
            "usd": {"neighbor_value": round(float(r.neighbor_value), -3), "spillover": round(float(r.spillover_usd), -1),
                    "rent_at_risk": round(float(r.rent_at_risk_usd), -1), "exposure": round(float(r.exposure_usd), -1)},
            "portfolio": [[round(float(parcels.lon.iat[j]), 5), round(float(parcels.lat.iat[j]), 5)]
                          for j in by_owner[row.owner_id][:60] if j != i],
            "plan": plan.response(row, buyers),
        })

    # buildings.bin: packed columns, all little-endian.
    n = len(parcels)
    T_eval = pd.Timestamp(EVAL_TEST)
    X_eval = model.features(w, T_eval)
    risk_eval = net_eval.predict_proba(X_eval[model.ALL])[:, 1]
    hit_eval = model.labels(w, T_eval).astype(np.uint8)
    cls = parcels.asset_class.map(model.CLASS_CODE).to_numpy().astype(np.uint8)
    cols = [
        ("lon", parcels.lon.to_numpy(np.float32)), ("lat", parcels.lat.to_numpy(np.float32)),
        ("value", parcels.value.to_numpy(np.float32)),
        ("risk", _u8(risk)), ("lift", _u8(lift_pts * 4)), ("risk_backtest", _u8(risk_eval)), ("hit_backtest", hit_eval),
        ("class", cls), ("reports_365", np.clip(Xn.own365.to_numpy(), 0, 255).astype(np.uint8)),
    ]
    layout, offset = [], 0
    with open(OUT / "buildings.bin", "wb") as f:
        for name, arr in cols:
            b = arr.astype(arr.dtype.newbyteorder("<")).tobytes()
            pad = (-offset) % 4
            f.write(b"\0" * pad); offset += pad
            layout.append({"name": name, "dtype": str(arr.dtype), "offset": offset, "length": n})
            f.write(b); offset += len(b)

    ev = events[events.t >= today - pd.Timedelta(days=730)]
    day = ((ev.t - (today - pd.Timedelta(days=730))).dt.days).to_numpy(np.uint16)
    ecols = [("lon", ev.lon.to_numpy(np.float32)), ("lat", ev.lat.to_numpy(np.float32)), ("day", day),
             ("kind", ev.kind.map(KIND_CODE).to_numpy(np.uint8))]
    elayout, offset = [], 0
    with open(OUT / "events.bin", "wb") as f:
        for name, arr in ecols:
            pad = (-offset) % 4
            f.write(b"\0" * pad); offset += pad
            elayout.append({"name": name, "dtype": str(arr.dtype), "offset": offset, "length": len(ev)})
            b = arr.tobytes(); f.write(b); offset += len(b)

    meta = {
        "as_of": today.strftime("%Y-%m-%d"), "horizon_days": model.HORIZON.days,
        "events_start": (today - pd.Timedelta(days=730)).strftime("%Y-%m-%d"),
        "backtest_cutoff": EVAL_TEST,
        "counts": {"buildings": n, "tenants": int(parcels.tenants.sum()), "reports": int(events.property.sum()),
                   "infra_failures": int((~events.property).sum()),
                   "by_class": parcels.asset_class.value_counts().to_dict(),
                   "placed_by": parcels.geo_method.value_counts().to_dict()},
        "model": report, "edges": edges, "assumptions": plan.ASSUMPTIONS,
        "classes": list(model.CLASS_CODE), "kinds": list(KIND_CODE),
        "buildings_layout": layout, "events_layout": elayout,
        "risk_scale": "uint8 / 255 = probability of a new report in 90 days",
        "lift_scale": "uint8 / 255 / 4 = probability points the network adds over the base model",
        "sources": {
            "dcad": "Dallas Central Appraisal District 2026 certified export, data as of 2026-09-15",
            "dallas_311": "Dallas Open Data 311 Service Requests (d7e7-envw), pulled " + today.strftime("%Y-%m-%d"),
        },
        "buyers": [{"name": b.name, "buys_2y": int(b.buys), "classes": b.classes} for b in buyers.head(25).itertuples()],
    }
    (OUT / "meta.json").write_text(json.dumps(meta, indent=1, default=str))
    (OUT / "hotspots.json").write_text(json.dumps(hotspots, default=str))
    log("done", {f.name: f.stat().st_size for f in OUT.iterdir()})


if __name__ == "__main__":
    main()
