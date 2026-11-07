"""Turn the Dallas Central Appraisal District export into one row per building in the City of Dallas.

Input: DCAD's public bulk export (DCAD2026_CURRENT.zip, data as of 2026-09-15), from
https://www.dallascad.org/DataProducts.aspx. Set DCAD_ZIP to its path.

Output: data/work/parcels.parquet with one row per real property account, and
data/work/tenants.parquet with one row per business personal property (BPP) account.
A BPP account is a business that owns equipment at an address, so it is a tenant.
Joining tenants to buildings by street address is one of the "hidden dependencies":
DCAD files them separately and nothing in the export links them.

Privacy:
- Accounts with EXCLUDE_OWNER = "Y" are dropped (Texas Tax Code 25.025 confidential owners).
- People's names never leave this step. Each owner becomes a short hash (owner_id), so the
  published data shows portfolios without naming people. Only company owners (LLC, INC, LP and
  similar, never trusts) keep a display name, because buyer matching needs it.
- From the exemption table only the homestead date is read. Over-65, disability and veteran
  columns are never loaded.
"""

from __future__ import annotations

import hashlib
import os
import re
import sys
import zipfile
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / "data" / "work"
DEFAULT_ZIP = ROOT / "data" / "raw" / "DCAD2026_CURRENT.zip"

# State property tax (SPTD) codes we keep, mapped to a plain asset class.
CLASSES = {
    ("RES", "A11"): "home",
    ("RES", "A12"): "home",
    ("RES", "B11"): "multifamily",
    ("RES", "B12"): "multifamily",
    ("COM", "B11"): "multifamily",
    ("COM", "B12"): "multifamily",
    ("COM", "F10"): "commercial",
    ("COM", "F20"): "industrial",
}
ENTITY = re.compile(r"\b(?:LLC|L L C|INC|LP|L P|LTD|CORP|CO|COMPANY|TRUST|TR|PARTNERS|PARTNERSHIP|HOLDINGS|PROPERTIES|"
                    r"INVESTMENTS?|CAPITAL|FUND|REIT|BANK|ASSOCIATION|ASSN|CHURCH|CITY OF|ISD|AUTHORITY)\b")


# Business owners whose names are safe to show (companies, not people or family trusts).
BUSINESS = re.compile(r"\b(?:LLC|L L C|INC|LP|L P|LTD|CORP|COMPANY|PARTNERS|PARTNERSHIP|HOLDINGS|PROPERTIES|"
                      r"INVESTMENTS?|CAPITAL|FUND|REIT|HOMES|REALTY|VENTURES|GROUP)\b")


def norm_street(num: str, street: str) -> str:
    s = f"{str(num).strip()} {str(street).strip()}".upper()
    return re.sub(r"\s+", " ", s).strip()


def owner_hash(name: str, mail: str) -> str:
    return hashlib.sha1(f"{name}|{mail}".encode()).hexdigest()[:10]


def _read(z: zipfile.ZipFile, name: str, cols: list[str]) -> pd.DataFrame:
    with z.open(name) as f:
        return pd.read_csv(f, usecols=cols, dtype=str, encoding="latin-1", keep_default_na=False)


