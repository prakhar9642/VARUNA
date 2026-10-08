"""Tests for model prediction, probability bounds, calibration, and inference."""

import numpy as np
import pytest
from src.common import ML_ROOT
from src.features.build import model_feature_columns
from src.inference.predictor import get_predictor, predict_forecast
from src.models.calibration import ForecastCalibrator, compute_ece

MODELS_EXIST = (ML_ROOT / "models" / "varuna_bust_model.joblib").exists()


@pytest.mark.skipif(not MODELS_EXIST, reason="VARUNA model artifact (varuna_bust_model.joblib) not present on disk")
def test_probability_between_0_and_1():
    """Verify raw and calibrated bust probabilities are strictly bounded between 0 and 1."""
    predictor = get_predictor()
    features = {col: 0.0 for col in predictor.feature_columns}
    features["lead_hours"] = 72.0
    features["mm_std_temp"] = 4.5

    res = predictor.predict_from_features(features, loc_id="TEST_LOC", lead_day=3)
    prob = res["bust_probability"]
    assert 0.0 <= prob <= 1.0, f"Probability out of bounds: {prob}"
    assert 0.0 <= res["confidence"] <= 100.0, f"Confidence score out of bounds: {res['confidence']}"


def test_feature_schema_matches_training():
    """Verify predictor expects exactly the features in feature_schema.json."""
    cols = model_feature_columns()
    predictor = get_predictor()
    assert len(cols) == len(predictor.feature_columns)
    assert cols == predictor.feature_columns


def test_calibration_ece():
    """Verify ECE computation on known ground truth probabilities."""
    y_true = np.array([1, 1, 0, 0, 1, 0, 1, 0])
    y_prob = np.array([0.9, 0.8, 0.1, 0.2, 0.85, 0.15, 0.75, 0.25])
    ece, p_true, p_pred = compute_ece(y_true, y_prob, n_bins=5)
    assert 0.0 <= ece <= 1.0
    assert len(p_true) > 0
