"""From a risk score to dollars and a response plan.

Three questions per building:
1. Firebreak value: if we stabilize this building now, how many reports do we prevent next door?
   We take the building's recent reports out of its neighbors' features and re-score them with the
   network model. The drop in their risk, plus the building's own risk, is reports prevented.
2. Dollars: what does a new distress case cost the people around it? (assumptions.json)
3. Response: what does the WHOLZR crew do about it, and what does each step cost and return?

Every assumption that is not measured from the data lives in ASSUMPTIONS with its source, so a
judge or mentor can challenge one number without reading code.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.spatial import cKDTree

from . import model

ASSUMPTIONS = {
    "spillover_pct_per_case": {
        "value": 0.009,
        "source": "Immergluck & Smith (2006), Housing Policy Debate 17(1): each foreclosure within 1/8 mile "
                  "(about 200 m) lowers nearby single-family values about 0.9%. Applied only to residential "
                  "neighbors (homes and multifamily), for any new distress case.",
    },
    "spillover_radius_m": {"value": 200, "source": "1/8 mile, matching the study above."},
    "rent_psf_year": {
        "value": {"commercial": 24.0, "industrial": 8.0},
        "source": "Placeholder Dallas asking rents. Ask CBRE mentors for the current MarketView numbers.",
    },
    "rent_unit_month": {"value": 1350.0, "source": "Placeholder Dallas average apartment rent per unit."},
    "disruption_months_per_case": {
        "value": 1.0,
        "source": "Placeholder: a code or nuisance case disrupts one month of rent while it is open.",
    },
    "repair_psf": {
        "value": {"good": 8.0, "average": 18.0, "fair": 32.0, "poor": 55.0},
        "source": "Placeholder rehab tiers by DCAD condition (WHOLZR uses the same tiers).",
    },
    "arv_over_dcad": {"value": 1.10, "source": "DCAD market value lags sales; WHOLZR placeholder."},
    "buyer_pct_of_arv": {"value": 0.70, "source": "Standard cash-buyer rule (70% of ARV minus repairs)."},
    "min_assignment_fee": {"value": 10000, "source": "WHOLZR policy minimum fee."},
    "outreach_cost": {"value": 4.0, "source": "One mailed letter plus skip trace."},
    "inspection_cost": {"value": 450.0, "source": "Placeholder building inspection."},
}


def A(name: str):
    return ASSUMPTIONS[name]["value"]


def firebreak_value(w: model.World, X: pd.DataFrame, risk: np.ndarray, net, candidates: np.ndarray) -> pd.DataFrame:
    """Reports prevented next door if each candidate building is stabilized now."""
    tree = cKDTree(w.pxy)
    rows, owners = [], []
    for i in candidates:
        for j in tree.query_ball_point(w.pxy[i], 250):
            if j != i:
                rows.append(j); owners.append(i)
    rows, owners = np.array(rows), np.array(owners)
    if len(rows) == 0:
        return pd.DataFrame({"idx": candidates, "prevented_nearby": 0.0, "neighbors_250": 0})
    Xn = X.iloc[rows].copy().reset_index(drop=True)
    dist = np.linalg.norm(w.pxy[rows] - w.pxy[owners], axis=1)
    src = X.iloc[owners].reset_index(drop=True)
    # The candidate's own reports stop counting for its neighbors.
    near50, near100 = dist <= 50, dist <= 100
    # own30 is not a feature, so the 30-day block count drops by up to the candidate's 90-day count.
    Xn.loc[near50, "nb50_30"] = (Xn.nb50_30[near50] - np.minimum(src.own90[near50], Xn.nb50_30[near50])).to_numpy()
    Xn.loc[near50, "nb50_90"] = (Xn.nb50_90[near50] - src.own90[near50]).clip(lower=0).to_numpy()
    for col, own in (("nb100_90", "own90"), ("nb100_365", "own365")):
        Xn.loc[near100, col] = (Xn[col][near100] - src[own][near100]).clip(lower=0).to_numpy()
    for col, own in (("nb250_90", "own90"), ("nb250_365", "own365")):
        Xn[col] = (Xn[col] - src[own]).clip(lower=0)
    Xn["nb_accel"] = (Xn.nb250_90 + 1) / (Xn.nb250_365 / 4 + 1)
    after = net.predict_proba(Xn[model.ALL])[:, 1]
    drop = np.clip(risk[rows] - after, 0, None)
    out = pd.DataFrame({"idx": owners, "drop": drop}).groupby("idx")["drop"].agg(["sum", "size"])
    out = out.reindex(candidates, fill_value=0)
    return pd.DataFrame({"idx": candidates, "prevented_nearby": out["sum"].to_numpy(),
                         "neighbors_250": out["size"].to_numpy()})


def dollars(p: pd.DataFrame, risk: np.ndarray, pxy: np.ndarray, idx: np.ndarray, prevented: np.ndarray) -> pd.DataFrame:
    """Expected cost of letting each building fail: spillover on neighbors plus lost rent."""
    resid = np.where(p.asset_class.isin(["home", "multifamily"]).to_numpy())[0]
    tree = cKDTree(pxy[resid])
    vals = p.value.to_numpy()[resid]
    self_resid = p.asset_class.isin(["home", "multifamily"]).to_numpy()[idx]
    nb_value = np.array([vals[tree.query_ball_point(pxy[i], A("spillover_radius_m"))].sum() for i in idx])
    nb_value = nb_value - np.where(self_resid, p.value.to_numpy()[idx], 0)
    expected_cases = risk[idx] + prevented
    spill = nb_value * A("spillover_pct_per_case") * expected_cases
    cls = p.asset_class.to_numpy()[idx]
    lease = p.lease_sf.fillna(0).to_numpy()[idx]
    sqft = p.sqft.fillna(0).to_numpy()[idx]
    units = p.units.fillna(0).to_numpy()[idx]
    month = A("disruption_months_per_case")
    rent = np.zeros(len(idx))
    for c, psf in A("rent_psf_year").items():
        m = cls == c
        rent[m] = np.where(lease[m] > 0, lease[m], sqft[m]) * psf / 12 * month * risk[idx][m]
    m = cls == "multifamily"
    rent[m] = np.maximum(units[m], 2) * A("rent_unit_month") * month * risk[idx][m]
    return pd.DataFrame({"neighbor_value": nb_value, "spillover_usd": spill, "rent_at_risk_usd": rent,
                         "exposure_usd": spill + rent})


def underwrite(row: pd.Series) -> dict:
    """WHOLZR Oracle: price a rescue acquisition for a home or small multifamily building."""
    tiers = A("repair_psf")
    cond = str(row.condition).lower()
    tier = "poor" if cond in ("poor", "very poor", "unsound") else "fair" if cond == "fair" else \
        "good" if cond in ("good", "very good", "excellent") else "average"
    if row.own365 >= 3 and tier in ("good", "average"):
        tier = "fair"  # repeated code cases mean the condition rating is out of date
    arv = row.value * A("arv_over_dcad")
    repairs = (row.sqft if row.sqft and row.sqft > 0 else 1500) * tiers[tier]
    buyer_price = arv * A("buyer_pct_of_arv") - repairs
    fee = A("min_assignment_fee")
    offer = buyer_price - fee
    return {"arv": round(arv, -2), "repair_tier": tier, "repairs": round(repairs, -2), "buyer_price": round(buyer_price, -2),
            "offer": round(offer, -2), "fee": fee, "offer_pct_of_value": round(offer / row.value, 3) if row.value else None,
            "viable": bool(offer > 0.35 * row.value)}


def repeat_buyers(p: pd.DataFrame, today: pd.Timestamp) -> pd.DataFrame:
    """WHOLZR Magnet: companies that bought 3+ Dallas buildings in the last 2 years, from deed dates."""
    public = r"HOUSING|AUTHORITY|CITY OF|COUNTY|DISTRICT|\bISD\b|CHURCH|BANK|MORTGAGE|LAND BANK"
    recent = p[(p.owner_label != "") & ~p.owner_label.str.contains(public) &
               (p.deed_date >= today - pd.Timedelta(days=730))]
    g = recent.groupby("owner_id").agg(name=("owner_label", "first"), buys=("parcel_id", "size"),
                                       zips=("zip", lambda s: sorted(set(s))), lo=("value", lambda s: s.quantile(0.1)),
                                       hi=("value", lambda s: s.quantile(0.9)),
                                       classes=("asset_class", lambda s: sorted(set(s))))
    return g[g.buys >= 3].sort_values("buys", ascending=False)


def match_buyers(buyers: pd.DataFrame, zip_code: str, price: float, cls: str, k: int = 3) -> list[dict]:
    if buyers.empty or price <= 0:
        return []
    ok = buyers[buyers.classes.apply(lambda c: cls in c) & (buyers.lo <= price * 1.15) & (buyers.hi >= price * 0.85)]
    local = ok[ok.zips.apply(lambda z: zip_code in z)]
    pick = pd.concat([local, ok.drop(local.index)]).head(k)
    return [{"name": r.name, "buys_2y": int(r.buys), "in_zip": zip_code in r.zips} for r in pick.itertuples()]


def response(row: pd.Series, buyers: pd.DataFrame) -> dict:
    """The crew's plan for one building. Nothing is sent: every step waits for a human to approve."""
    steps = []
    cls = row.asset_class
    if cls in ("commercial", "industrial") or (cls == "multifamily" and row.units >= 5):
        steps.append({"crew": "Radar", "do": f"Open a watch on the block: {int(row.neighbors_250)} buildings within 250 m, "
                                            f"{int(row.infra250_180)} infrastructure failures nearby in 6 months.",
                      "cost": 0})
        if row.tenants:
            steps.append({"crew": "Echo", "do": f"Warn the {int(row.tenants)} business tenants on file before the next case "
                                                f"lands, and log their service-level exposure.", "cost": 0})
        steps.append({"crew": "Hawk", "do": "Dispatch a building inspection to find the root cause before it repeats.",
                      "cost": A("inspection_cost")})
        steps.append({"crew": "Oracle", "do": "If the owner cannot fix it, price a disposition to a value-add buyer.",
                      "cost": 0})
        uw = None
    else:
        uw = underwrite(row)
        if row.homestead:
            steps.append({"crew": "Shield", "do": "Owner lives here (homestead). First letter offers City of Dallas home "
                                                  "repair programs only, no purchase offer.", "cost": A("outreach_cost")})
        else:
            who = "Company owner" if row.owner_is_entity else "Absentee owner" if row.absentee else "No homestead on file"
            steps.append({"crew": "Shield", "do": f"{who}: purchase outreach allowed. Texas Occupations Code 1101.0045 "
                                                  "disclosure attached to any buyer marketing.", "cost": 0})
            steps.append({"crew": "Echo", "do": f"Mail the owner a cash offer of ${uw['offer']:,.0f} with a 14-day close.",
                          "cost": A("outreach_cost")})
        steps.append({"crew": "Magnet", "do": "Line up repeat cash buyers before signing (buyer-first rule).", "cost": 0})
        steps.append({"crew": "Closer", "do": "On a signed contract, assign it to the buyer and open title.", "cost": 0})
    buyers_matched = match_buyers(buyers, row.zip, (uw or {}).get("buyer_price", row.value * 0.8), cls)
    cost = sum(s["cost"] for s in steps)
    return {"steps": steps, "underwrite": uw, "buyers": buyers_matched, "cost": cost}
