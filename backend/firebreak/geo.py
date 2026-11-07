"""Put every building and every 311 report on the same map.

DCAD has addresses but no coordinates. Dallas 311 has coordinates for each report. So:
1. A building that has ever had a 311 report takes the median position of its reports.
2. Any other building on the same street and ZIP is placed by interpolating its house number
   between the nearest known house numbers on that street (the way a street geocoder works).
3. A building with no known neighbor on its street is left off the map.
"""

from __future__ import annotations

import re

import numpy as np
import pandas as pd

PROPERTY_TYPES = {
    "Code Concern - CCS", "Single Family Rental Needs Registration - CCS", "Restaurant/Food Complaint - CCS",
    "Consumer Protection Complaint - CCS", "Homeless Encampment - EMCR",
    "Criminal Activities - DPD", "Narcotics/Vice Complaint - DPD", "Chronic Noise Complaint - DPD",
}
# Short labels for the console legend.
KIND = {
    "Code Concern - CCS": "code", "Single Family Rental Needs Registration - CCS": "rental",
    "Restaurant/Food Complaint - CCS": "tenant", "Consumer Protection Complaint - CCS": "tenant",
    "Homeless Encampment - EMCR": "vacancy",
    "Criminal Activities - DPD": "nuisance", "Narcotics/Vice Complaint - DPD": "nuisance",
    "Chronic Noise Complaint - DPD": "nuisance",
}
LAT0 = 32.78  # Dallas: metres per degree for a flat projection
M_LAT = 111_320.0
M_LON = 111_320.0 * np.cos(np.radians(LAT0))


def xy(lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
    return np.column_stack([(np.asarray(lon) + 96.8) * M_LON, (np.asarray(lat) - LAT0) * M_LAT])


def load_events(path) -> pd.DataFrame:
    e = pd.read_csv(path, dtype=str)
    ll = e.lat_location.str.extract(r"\(([-\d.]+),\s*([-\d.]+)\)").astype(float)
    e["lat"], e["lon"] = ll[0], ll[1]
    e = e[e.lat.between(32.5, 33.1) & e.lon.between(-97.1, -96.5)].copy()
    e["t"] = pd.to_datetime(e.created_date, errors="coerce")
    e = e[e.t.notna()]
    # A construction-site complaint means the lot is being rebuilt, which is the opposite of distress.
    e = e[e.service_request_type != "Construction Site Complaint - PDD"]
    e["street"] = e.address.str.split(",").str[0].str.upper().str.replace(r"\s+", " ", regex=True).str.strip()
    e["zip"] = e.address.str.extract(r"(\d{5})\s*$")[0].fillna("")
    e["key"] = e.street + "|" + e.zip
    e["property"] = e.service_request_type.isin(PROPERTY_TYPES)
    e["kind"] = e.service_request_type.map(KIND).fillna("infra")
    return e[["t", "lat", "lon", "key", "property", "kind", "service_request_type"]].reset_index(drop=True)


_NUM = re.compile(r"^(\d+)\s+(.*)$")


def place(parcels: pd.DataFrame, events: pd.DataFrame) -> pd.DataFrame:
    """Add lat, lon and geo_method columns; drop buildings that cannot be placed."""
    known = events.groupby("key")[["lat", "lon"]].median()
    p = parcels.copy()
    p["zip"] = p.zip.str.strip()
    p["key"] = p.street + "|" + p.zip
    p = p.join(known, on="key")
    p["geo_method"] = np.where(p.lat.notna(), "311", "")

    # Interpolate along the street from every placed point (buildings and raw 311 addresses).
    pts = known.reset_index()
    parts = pts.key.str.split("|", expand=True)
    m = parts[0].str.extract(_NUM)
    pts["num"], pts["road"], pts["zip"] = pd.to_numeric(m[0], errors="coerce"), m[1], parts[1]
    pts = pts.dropna(subset=["num"])
    groups = {k: g.sort_values("num") for k, g in pts.groupby(["road", "zip"])}

    miss = p.lat.isna()
    m = p.loc[miss, "street"].str.extract(_NUM)
    nums = pd.to_numeric(m[0], errors="coerce")
    lat_out, lon_out = [], []
    for num, road, z in zip(nums, m[1], p.loc[miss, "zip"]):
        g = groups.get((road, z))
        if g is None or pd.isna(num):
            lat_out.append(np.nan); lon_out.append(np.nan); continue
        n = g.num.to_numpy()
        if len(n) == 1:
            ok = abs(n[0] - num) <= 400
            lat_out.append(g.lat.iloc[0] if ok else np.nan); lon_out.append(g.lon.iloc[0] if ok else np.nan); continue
        i = int(np.clip(np.searchsorted(n, num), 1, len(n) - 1))
        a, b = i - 1, i
        if num < n[0] - 400 or num > n[-1] + 400:
            lat_out.append(np.nan); lon_out.append(np.nan); continue
        w = 0.0 if n[b] == n[a] else float(np.clip((num - n[a]) / (n[b] - n[a]), -0.5, 1.5))
        lat_out.append(g.lat.iloc[a] + w * (g.lat.iloc[b] - g.lat.iloc[a]))
        lon_out.append(g.lon.iloc[a] + w * (g.lon.iloc[b] - g.lon.iloc[a]))
    p.loc[miss, "lat"] = lat_out
    p.loc[miss, "lon"] = lon_out
    p.loc[miss & p.lat.notna(), "geo_method"] = "street"
    return p[p.lat.notna()].reset_index(drop=True)
