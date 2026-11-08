"""Wholesale lead lists: the same contagion signal, pointed at motivated sellers.

Every list provider sells the same thing: owners who already have a code violation, a tax lien or a
foreclosure filing. By then every wholesaler in Dallas is mailing them. Firebreak can rank owners
*before* the first report, because distress spreads next door and through owners.

Each list is a rule over features known on one date. The same rule is applied on the backtest date
(Jul 1, 2026), and we report how many of its top leads really got a report in the next 90 days.
That hit rate is the honest headline, not the lead count.

Who is left out of every list:
- Owner-occupied homes (homestead). Firebreak routes them to repair programs, never to an offer.
- Owners DCAD marks confidential (dropped in dcad.py).
- Commercial and large multifamily. Those go to the CBRE operations plan, not wholesaling.

Owner names and mailing addresses never enter web/public/data/. export_private() writes them only
to a folder outside the repo, for the WHOLZR engine, and only when FIREBREAK_PRIVATE_OUT is set.
"""

from __future__ import annotations

import zipfile
from pathlib import Path

import numpy as np
import pandas as pd

from . import plan

TOP = 300
VALUE_RANGE = (80_000, 2_500_000)

LISTS = [
    {
        "id": "first_spark",
        "title": "First spark",
        "pitch": "No report ever filed here, but the block and the owner say one is coming. Nobody else has this owner yet.",
        "rule": "Never had a report · absentee, company or out-of-state owner · ranked by network risk",
    },
    {
        "id": "code_stack",
        "title": "Code stack",
        "pitch": "Three or more reports in a year and still getting worse. The owner is paying fines on a house they don't live in.",
        "rule": "3+ reports in the last year · not owner-occupied · ranked by risk",
    },
    {
        "id": "tired_landlord",
        "title": "Tired landlord",
        "pitch": "Small landlords whose trouble is spreading across their own houses. One conversation, several doors.",
        "rule": "Owner holds 2+ houses · mails elsewhere · 2+ reports across the portfolio in a year",
    },
    {
        "id": "block_fire",
        "title": "Block on fire",
        "pitch": "Quiet houses on blocks where reports are speeding up. Buy before the street's value drops.",
        "rule": "0 to 1 reports here · 6+ reports within 250 m in 90 days and rising · ranked by risk",
    },
]


def universe(p: pd.DataFrame) -> np.ndarray:
    small_mf = (p.asset_class == "multifamily") & (p.units.fillna(2) <= 4)
    return (((p.asset_class == "home") | small_mf) & ~p.homestead & p.value.between(*VALUE_RANGE)).to_numpy()


def masks(p: pd.DataFrame, X: pd.DataFrame) -> dict[str, np.ndarray]:
    U = universe(p)
    outsider = (p.absentee | p.owner_is_entity | p.owner_out_of_state).to_numpy()
    own_all, own365 = X.own_all.to_numpy(), X.own365.to_numpy()
    # Portfolio of houses per owner, inside the wholesale universe.
    houses = pd.Series(U.astype(int)).groupby(p.owner_id.values).transform("sum").to_numpy()
    port_reports = pd.Series(np.where(U, own365, 0)).groupby(p.owner_id.values).transform("sum").to_numpy()
    return {
        "first_spark": U & (own_all == 0) & outsider,
        "code_stack": U & (own365 >= 3),
        "tired_landlord": U & (houses >= 2) & (p.absentee | p.owner_out_of_state).to_numpy() & (port_reports >= 2),
        "block_fire": U & (own_all <= 1) & (X.nb250_90.to_numpy() >= 6) & (X.nb_accel.to_numpy() > 1.3),
    }


def backtest(p: pd.DataFrame, X: pd.DataFrame, risk: np.ndarray, y: np.ndarray) -> dict:
    """Apply every list rule on the backtest date and score its top leads against what happened."""
    out = {}
    base = y[universe(p)].mean()
    for name, m in masks(p, X).items():
        idx = np.where(m)[0]
        top = idx[np.argsort(-risk[idx])][:TOP]
        hit = float(y[top].mean()) if len(top) else 0.0
        pool = float(y[idx].mean()) if len(idx) else 0.0  # same rule, no ranking: what the model's order adds
        out[name] = {"eligible": int(m.sum()), "top": int(len(top)), "hit_rate": round(hit, 4),
                     "base_rate": round(float(base), 4), "lift": round(hit / base, 2) if base else None,
                     "pool_rate": round(pool, 4), "rank_lift": round(hit / pool, 2) if pool else None}
    return out


