"""Tests for FastAPI endpoints, request/response validation, and batch grid inference."""

import pytest
from fastapi.testclient import TestClient
from src.common import ML_ROOT
from src.features.build import model_feature_columns
from src.inference.api import app

client = TestClient(app)
MODELS_EXIST = (ML_ROOT / "models" / "varuna_bust_model.joblib").exists()


def test_health_endpoint():
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["service"] == "varuna-baseline-inference-api"
    assert "models_ready" in data


@pytest.mark.skipif(not MODELS_EXIST, reason="VARUNA model artifact (varuna_bust_model.joblib) not present on disk")
def test_predict_endpoint():
    cols = model_feature_columns()
    payload = {
        "loc_id": "LOC_1253405",
        "lead_day": 3,
        "lead_hours": 72,
        "forecast_features": {c: 0.0 for c in cols},
    }
    response = client.post("/predict", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["project"] == "VARUNA"
    assert "bust_probability" in data
    assert "confidence" in data
    assert "risk_category" in data
    assert isinstance(data["reasons"], list)
    assert isinstance(data["stabilizers"], list)


@pytest.mark.skipif(not MODELS_EXIST, reason="VARUNA model artifact (varuna_bust_model.joblib) not present on disk")
def test_predict_grid_endpoint():
    cols = model_feature_columns()
    payload = {
        "lead_day": 4,
        "points": [
            {
                "loc_id": "LOC_DELHI",
                "lat": 28.61,
                "lon": 77.20,
                "admin1": "Delhi",
                "lead_day": 4,
                "forecast_features": {c: 0.0 for c in cols},
            },
            {
                "loc_id": "LOC_MUMBAI",
                "lat": 19.07,
                "lon": 72.87,
                "admin1": "Maharashtra",
                "lead_day": 4,
                "forecast_features": {c: 0.0 for c in cols},
            }
        ]
    }
    response = client.post("/predict/grid", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["lead_day"] == 4
    assert data["total_points"] == 2
    assert len(data["grid_predictions"]) == 2
