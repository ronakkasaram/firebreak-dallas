import numpy as np
import pandas as pd

from firebreak import geo, model, plan


def _parcels(rows):
    base = {"parcel_id": "x", "zip": "75201", "asset_class": "home", "owner_id": "o", "owner_label": "",
            "value": 300000.0, "prev_value": 290000.0, "deed_date": pd.Timestamp("2015-01-01"), "year_built": 1960.0,
            "condition": "AVERAGE", "depreciation": np.nan, "absentee": False, "owner_out_of_state": False,
            "owner_is_entity": False, "homestead": True, "sqft": 1500.0, "tenants": 0}
    return pd.DataFrame([{**base, **r} for r in rows])


def test_place_interpolates_house_numbers_along_a_street():
    events = pd.DataFrame({"key": ["100 ELM ST|75201", "200 ELM ST|75201"], "lat": [32.0, 32.1], "lon": [-96.0, -96.1]})
    p = _parcels([{"parcel_id": "a", "street": "100 ELM ST"}, {"parcel_id": "b", "street": "150 ELM ST"},
                  {"parcel_id": "c", "street": "5 NOWHERE RD"}])
    out = geo.place(p, events).set_index("parcel_id")
    assert out.loc["a", "geo_method"] == "311"
    assert out.loc["b", "geo_method"] == "street"
    assert abs(out.loc["b", "lat"] - 32.05) < 1e-9
    assert "c" not in out.index


def test_features_use_only_reports_before_the_cutoff():
    p = _parcels([{"parcel_id": "a", "street": "100 ELM ST", "key": "100 ELM ST|75201", "lat": 32.0, "lon": -96.0},
                  {"parcel_id": "b", "street": "102 ELM ST", "key": "102 ELM ST|75201", "lat": 32.0001, "lon": -96.0}])
    ev = pd.DataFrame({"t": pd.to_datetime(["2026-01-10", "2026-02-10", "2026-03-10"]), "lat": [32.0] * 3,
                       "lon": [-96.0] * 3, "key": ["100 ELM ST|75201"] * 3, "property": [True] * 3,
                       "kind": ["code"] * 3, "service_request_type": ["Code Concern - CCS"] * 3})
    w = model.world(p, ev)
    f = model.features(w, pd.Timestamp("2026-03-01"))
    assert f.own365.tolist() == [2, 0]
    assert f.nb50_90.tolist() == [0, 2]  # building b sees a's two reports next door, a does not count its own
    assert model.labels(w, pd.Timestamp("2026-03-01")).tolist() == [1, 0]


def test_underwrite_follows_the_70_percent_rule():
    row = pd.Series({"value": 200000.0, "sqft": 1000.0, "condition": "FAIR", "own365": 0})
    uw = plan.underwrite(row)
    arv = 200000 * plan.A("arv_over_dcad")
    assert uw["repair_tier"] == "fair"
    assert uw["buyer_price"] == round(arv * 0.70 - 1000 * plan.A("repair_psf")["fair"], -2)
    assert uw["offer"] == round(uw["buyer_price"] - plan.A("min_assignment_fee"), -2)


def test_homestead_owner_gets_help_first_not_an_offer():
    row = pd.Series({"asset_class": "home", "homestead": True, "value": 200000.0, "sqft": 1000.0, "condition": "FAIR",
                     "own365": 1, "zip": "75201", "units": np.nan, "tenants": 0, "owner_is_entity": False,
                     "absentee": False, "exposure_usd": 1000.0})
    out = plan.response(row, pd.DataFrame())
    assert not any("cash offer" in s["do"] for s in out["steps"])
    assert "home repair" in out["steps"][0]["do"]


def test_rent_use_follows_dcad_building_type():
    assert plan.rent_use("OFFICE BUILDING", "commercial") == "office"
    assert plan.rent_use("STORAGE WAREHOUSE", "commercial") == "industrial"
    assert plan.rent_use("FREE STANDING RETAIL STORE", "commercial") == "retail"
    assert plan.rent_use("CHURCH BUILDING", "commercial") is None


def test_owner_occupied_homes_never_make_a_wholesale_list():
    from firebreak import lists
    p = _parcels([{"parcel_id": "a", "homestead": True, "absentee": True},
                  {"parcel_id": "b", "homestead": False, "absentee": True}])
    p["units"] = np.nan
    assert lists.universe(p).tolist() == [False, True]