def demand(buyers: pd.DataFrame, zip_code: str, price: float) -> int:
    """Repeat cash buyers who bought in this ZIP at a price range that covers ours (15% tolerance)."""
    if buyers.empty or price <= 0:
        return 0
    ok = buyers.zips.apply(lambda z: zip_code in z) & (buyers.lo <= price * 1.15) & (buyers.hi >= price * 0.85)
    return int(ok.sum())


def build(p: pd.DataFrame, X: pd.DataFrame, risk: np.ndarray, risk_base: np.ndarray, buyers: pd.DataFrame,
          scores: dict) -> tuple[list[dict], pd.DataFrame]:
    """Return the public lists for the console and a frame of every lead (for the private export)."""
    out, rows = [], []
    for spec in LISTS:
        m = masks(p, X)[spec["id"]]
        idx = np.where(m)[0]
        top = idx[np.argsort(-risk[idx])][:TOP]
        leads = []
        for i in top:
            r = p.iloc[i]
            row = pd.Series({"value": r.value, "sqft": r.sqft, "condition": r.condition, "own365": X.own365.iat[i]})
            uw = plan.underwrite(row)
            d = demand(buyers, r.zip, uw["buyer_price"])
            lead = {
                "i": int(i), "parcel_id": r.parcel_id, "address": r.street.title(), "zip": r.zip,
                "lat": round(float(r.lat), 6), "lon": round(float(r.lon), 6), "asset_class": r.asset_class,
                "value": float(r.value), "sqft": None if pd.isna(r.sqft) else float(r.sqft),
                "year_built": None if pd.isna(r.year_built) else int(r.year_built),
                "risk": round(float(risk[i]), 4), "network_pts": round(float(max(0.0, risk[i] - risk_base[i])), 4),
                "reports_365": int(X.own365.iat[i]), "reports_all": int(X.own_all.iat[i]),
                "block_90d": int(X.nb250_90.iat[i]), "next_door_30d": int(X.nb50_30.iat[i]),
                "owner": {"id": r.owner_id, "label": r.owner_label, "buildings": int(X.portfolio_size.iat[i]),
                          "absentee": bool(r.absentee), "out_of_state": bool(r.owner_out_of_state)},
                "offer": uw["offer"], "buyer_price": uw["buyer_price"], "arv": uw["arv"], "repairs": uw["repairs"],
                "fee": uw["fee"], "viable": uw["viable"],
                "buyers_nearby": d, "p_two_buyers": round(float(1 - np.exp(-d / 6)), 3),
            }
            leads.append(lead)
            rows.append({"list": spec["id"], "parcel_id": r.parcel_id, "address": r.street, "zip": r.zip,
                         "risk": lead["risk"], "offer": uw["offer"], "fee": uw["fee"], "buyers_nearby": d})
        out.append({**spec, "eligible": int(m.sum()), "backtest": scores.get(spec["id"]), "leads": leads})
    return out, pd.DataFrame(rows)


def export_private(leads: pd.DataFrame, zip_path: Path, out_dir: Path) -> Path:
    """Join owner name and mailing address for the WHOLZR engine. Writes outside the repo only."""
    out_dir.mkdir(parents=True, exist_ok=True)
    ids = set(leads.parcel_id)
    with zipfile.ZipFile(zip_path) as z, z.open("ACCOUNT_INFO.CSV") as f:
        info = pd.read_csv(f, dtype=str, encoding="latin-1", keep_default_na=False,
                           usecols=["ACCOUNT_NUM", "OWNER_NAME1", "OWNER_NAME2", "EXCLUDE_OWNER", "OWNER_ADDRESS_LINE2",
                                    "OWNER_CITY", "OWNER_STATE", "OWNER_ZIPCODE"])
    info = info[info.ACCOUNT_NUM.isin(ids) & (info.EXCLUDE_OWNER != "Y")]
    info = info.rename(columns={"ACCOUNT_NUM": "parcel_id", "OWNER_NAME1": "owner_name", "OWNER_NAME2": "owner_name2",
                                "OWNER_ADDRESS_LINE2": "mail_line1", "OWNER_CITY": "mail_city",
                                "OWNER_STATE": "mail_state", "OWNER_ZIPCODE": "mail_zip"}).drop(columns="EXCLUDE_OWNER")
    full = leads.merge(info, on="parcel_id", how="inner")
    for name, g in full.groupby("list"):
        g.to_csv(out_dir / f"{name}.csv", index=False)
    full.to_csv(out_dir / "all_leads.csv", index=False)
    return out_dir
