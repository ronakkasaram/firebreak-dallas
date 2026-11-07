"""The contagion model: will this building get a new distress report in the next 90 days?

Distress here means a 311 report about the property itself: code violations, unregistered
rentals, tenant complaints, vacancy and nuisance reports (geo.PROPERTY_TYPES).

Every feature is computed as of a cutoff date T, using only reports before T. The label is a
new property report at the building in [T, T + 90 days). Two models are trained on the same rows:

- base: the building's own history plus its DCAD record (age, value, owner type, condition).
  This is what a single property manager can see.
- network: base plus the hidden dependencies, which live in different systems:
  * nb100 / nb250: reports at other buildings within 100 m and 250 m (the block),
  * infra250: water main breaks, sewer, storm drain, street and signal failures within 250 m,
  * portfolio: reports at the owner's other buildings anywhere in Dallas (DCAD owner links),
  * tenants: business tenants at the address (DCAD business personal property accounts).

The gap between the two on a later, held-out period is the measured value of connecting the data.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
from scipy.spatial import cKDTree
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import average_precision_score, roc_auc_score

from .geo import xy

HORIZON = pd.Timedelta(days=90)
CLASS_CODE = {"home": 0, "multifamily": 1, "commercial": 2, "industrial": 3}
COND = {"UNSOUND": 0, "VERY POOR": 1, "POOR": 2, "FAIR": 3, "AVERAGE": 4, "GOOD": 5, "VERY GOOD": 6, "EXCELLENT": 7}

BASE = ["own90", "own365", "own_all", "days_since_own", "asset_class", "log_value", "value_change", "year_built",
        "condition", "depreciation", "absentee", "out_of_state", "entity", "homestead", "years_owned", "log_sqft"]
NETWORK = ["nb50_30", "nb50_90", "nb100_90", "nb100_365", "nb250_90", "nb250_365", "nb_accel", "infra250_180", "portfolio365",
           "portfolio_size", "tenants"]
ALL = BASE + NETWORK


@dataclass
class World:
    parcels: pd.DataFrame
    events: pd.DataFrame          # all events, sorted by time
    pxy: np.ndarray
    prop_t: np.ndarray            # property events: time as int64 ns
    prop_xy: np.ndarray
    prop_key: np.ndarray
    infra_t: np.ndarray
    infra_xy: np.ndarray
    key_index: dict


def _ns(t: pd.Series) -> np.ndarray:
    return t.values.astype("datetime64[ns]").astype("int64")


def world(parcels: pd.DataFrame, events: pd.DataFrame) -> World:
    events = events.sort_values("t").reset_index(drop=True)
    prop = events[events.property]
    infra = events[~events.property]
    return World(parcels=parcels, events=events, pxy=xy(parcels.lat, parcels.lon),
                 prop_t=_ns(prop.t), prop_xy=xy(prop.lat, prop.lon), prop_key=prop.key.to_numpy(),
                 infra_t=_ns(infra.t), infra_xy=xy(infra.lat, infra.lon),
                 key_index={k: i for i, k in enumerate(parcels.key)})


def _window(ts: np.ndarray, start: pd.Timestamp, end: pd.Timestamp) -> slice:
    return slice(np.searchsorted(ts, start.value), np.searchsorted(ts, end.value))


def _near(points: np.ndarray, centers: np.ndarray, r: float) -> np.ndarray:
    if len(points) == 0:
        return np.zeros(len(centers))
    return cKDTree(points).query_ball_point(centers, r, return_length=True).astype(float)


def _own(w: World, s: slice) -> np.ndarray:
    counts = np.zeros(len(w.parcels))
    for k in w.prop_key[s]:
        i = w.key_index.get(k)
        if i is not None:
            counts[i] += 1
    return counts


def features(w: World, T: pd.Timestamp) -> pd.DataFrame:
    p = w.parcels
    d90, d180, d365 = (pd.Timedelta(days=n) for n in (90, 180, 365))
    s90, s365 = _window(w.prop_t, T - d90, T), _window(w.prop_t, T - d365, T)
    s_all = _window(w.prop_t, pd.Timestamp("2000-01-01"), T)
    own90, own365, own_all = _own(w, s90), _own(w, s365), _own(w, s_all)

    # Days since the building's last report before T.
    last = np.full(len(p), np.nan)
    keys, ts = w.prop_key[s_all], w.prop_t[s_all]
    for k, t in zip(keys, ts):
        i = w.key_index.get(k)
        if i is not None:
            last[i] = t
    days_since = np.where(np.isnan(last), 3000, (T.value - last) / 86_400e9)

    f = pd.DataFrame(index=p.index)
    f["own90"], f["own365"], f["own_all"], f["days_since_own"] = own90, own365, own_all, days_since
    f["asset_class"] = p.asset_class.map(CLASS_CODE)
    f["log_value"] = np.log1p(p.value)
    f["value_change"] = np.where(p.prev_value > 0, p.value / p.prev_value.replace(0, np.nan), 1.0)
    f["year_built"] = p.year_built
    f["condition"] = p.condition.map(COND)
    f["depreciation"] = p.depreciation
    f["absentee"], f["out_of_state"] = p.absentee.astype(int), p.owner_out_of_state.astype(int)
    f["entity"], f["homestead"] = p.owner_is_entity.astype(int), p.homestead.astype(int)
    yrs = (T - p.deed_date).dt.days / 365.25
    f["years_owned"] = yrs.where(yrs >= 0)  # a sale after T is unknown at T
    f["log_sqft"] = np.log1p(p.sqft)

    s30 = _window(w.prop_t, T - pd.Timedelta(days=30), T)
    own30 = _own(w, s30)
    f["nb50_30"] = _near(w.prop_xy[s30], w.pxy, 50) - own30
    f["nb50_90"] = _near(w.prop_xy[s90], w.pxy, 50) - own90
    f["nb100_90"] = _near(w.prop_xy[s90], w.pxy, 100) - own90
    f["nb100_365"] = _near(w.prop_xy[s365], w.pxy, 100) - own365
    f["nb250_90"] = _near(w.prop_xy[s90], w.pxy, 250) - own90
    f["nb250_365"] = _near(w.prop_xy[s365], w.pxy, 250) - own365
    nb = ["nb50_30", "nb50_90", "nb100_90", "nb100_365", "nb250_90", "nb250_365"]
    f[nb] = f[nb].clip(lower=0)
    f["nb_accel"] = (f.nb250_90 + 1) / (f.nb250_365 / 4 + 1)
    f["infra250_180"] = _near(w.infra_xy[_window(w.infra_t, T - d180, T)], w.pxy, 250)

    by_owner = pd.Series(own365).groupby(p.owner_id.values).transform("sum").to_numpy()
    f["portfolio365"] = by_owner - own365
    f["portfolio_size"] = p.groupby("owner_id").parcel_id.transform("size").to_numpy()
    f["tenants"] = p.tenants.to_numpy()
    return f


def labels(w: World, T: pd.Timestamp) -> np.ndarray:
    return (_own(w, _window(w.prop_t, T, T + HORIZON)) > 0).astype(int)


def _fit(X: pd.DataFrame, y: np.ndarray) -> HistGradientBoostingClassifier:
    m = HistGradientBoostingClassifier(max_iter=300, learning_rate=0.08, max_leaf_nodes=63, min_samples_leaf=200,
                                       l2_regularization=1.0, random_state=7)
    return m.fit(X, y)


def _metrics(y: np.ndarray, s: np.ndarray, watch: int) -> dict:
    order = np.argsort(-s)
    top = order[:watch]
    base_rate = y.mean()
    return {
        "auc": round(float(roc_auc_score(y, s)), 4),
        "avg_precision": round(float(average_precision_score(y, s)), 4),
        "watch_list": watch,
        "watch_precision": round(float(y[top].mean()), 4),
        "watch_lift": round(float(y[top].mean() / base_rate), 2),
        "cases_caught": int(y[top].sum()),
        "base_rate": round(float(base_rate), 4),
    }


def train(w: World, train_cutoffs: list[str], test_cutoff: str, watch: int = 2000):
    Xs, ys = [], []
    for c in train_cutoffs:
        T = pd.Timestamp(c)
        Xs.append(features(w, T)); ys.append(labels(w, T))
    X, y = pd.concat(Xs, ignore_index=True), np.concatenate(ys)
    T_test = pd.Timestamp(test_cutoff)
    Xt, yt = features(w, T_test), labels(w, T_test)

    base = _fit(X[BASE], y)
    net = _fit(X[ALL], y)
    sb, sn = base.predict_proba(Xt[BASE])[:, 1], net.predict_proba(Xt[ALL])[:, 1]

    # Which kinds of buildings does the network model catch that the base model misses?
    tb, tn = set(np.argsort(-sb)[:watch]), set(np.argsort(-sn)[:watch])
    only_net = np.array(sorted(tn - tb))
    first_time = int(((Xt.own_all.to_numpy()[only_net] == 0) & (yt[only_net] == 1)).sum()) if len(only_net) else 0

    report = {
        "train_cutoffs": train_cutoffs, "test_cutoff": test_cutoff, "horizon_days": HORIZON.days,
        "train_rows": int(len(y)), "test_rows": int(len(yt)), "test_positives": int(yt.sum()),
        "base": _metrics(yt, sb, watch), "network": _metrics(yt, sn, watch),
        "network_only_first_time_cases": first_time,
        "by_class": {},
    }
    for name, code in CLASS_CODE.items():
        mask = (Xt.asset_class == code).to_numpy()
        if yt[mask].sum() >= 20 and yt[mask].sum() < mask.sum():
            k = max(50, int(watch * mask.mean()))
            report["by_class"][name] = {"base": _metrics(yt[mask], sb[mask], k), "network": _metrics(yt[mask], sn[mask], k)}
    return net, base, report, (Xt, yt, sn)


def contagion(w: World, X: pd.DataFrame, y: np.ndarray) -> dict:
    """Measure each hidden edge directly on buildings with no report history.

    For one edge (say, a report next door in the last 30 days), compare the first-report rate of
    exposed buildings with unexposed buildings in the same ZIP, value decile and asset class,
    weighted to the exposed group's mix. A ratio above 1 means trouble travels along that edge.
    """
    p = w.parcels
    fresh = X.own_all.to_numpy() == 0
    d = pd.DataFrame({"y": y, "zip": p.zip.to_numpy(), "c": X.asset_class.to_numpy(),
                      "vd": pd.qcut(X.log_value.rank(method="first"), 10, labels=False)})[fresh]
    edges = {
        "block": ("A report within 50 m in the last 30 days", X.nb50_30.to_numpy()[fresh] > 0),
        "owner": ("The same owner had a report at another building in the last year",
                  (X.portfolio365.to_numpy()[fresh] > 0)),
        "infrastructure": ("A water, sewer, street or signal failure within 250 m in the last 180 days",
                           X.infra250_180.to_numpy()[fresh] > 0),
    }
    out = {}
    for name, (desc, exposed) in edges.items():
        dd = d.assign(exp=exposed)
        if name == "owner":  # compare only against other multi-building owners
            dd = dd[(X.portfolio_size.to_numpy()[fresh] > 1)]
        g = dd.groupby(["zip", "vd", "c", "exp"]).y.agg(["sum", "count"]).unstack("exp").dropna()
        g = g[g[("count", True)] >= 5]
        n1 = g[("count", True)].sum()
        r1 = g[("sum", True)].sum() / n1
        r0 = ((g[("sum", False)] / g[("count", False)]) * g[("count", True)]).sum() / n1
        out[name] = {"edge": desc, "exposed_buildings": int(n1), "rate_exposed": round(float(r1), 4),
                     "rate_matched": round(float(r0), 4), "ratio": round(float(r1 / r0), 2) if r0 else None}
    return out
