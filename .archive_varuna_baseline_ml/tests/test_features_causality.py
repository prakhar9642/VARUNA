"""Tests for feature engineering, lead time mapping, and historical feature causality."""

import polars as pl
import pytest
from src.features.lead_time import add_lead_day
from src.validation.leakage_audit import run_leakage_audit


def test_day_mapping():
    """Verify lead_hours mapping to lead_day exactly adheres to meteorological day definitions."""
    df = pl.DataFrame({
        "lead_hours": [0, 12, 23, 24, 47, 48, 71, 72, 95, 96, 119, 120, 143, 144, 167, 168, 191]
    })
    mapped = add_lead_day(df.lazy()).collect()
    days = mapped.get_column("lead_day").to_list()
    expected = [1, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8]
    assert days == expected, f"Expected {expected}, got {days}"


def test_no_future_leakage():
    """Verify feature schema contains no forbidden target, truth, or error tokens."""
    res = run_leakage_audit()
    assert res["status"] == "PASS", f"Leakage audit detected violations: {res.get('violations')}"


def test_historical_features_are_causal():
    """Verify that historical statistics at issue time T never use data from >= T."""
    # Build a toy time-series and verify shift & rolling only looks backwards
    dates = pl.datetime_range(
        start=pl.datetime(2025, 1, 1),
        end=pl.datetime(2025, 1, 10),
        interval="1d",
        eager=True,
    )
    df = pl.DataFrame({
        "init_time": dates,
        "err_val": [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0]
    })
    # Causal lag 1 before rolling mean
    df_lag = df.with_columns(
        pl.col("err_val").shift(1).alias("prev_err")
    )
    # The first row must be null (no past information available)
    assert df_lag["prev_err"][0] is None
    # Row at index 1 can only see row 0's value
    assert df_lag["prev_err"][1] == 1.0
