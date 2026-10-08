"""Tests for bust label construction and threshold estimation."""

import polars as pl
import pytest
from src.labels.bust_definitions import estimate_bust_thresholds, load_bust_thresholds
from src.labels.build_bust_labels import add_bust_labels


def test_bust_label_uses_truth_only_for_target():
    """Verify truth error is used to calculate target, but truth itself is not in feature columns."""
    toy_df = pl.DataFrame({
        "loc_id": ["LOC1", "LOC1"],
        "lead_day": [1, 2],
        "err_temp_consensus": [5.5, 1.2],
        "err_precip_consensus": [15.0, 0.0],
        "err_wind_consensus": [2.0, 1.0],
        "err_humidity_consensus": [10.0, 5.0],
    })
    thresholds = {
        "thresholds": {
            "temperature_2m": {"1": 4.0, "2": 4.5},
            "precipitation": {"1": 10.0, "2": 12.0},
            "wind_speed_10m": {"1": 3.0, "2": 3.5},
            "relative_humidity_2m": {"1": 15.0, "2": 18.0},
        }
    }
    labelled = add_bust_labels(toy_df, thresholds)
    assert "bust_temperature_2m" in labelled.columns
    assert "overall_bust" in labelled.columns
    # Row 0: err_temp > 4.0 -> bust_temperature_2m = 1, overall_bust = 1
    assert labelled["bust_temperature_2m"][0] == 1
    assert labelled["overall_bust"][0] == 1
    # Row 1: err_temp <= 4.5 -> bust_temperature_2m = 0, overall_bust = 0
    assert labelled["bust_temperature_2m"][1] == 0
    assert labelled["overall_bust"][1] == 0
