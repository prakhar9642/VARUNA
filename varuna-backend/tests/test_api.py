from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

import app.services.blend_service as svc
from app.config import MODEL_KEYS, REGIONS, VARIABLES
from app.providers.open_meteo import ProviderError
from tests.conftest import make_live_series


@pytest.fixture()
def patched_live(monkeypatch):
    def _patch(series: dict, mode: str = "LIVE") -> None:
        monkeypatch.setattr(svc, "get_live_forecast", lambda lat, lon, **kw: (series, mode))
    return _patch


@pytest.fixture()
def provider_down(monkeypatch):
    def _boom(lat, lon, **kw):
        raise ProviderError("network disabled for this test")
    monkeypatch.setattr(svc, "get_live_forecast", _boom)


def _no_probe(monkeypatch):
    monkeypatch.setattr(
        svc, "probe_provider",
        lambda url, params=None: {"reachable": True, "http_status": 200,
                                  "latency_ms": 1.0, "checked_at": 0.0},
    )


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert "version" in body and "model_bundle_loaded" in body


def test_regions_lists_all_twelve_with_flags(client):
    body = client.get("/api/regions").json()["regions"]
    assert len(body) == 12
    by_id = {r["id"]: r for r in body}
    assert set(by_id) == set(REGIONS)
    assert by_id["delhi_ncr"]["validated"] is True
    assert by_id["punjab_agri"]["validated"] is False
    for r in body:
        assert {"id", "name", "lat", "lon", "validated", "benchmarked"} <= set(r)


def test_skill_carries_scopes(client):
    body = client.get("/api/skill").json()
    assert body["available"] is True
    assert body["headline"]["scope"] == "held_out_test"
    systems = {row["system"] for row in body["headline"]["rows"]}
    assert "varuna_adaptive" in systems and "ecmwf_ifs" in systems
    for key in ("by_lead", "by_season", "by_region"):
        assert body[key]["scope"] == "full_dataset_all_splits"
        for row in body[key]["rows"]:
            assert row["scope"] == "full_dataset_all_splits"
    assert "not ground truth" in body["reference"] or "not station" in body["reference"]


def test_providers_status_reports_artifacts(client, monkeypatch):
    _no_probe(monkeypatch)
    body = client.get("/api/providers/status").json()
    assert set(body["providers"]) == {
        "open_meteo_forecast", "open_meteo_previous_runs", "open_meteo_archive_era5"}
    assert body["artifacts"]["meta_model_joblib"] is True
    assert body["artifacts"]["blend_test_results_csv"] is True
    assert body["provenance"]["split_rule"]


def test_forecast_live_contract(client, patched_live, live_series):
    patched_live(live_series)
    body = client.get("/api/forecast?region=delhi_ncr&variable=temperature").json()
    assert body["data_mode"] == "LIVE"
    assert body["variable"] == "temperature"
    assert body["validated"] is True
    assert body["weighting_scheme"] == "adaptive_xgboost"
    assert body["horizon_note"]
    assert body["attribution"]
    entry = body["timeline"][0]
    assert set(entry["models"]) == set(MODEL_KEYS)
    assert sum(entry["weights"].values()) == 100
    assert 0 <= entry["lead_time_hours"] <= 168


def test_forecast_validated_variable_is_adaptive(client, patched_live, live_series):
    patched_live(live_series)
    body = client.get("/api/forecast?region=delhi_ncr&variable=rainfall").json()
    assert body["validated"] is True
    assert body["weighting_scheme"] == "adaptive_xgboost"
    assert body["weighting_reason"]


def test_forecast_capped_horizon_carries_note(client, patched_live, live_series):
    patched_live(live_series)
    body = client.get(
        "/api/forecast?region=delhi_ncr&variable=temperature&lead_time_hours=500").json()
    assert "exceeds" in body["horizon_note"] and "168" in body["horizon_note"]
    assert body["requested_lead_time_hours"] == 500


def test_forecast_unknown_region_is_503_not_502(client):
    r = client.get("/api/forecast?region=nope")
    assert r.status_code == 503
    assert r.json()["available"] is False


def test_weights_real_regime_and_sum_100(client, patched_live, live_series):
    patched_live(live_series)
    body = client.get(
        "/api/weights?region=delhi_ncr&variable=temperature&lead_time_hours=48").json()
    assert body["weighting_scheme"] == "adaptive_xgboost"
    assert sum(body["weights"].values()) == 100
    assert set(body["weights"]) == set(MODEL_KEYS)
    assert body["regime"]["index"] in range(6)
    assert body["regime"]["name"]
    assert body["weights_sum"] == 100
    assert body["predicted_errors"]


def test_weights_differ_between_regions(client, monkeypatch):
    def series_for(lat: float, lon: float, **kw):
        s = make_live_series()
        offset = -6.0 if lat < 20 else 0.0
        for key in MODEL_KEYS:
            s["models"][key]["temperature"] = [
                v + offset for v in s["models"][key]["temperature"]
            ]
        return s, "LIVE"

    monkeypatch.setattr(svc, "get_live_forecast", series_for)
    a = client.get("/api/weights?region=delhi_ncr&lead_time_hours=48").json()
    b = client.get("/api/weights?region=western_ghats&lead_time_hours=48").json()
    assert sum(a["weights"].values()) == 100
    assert sum(b["weights"].values()) == 100
    assert a["weights"] != b["weights"]


def test_weights_unvalidated_variable_declares_equal_fallback(client, patched_live, live_series, monkeypatch):
    patched_live(live_series)
    monkeypatch.setattr("app.config.VALIDATED_VARIABLES", set())
    body = client.get("/api/weights?region=mumbai_coastal&variable=wind_speed").json()
    assert body["weighting_scheme"] == "equal_fallback_untrained"
    assert body["validated"] is False
    assert body["reason"]
    assert sum(body["weights"].values()) == 100


