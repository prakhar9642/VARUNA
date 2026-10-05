from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.config import MODEL_KEYS, REGIONS, VARIABLE_KEYS, VARIABLES
from app.main import app

client = TestClient(app)


def make_valid_series(region_id: str, n_hours: int = 193) -> dict:
    reg = REGIONS[region_id]
    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    times = [(now + timedelta(hours=i)).strftime("%Y-%m-%dT%H:%M") for i in range(n_hours)]

    models = {}
    for m in MODEL_KEYS:
        models[m] = {
            "temperature": [25.0 + (i % 5) * 0.5 for i in range(n_hours)],
            "rainfall": [max(0.0, float((i % 12) - 5)) for i in range(n_hours)],
            "wind_speed": [12.0 + (i % 8) * 1.5 for i in range(n_hours)],
            "pressure": [1010.0 - (i % 6) * 1.0 for i in range(n_hours)],
        }

    return {
        "time": times,
        "elevation_m": 214.0,
        "models": models,
        "requested_coordinates": {"lat": reg["lat"], "lon": reg["lon"]},
        "resolved_coordinates": {"lat": reg["lat"], "lon": reg["lon"]},
    }


def test_process_validation_unknown_region():
    series = make_valid_series("delhi_ncr")
    resp = client.post("/api/forecast/process", json={
        "region": "atlantis_ocean",
        "variable": "temperature",
        "series": series,
    })
    assert resp.status_code == 422
    assert "Unknown region" in resp.json()["detail"]


def test_process_validation_unknown_variable():
    series = make_valid_series("delhi_ncr")
    resp = client.post("/api/forecast/process", json={
        "region": "delhi_ncr",
        "variable": "cosmic_radiation",
        "series": series,
    })
    assert resp.status_code == 422
    assert "Unknown variable" in resp.json()["detail"]


def test_process_validation_coordinate_mismatch():
    series = make_valid_series("delhi_ncr")
    # Shift coordinates by 1.0 degree (> 0.25 tolerance)
    series["requested_coordinates"] = {"lat": 29.9, "lon": 77.2090}
    resp = client.post("/api/forecast/process", json={
        "region": "delhi_ncr",
        "variable": "temperature",
        "series": series,
    })
    assert resp.status_code == 422
    assert "deviate from canonical" in resp.json()["detail"]


def test_process_validation_missing_model():
    series = make_valid_series("delhi_ncr")
    del series["models"]["dwd_icon"]
    resp = client.post("/api/forecast/process", json={
        "region": "delhi_ncr",
        "variable": "temperature",
        "series": series,
    })
    assert resp.status_code == 422
    assert "Missing required model 'dwd_icon'" in resp.json()["detail"]


def test_process_validation_missing_variable_series():
    series = make_valid_series("delhi_ncr")
    del series["models"]["ecmwf_ifs"]["rainfall"]
    resp = client.post("/api/forecast/process", json={
        "region": "delhi_ncr",
        "variable": "rainfall",
        "series": series,
    })
    assert resp.status_code == 422
    assert "missing required variable 'rainfall'" in resp.json()["detail"]


def test_process_validation_negative_rainfall():
    series = make_valid_series("delhi_ncr")
    series["models"]["ecmwf_ifs"]["rainfall"][10] = -5.0
    resp = client.post("/api/forecast/process", json={
        "region": "delhi_ncr",
        "variable": "rainfall",
        "series": series,
    })
    assert resp.status_code == 422
    assert "Rainfall out of physical bounds" in resp.json()["detail"]


def test_process_validation_extreme_temperature():
    series = make_valid_series("delhi_ncr")
    series["models"]["ecmwf_ifs"]["temperature"][10] = 95.0
    resp = client.post("/api/forecast/process", json={
        "region": "delhi_ncr",
        "variable": "temperature",
        "series": series,
    })
    assert resp.status_code == 422
    assert "Temperature out of physical bounds" in resp.json()["detail"]


