"""Download Dallas 311 service requests that signal property or infrastructure trouble.

Source: Dallas Open Data, dataset d7e7-envw (311 Service Requests), updated daily.
Writes data/raw/dallas_311.csv.gz (gitignored). Run: uv run python -m firebreak.fetch_311
"""

from __future__ import annotations

import csv
import gzip
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

URL = "https://www.dallasopendata.com/resource/d7e7-envw.json"
SINCE = "2022-01-01T00:00:00"

# Property distress signals: the building or its use is failing.
PROPERTY = [
    "Code Concern - CCS",
    "Single Family Rental Needs Registration - CCS",
    "Restaurant/Food Complaint - CCS",
    "Consumer Protection Complaint - CCS",
    "Construction Site Complaint - PDD",
    "Homeless Encampment - EMCR",
    "Criminal Activities - DPD",
    "Narcotics/Vice Complaint - DPD",
    "Chronic Noise Complaint - DPD",
]
# Infrastructure shocks: the shared systems a block depends on.
INFRA = [
    "Water Main Leak/Break - DWU",
    "Inlet/Storm Drain Cleaning - DWU",
    "Creek/Culvert Maintenance -DWU",
    "Street Lighting - Maintenance- TPW",
    "Alley/Sidewalk/Street Repair - Hazardous - TPW",
    "Traffic Signal - All Out - TPW",
    "Tree Down/Low Limbs - TPW",
]
FIELDS = ["service_request_number", "address", "service_request_type", "department", "created_date", "status", "lat_location"]
PAGE = 50000


def _q(values: list[str]) -> str:
    return ",".join("'" + v.replace("'", "''") + "'" for v in values)


def fetch(out: Path) -> int:
    where = (f"created_date >= '{SINCE}' AND lat_location IS NOT NULL AND "
             f"(service_request_type in({_q(PROPERTY + INFRA)}) OR service_request_type like '%Sewer%')")
    out.parent.mkdir(parents=True, exist_ok=True)
    n = 0
    with gzip.open(out, "wt", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS, extrasaction="ignore")
        w.writeheader()
        offset = 0
        while True:
            q = urllib.parse.urlencode({"$select": ",".join(FIELDS), "$where": where, "$order": "created_date",
                                        "$limit": PAGE, "$offset": offset})
            for attempt in range(4):
                try:
                    with urllib.request.urlopen(f"{URL}?{q}", timeout=180) as r:
                        rows = json.load(r)
                    break
                except Exception as e:  # network hiccup: back off and retry
                    print("retry", attempt, e, file=sys.stderr)
                    time.sleep(5 * (attempt + 1))
            else:
                raise RuntimeError("311 fetch failed")
            w.writerows(rows)
            n += len(rows)
            print(f"{n} rows", file=sys.stderr, flush=True)
            if len(rows) < PAGE:
                return n
            offset += PAGE


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[2]
    print(fetch(root / "data" / "raw" / "dallas_311.csv.gz"))
