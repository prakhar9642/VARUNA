from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

import app.services.blend_service as svc
from app.config import EXTREME_THRESHOLDS


def make_constant_series(temperature: float, rainfall: float,
                         wind_speed: float, pressure: float,
                         n_hours: int = 96) -> dict:
    start = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    times = [(start + timedelta(hours=i)).strftime("%Y-%m-%dT%H:%M") for i in range(n_hours)]
    fields = {
        "temperature": temperature,
        "rainfall": rainfall,
        "wind_speed": wind_speed,
        "pressure": pressure,
    }
    models = {
        key: {f: [v] * n_hours for f, v in fields.items()}
        for key in ("ecmwf_ifs", "ecmwf_aifs", "ncep_gfs", "dwd_icon")
    }
    return {"time": times, "elevation_m": 216.0, "models": models}


@pytest.fixture()
def patch_series(monkeypatch):
    def _patch(series: dict) -> None:
        monkeypatch.setattr(svc, "get_live_forecast", lambda lat, lon, **kw: (series, "LIVE"))
    return _patch


def _alerts(payload: dict) -> dict:
    return {a["hazard"]: a for a in payload["alerts"]}


def test_no_alerts_when_nothing_crossed(patch_series):
    patch_series(make_constant_series(30.0, 0.5, 20.0, 1006.0))
    out = svc.extremes_payload("delhi_ncr", 48)
    assert out["status"] == "no_alerts"
    assert out["alerts"] == []
    assert len(out["checks"]) == 3
    for check in out["checks"]:
        assert check["crossed"] is False


def test_heavy_rain_alert_only_above_64_5(patch_series):
    patch_series(make_constant_series(30.0, 2.6, 20.0, 1006.0))
    out = svc.extremes_payload("delhi_ncr", 48)
    rain = _alerts(out)
    assert "heavy_rain" not in rain
    assert out["checks"][0]["value"] < EXTREME_THRESHOLDS["heavy_rain_mm_24h"]

    patch_series(make_constant_series(30.0, 2.7, 20.0, 1006.0))
    out = svc.extremes_payload("delhi_ncr", 48)
    rain = _alerts(out)
    assert "heavy_rain" in rain
    assert rain["heavy_rain"]["crossed"] is True
    assert rain["heavy_rain"]["threshold"] == EXTREME_THRESHOLDS["heavy_rain_mm_24h"]
    assert rain["heavy_rain"]["value"] >= EXTREME_THRESHOLDS["heavy_rain_mm_24h"]


def test_very_heavy_rain_severity_upgrade(patch_series):
    patch_series(make_constant_series(30.0, 5.0, 20.0, 1006.0))
    out = svc.extremes_payload("delhi_ncr", 48)
    rain = _alerts(out)["heavy_rain"]
    assert rain["severity"] == "very_heavy"
    assert rain["threshold"] == EXTREME_THRESHOLDS["very_heavy_rain_mm_24h"]


def test_heatwave_alert_only_at_or_above_45(patch_series):
    patch_series(make_constant_series(44.5, 0.0, 15.0, 1008.0))
    out = svc.extremes_payload("delhi_ncr", 48)
    assert "heatwave" not in _alerts(out)

    patch_series(make_constant_series(45.0, 0.0, 15.0, 1008.0))
    out = svc.extremes_payload("delhi_ncr", 48)
    heat = _alerts(out)["heatwave"]
    assert heat["value"] == 45.0
    assert heat["threshold"] == EXTREME_THRESHOLDS["heatwave_c"]
    assert heat["validated"] is True


def test_wind_thresholds_squall_then_gale(patch_series):
    patch_series(make_constant_series(30.0, 0.0, 54.0, 1006.0))
    assert "wind_squall" not in _alerts(svc.extremes_payload("delhi_ncr", 48))

    patch_series(make_constant_series(30.0, 0.0, 55.0, 1006.0))
    squall = _alerts(svc.extremes_payload("delhi_ncr", 48))["wind_squall"]
    assert squall["severity"] == "squall"

    patch_series(make_constant_series(30.0, 0.0, 63.0, 1006.0))
    gale = _alerts(svc.extremes_payload("delhi_ncr", 48))["wind_squall"]
    assert gale["severity"] == "gale"
    assert gale["threshold"] == EXTREME_THRESHOLDS["wind_gale_kmh"]


def test_every_alert_is_backed_by_a_crossed_check(patch_series):
    patch_series(make_constant_series(46.0, 6.0, 60.0, 1000.0))
    out = svc.extremes_payload("delhi_ncr", 48)
    assert out["status"] == "alerts"
    crossed = {c["hazard"] for c in out["checks"] if c["crossed"]}
    assert {a["hazard"] for a in out["alerts"]} == crossed
    validated = out["validated"]
    assert validated["temperature"] is True
    assert validated["rainfall"] is True
    assert validated["wind_speed"] is True


def test_data_mode_is_echoed_honestly(monkeypatch, live_series):
    monkeypatch.setattr(svc, "get_live_forecast", lambda lat, lon, **kw: (live_series, "CACHED"))
    out = svc.extremes_payload("delhi_ncr", 48)
    assert out["data_mode"] == "CACHED"
    assert out["simulated"] is False
    assert out["simulate_note"] is None


def test_simulate_flag_is_declared(patch_series):
    patch_series(make_constant_series(46.0, 6.0, 60.0, 1000.0))
    out = svc.extremes_payload("delhi_ncr", 48, simulate=True)
    assert out["simulated"] is True
    assert "illustrative" in out["simulate_note"]


def test_unknown_region_is_service_unavailable():
    with pytest.raises(svc.ServiceUnavailable):
        svc.extremes_payload("not_a_region", 48)