# Test matrix required by specification:
# Regions: Delhi NCR, Mumbai Coastal, Chennai Coastal, Western Ghats
# Variables: temperature, rainfall, wind_speed, pressure
# Test matrix across operational leads: 24h, 48h, 72h, 120h, 168h
@pytest.mark.parametrize("region", ["delhi_ncr", "mumbai_coastal", "chennai_coastal", "western_ghats"])
@pytest.mark.parametrize("variable", ["temperature", "rainfall", "wind_speed", "pressure"])
@pytest.mark.parametrize("lead", [24, 48, 72, 120, 168])
def test_process_matrix_leads(region: str, variable: str, lead: int):
    series = make_valid_series(region, n_hours=193)
    resp = client.post("/api/forecast/process", json={
        "region": region,
        "variable": variable,
        "lead_time_hours": lead,
        "series": series,
    })
    assert resp.status_code == 200, f"Failed for {region}/{variable}/{lead}: {resp.text}"
    body = resp.json()

    assert body["data_mode"] == "LIVE"
    assert body["region_id"] == region
    assert body["variable"] == variable
    assert body["requested_lead_time_hours"] == lead
    assert len(body["timeline"]) > 0

    # Exact target item for requested lead
    target = next((pt for pt in body["timeline"] if pt["lead_time_hours"] == lead), None)
    assert target is not None, f"Exact point for +{lead}h must exist in timeline"
    assert target["lead_time_hours"] == lead
    assert target["models_used"] == 4
    assert target["blend"] is not None
    assert isinstance(target["blend"], (int, float))

    # All 4 models present in target
    for m in MODEL_KEYS:
        assert m in target["models"]
        assert target["models"][m] is not None

    # Check scientific weighting scheme
    if variable in ("temperature", "pressure"):
        assert body["weighting_scheme"] in ("adaptive_xgboost", "equal_fallback_untrained")
        if body["weighting_scheme"] == "adaptive_xgboost":
            assert target["predicted_errors"] is not None
    else:
        assert body["weighting_scheme"] == "equal_fallback_untrained"
        assert target["predicted_errors"] is None


def test_exact_168h_lead_available():
    """Verify that an 8-day series (192+ hours) produces an exact +168h match relative to reference hour."""
    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    series = make_valid_series("delhi_ncr", n_hours=193)
    resp = client.post("/api/forecast/process", json={
        "region": "delhi_ncr",
        "variable": "temperature",
        "lead_time_hours": 168,
        "series": series,
    })
    assert resp.status_code == 200
    body = resp.json()
    timeline = body["timeline"]
    match = [pt for pt in timeline if pt["lead_time_hours"] == 168]
    assert len(match) == 1, "Must contain exactly one +168h point"
    pt168 = match[0]
    expected_time = (now + timedelta(hours=168)).strftime("%Y-%m-%dT%H:%M")
    assert pt168["time"] == expected_time
    assert pt168["lead_time_hours"] == 168
    assert pt168["blend"] is not None
    assert pt168["models_used"] == 4
    for m in MODEL_KEYS:
        assert pt168["models"][m] is not None


def test_exact_168h_lead_unavailable_when_truncated():
    """If the series only contains up to +120h, +168h must NOT be present in timeline and never falsely labeled."""
    series = make_valid_series("delhi_ncr", n_hours=121)
    resp = client.post("/api/forecast/process", json={
        "region": "delhi_ncr",
        "variable": "temperature",
        "lead_time_hours": 168,
        "series": series,
    })
    assert resp.status_code == 200
    body = resp.json()
    timeline = body["timeline"]
    match = [pt for pt in timeline if pt["lead_time_hours"] == 168]
    assert len(match) == 0, "+168h point must not exist when series is truncated at +120h"


def test_process_batch_twelve_regions():
    batch = []
    for r_id in REGIONS:
        batch.append({
            "region": r_id,
            "variable": "rainfall",
            "lead_time_hours": 48,
            "series": make_valid_series(r_id),
        })

    resp = client.post("/api/forecast/process", json={"batch": batch})
    assert resp.status_code == 200
    data = resp.json()
    assert "results" in data
    assert len(data["results"]) == len(REGIONS)

    for res in data["results"]:
        assert res["data_mode"] == "LIVE"
        assert res["variable"] == "rainfall"
        assert res["models_used"] == 4
        assert len(res["timeline"]) > 0