def test_explain_returns_real_feature_importances(client, patched_live, live_series):
    patched_live(live_series)
    body = client.get(
        "/api/explain?region=delhi_ncr&variable=temperature&lead_time_hours=48").json()
    assert body["model_available"] is True
    imps = body["feature_importances"]
    assert len(imps) == 11
    assert abs(sum(i["share"] for i in imps) - 1.0) < 1e-3
    assert {i["feature"] for i in imps} == set(body["model_metadata"]["feature_names"])
    assert body["model_metadata"]["xgb_params"]["n_estimators"] == 80
    assert body["model_metadata"]["xgb_params"]["max_depth"] == 4


def test_extremes_endpoint_shape(client, patched_live, live_series):
    patched_live(live_series)
    body = client.get("/api/extremes?region=delhi_ncr&lead_time_hours=48").json()
    assert body["status"] in ("alerts", "no_alerts")
    assert len(body["checks"]) == 3
    assert body["data_mode"] in ("LIVE", "CACHED", "REPLAY")
    assert body["note"]


def test_cached_mode_is_echoed(client, patched_live, live_series):
    patched_live(live_series, mode="CACHED")
    body = client.get("/api/forecast?region=delhi_ncr&variable=temperature").json()
    assert body["data_mode"] == "CACHED"


def test_replay_when_provider_down(client, provider_down, patched_live):
    body = client.get(
        "/api/forecast?region=delhi_ncr&variable=temperature&lead_time_hours=48").json()
    assert body["data_mode"] == "REPLAY"
    assert "REPLAY" in body["horizon_note"] or "archived" in body["horizon_note"]
    assert body["timeline"]
    assert sum(body["timeline"][0]["weights"].values()) == 100


def test_replay_rejects_non_temperature_honestly(client, provider_down):
    r = client.get(
        "/api/forecast?region=delhi_ncr&variable=rainfall&lead_time_hours=48")
    assert r.status_code == 503
    body = r.json()
    assert body["available"] is False
    assert "temperature" in body["detail"]


def test_clean_503_when_live_cache_and_replay_all_fail(client, provider_down):
    r = client.get(
        "/api/forecast?region=punjab_agri&variable=temperature&lead_time_hours=48")
    assert r.status_code == 503
    body = r.json()
    assert body["available"] is False
    assert "unavailable" in body["detail"].lower()
    assert "mode_tried" in body


def test_weights_replay_fallback(client, provider_down):
    body = client.get(
        "/api/weights?region=delhi_ncr&variable=temperature&lead_time_hours=48").json()
    assert body["data_mode"] == "REPLAY"
    assert sum(body["weights"].values()) == 100


def test_weights_503_without_provider_or_replay(client, provider_down):
    r = client.get(
        "/api/weights?region=punjab_agri&variable=temperature&lead_time_hours=48")
    assert r.status_code == 503
    assert r.json()["available"] is False


def test_weights_replay_rejects_non_temperature_honestly(client, provider_down):
    r = client.get(
        "/api/weights?region=delhi_ncr&variable=rainfall&lead_time_hours=48")
    assert r.status_code == 503
    assert r.json()["available"] is False
    assert "temperature" in r.json()["detail"]


def test_analyze_post_contract_temperature(client, patched_live, live_series):
    patched_live(live_series)
    r = client.post("/api/analyze", json={"region": "delhi_ncr", "variable": "temperature", "lead_time_hours": 48})
    assert r.status_code == 200
    data = r.json()
    assert data["region"] == "delhi_ncr"
    assert data["variable"] == "temperature"
    assert data["lead_time_hours"] == 48
    assert "valid_time" in data
    assert data["data_mode"] in ["LIVE", "CACHED", "REPLAY"]
    assert "models" in data
    assert len(data["models"]) == 4
    assert "weights" in data
    assert sum(data["weights"].values()) == 100
    assert data["weighting_scheme"] == "adaptive_xgboost"
    assert isinstance(data["predicted_errors"], dict)
    assert len(data["predicted_errors"]) == 4
    assert isinstance(data["blend"], (int, float))
    assert isinstance(data["ensemble_spread"], (int, float))
    assert data["ensemble_spread"] >= 0.0
    assert "summary" in data and len(data["summary"]) > 20
    assert "VARUNA" in data["summary"]


def test_analyze_post_rainfall_adaptive(client, patched_live, live_series):
    patched_live(live_series)
    r = client.post("/api/analyze", json={"region": "delhi_ncr", "variable": "rainfall", "lead_time_hours": 48})
    assert r.status_code == 200
    data = r.json()
    assert data["variable"] == "rainfall"
    assert data["weighting_scheme"] == "adaptive_xgboost"
    assert sum(data["weights"].values()) == 100
    assert data["predicted_errors"] is not None


def test_analyze_get_contract(client, patched_live, live_series):
    patched_live(live_series)
    r = client.get("/api/analyze?region=delhi_ncr&variable=wind_speed&lead_time_hours=24")
    assert r.status_code == 200
    data = r.json()
    assert data["variable"] == "wind_speed"
    assert data["lead_time_hours"] == 24
    assert data["weighting_scheme"] == "adaptive_xgboost"


def test_analyze_unknown_region_422(client):
    r = client.post("/api/analyze", json={"region": "non_existent_zone", "variable": "temperature", "lead_time_hours": 48})
    assert r.status_code == 422


def test_analyze_unknown_variable_422(client):
    r = client.post("/api/analyze", json={"region": "delhi_ncr", "variable": "earthquake_intensity", "lead_time_hours": 48})
    assert r.status_code == 422