def build(zip_path: Path) -> dict[str, int]:
    WORK.mkdir(parents=True, exist_ok=True)
    z = zipfile.ZipFile(zip_path)

    appr = _read(z, "ACCOUNT_APPRL_YEAR.CSV", ["ACCOUNT_NUM", "DIVISION_CD", "SPTD_CODE", "TOT_VAL", "LAND_VAL",
                                               "IMPR_VAL", "PREV_MKT_VAL", "CITY_JURIS_DESC"])
    appr = appr[appr.CITY_JURIS_DESC.str.strip() == "DALLAS"].copy()
    appr["SPTD_CODE"] = appr.SPTD_CODE.str.strip()
    appr["asset_class"] = [CLASSES.get((d, s)) for d, s in zip(appr.DIVISION_CD, appr.SPTD_CODE)]
    is_bpp = appr.DIVISION_CD == "BPP"
    bpp = appr[is_bpp]
    appr = appr[appr.asset_class.notna()]
    print(f"real property kept {len(appr)}, tenant BPP {len(bpp)}", file=sys.stderr)

    info = _read(z, "ACCOUNT_INFO.CSV", ["ACCOUNT_NUM", "BIZ_NAME", "OWNER_NAME1", "EXCLUDE_OWNER", "OWNER_ADDRESS_LINE2",
                                         "OWNER_CITY", "OWNER_STATE", "OWNER_ZIPCODE", "STREET_NUM", "FULL_STREET_NAME",
                                         "PROPERTY_ZIPCODE", "DEED_TXFR_DATE"])
    info = info[info.ACCOUNT_NUM.isin(set(appr.ACCOUNT_NUM) | set(bpp.ACCOUNT_NUM))]
    excluded = int((info.EXCLUDE_OWNER == "Y").sum())
    info = info[info.EXCLUDE_OWNER != "Y"].copy()
    info["street"] = [norm_street(n, s) for n, s in zip(info.STREET_NUM, info.FULL_STREET_NAME)]
    info["zip"] = info.PROPERTY_ZIPCODE.str[:5]
    info["key"] = info.street + "|" + info.zip

    # Tenants: business personal property accounts.
    t = bpp.merge(info, on="ACCOUNT_NUM")
    tenants = pd.DataFrame({
        "tenant_id": t.ACCOUNT_NUM,
        "key": t.key,
        "business": t.BIZ_NAME.str.strip().replace("", "UNNAMED BUSINESS"),
        "bpp_value": pd.to_numeric(t.TOT_VAL, errors="coerce").fillna(0),
    })
    tenants.to_parquet(WORK / "tenants.parquet", index=False)

    p = appr.merge(info, on="ACCOUNT_NUM")
    mail = (p.OWNER_ADDRESS_LINE2.str.strip() + ", " + p.OWNER_CITY.str.strip() + ", " + p.OWNER_STATE.str.strip())
    owner_name = p.OWNER_NAME1.str.strip()
    out = pd.DataFrame({
        "parcel_id": p.ACCOUNT_NUM,
        "key": p.key,
        "street": p.street,
        "zip": p.zip,
        "asset_class": p.asset_class,
        "owner_id": [owner_hash(n, m) for n, m in zip(owner_name, mail)],
        "owner_is_entity": owner_name.str.contains(ENTITY),
        "owner_label": owner_name.where(owner_name.str.contains(BUSINESS) & ~owner_name.str.contains(r"\bTRUST\b|\bTR\b"), ""),
        "owner_out_of_state": ~p.OWNER_STATE.str.strip().str.upper().isin(["TEXAS", "TX"]),
        "mail_zip": p.OWNER_ZIPCODE.str[:5],
        "value": pd.to_numeric(p.TOT_VAL, errors="coerce").fillna(0),
        "land_value": pd.to_numeric(p.LAND_VAL, errors="coerce").fillna(0),
        "prev_value": pd.to_numeric(p.PREV_MKT_VAL, errors="coerce").fillna(0),
        "deed_date": pd.to_datetime(p.DEED_TXFR_DATE, format="%m/%d/%Y", errors="coerce"),
    })
    out["absentee"] = out.mail_zip != out.zip

    hs = _read(z, "APPLIED_STD_EXEMPT.CSV", ["ACCOUNT_NUM", "HOMESTEAD_EFF_DT"])
    out["homestead"] = out.parcel_id.isin(set(hs.ACCOUNT_NUM[hs.HOMESTEAD_EFF_DT.str.strip() != ""]))

    res = _read(z, "RES_DETAIL.CSV", ["ACCOUNT_NUM", "YR_BUILT", "TOT_LIVING_AREA_SF", "CDU_RATING_DESC"])
    res = res[res.ACCOUNT_NUM.isin(set(out.parcel_id))]
    res["sqft"] = pd.to_numeric(res.TOT_LIVING_AREA_SF, errors="coerce")
    res = res.sort_values("sqft").drop_duplicates("ACCOUNT_NUM", keep="last")

    com = _read(z, "COM_DETAIL.CSV", ["ACCOUNT_NUM", "BLDG_CLASS_DESC", "YEAR_BUILT", "GROSS_BLDG_AREA", "NUM_UNITS",
                                      "NET_LEASE_AREA", "PROPERTY_NAME", "PROPERTY_COND_DESC", "TOT_DEPR_PCT",
                                      "COMPARABILITY_CD"])
    com = com[com.ACCOUNT_NUM.isin(set(out.parcel_id))].copy()
    for c in ["GROSS_BLDG_AREA", "NUM_UNITS", "NET_LEASE_AREA", "TOT_DEPR_PCT", "YEAR_BUILT"]:
        com[c] = pd.to_numeric(com[c], errors="coerce")
    # One account can hold several buildings: sum areas and units, keep the largest building's descriptors.
    com = com.sort_values("GROSS_BLDG_AREA")
    agg = com.groupby("ACCOUNT_NUM").agg(
        gross_sf=("GROSS_BLDG_AREA", "sum"), units=("NUM_UNITS", "sum"), lease_sf=("NET_LEASE_AREA", "sum"),
        building_type=("BLDG_CLASS_DESC", "last"), com_year=("YEAR_BUILT", "last"), property_name=("PROPERTY_NAME", "last"),
        condition=("PROPERTY_COND_DESC", "last"), depreciation=("TOT_DEPR_PCT", "last"), grade=("COMPARABILITY_CD", "last"))

    out = out.merge(res.rename(columns={"ACCOUNT_NUM": "parcel_id"})[["parcel_id", "YR_BUILT", "sqft", "CDU_RATING_DESC"]],
                    on="parcel_id", how="left")
    out = out.merge(agg, left_on="parcel_id", right_index=True, how="left")
    out["year_built"] = pd.to_numeric(out.YR_BUILT, errors="coerce").fillna(out.com_year)
    out["sqft"] = out.sqft.fillna(out.gross_sf)
    out["condition"] = out.condition.fillna(out.CDU_RATING_DESC).fillna("").str.strip().str.upper()
    out = out.drop(columns=["YR_BUILT", "CDU_RATING_DESC", "com_year"])

    n_tenants = tenants.groupby("key").size()
    out["tenants"] = out.key.map(n_tenants).fillna(0).astype(int)
    out.to_parquet(WORK / "parcels.parquet", index=False)
    stats = {"parcels": len(out), "tenants": len(tenants), "excluded_confidential": excluded,
             **{f"class_{k}": int(v) for k, v in out.asset_class.value_counts().items()}}
    print(stats, file=sys.stderr)
    return stats


if __name__ == "__main__":
    build(Path(os.environ.get("DCAD_ZIP", DEFAULT_ZIP)))
