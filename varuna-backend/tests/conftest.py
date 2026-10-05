from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import tempfile
from app.providers.cache import ResponseCache
import app.providers.cache as _cache_mod
import app.providers.open_meteo as _om_mod

_test_cache_dir = tempfile.TemporaryDirectory()
_test_db = Path(_test_cache_dir.name) / "test_varuna_cache.sqlite3"
_test_cache = ResponseCache(db_path=_test_db)
_cache_mod.CACHE = _test_cache
_om_mod.CACHE = _test_cache


def pytest_unconfigure(config):
    _test_cache.close()
    try:
        _test_cache_dir.cleanup()
    except Exception:
        pass


from fastapi.testclient import TestClient

from app.main import app

MODEL_KEYS = ["ecmwf_ifs", "ecmwf_aifs", "ncep_gfs", "dwd_icon"]
SLUGS = {
    "ecmwf_ifs": "ecmwf_ifs025",
    "ecmwf_aifs": "ecmwf_aifs025_single",
    "ncep_gfs": "gfs_seamless",
    "dwd_icon": "icon_seamless",
}
VARIABLES = ["temperature", "rainfall", "wind_speed", "pressure"]


@pytest.fixture()
def client() -> TestClient:
    return TestClient(app, raise_server_exceptions=False)


def make_live_series(n_hours: int = 96, start: datetime | None = None,
                     null_model_at: dict | None = None) -> dict:
    start = start or datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    times = [(start + timedelta(hours=i)).strftime("%Y-%m-%dT%H:%M") for i in range(n_hours)]
    models = {}
    for mi, key in enumerate(MODEL_KEYS):
        models[key] = {}
        for vi, var in enumerate(VARIABLES):
            series = []
            for i in range(n_hours):
                val = 20.0 + mi + vi + (i % 7) * 0.5
                if var == "rainfall":
                    val = (i % 13) * 1.7 + mi * 3.0
                if var == "wind_speed":
                    val = 20.0 + mi * 2.0 + (i % 5)
                if var == "pressure":
                    val = 1006.0 - mi
                if null_model_at and null_model_at.get(key) == i:
                    val = None
                series.append(val)
            models[key][var] = series
    return {
        "time": times,
        "elevation_m": 216.0,
        "models": models,
        "requested_coordinates": {"lat": 28.61, "lon": 77.21},
        "resolved_coordinates": {"lat": 28.5, "lon": 77.25},
    }


@pytest.fixture()
def live_series() -> dict:
    return make_live_series()
