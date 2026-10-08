"""Forecast error computation and multi-model aggregation.

Errors are computed per model and for the multi-model consensus (the mean of
the four NWP centres). These are exact retrospective calculations using the
ERA5-Land truth; they feed both the bust labels and the historical error
features. Model-feature frames must never include truth as a feature.
"""

from __future__ import annotations

import polars as pl

from src.common import VARIABLES, VAR_MODELS, VARIABLE_LABELS, MODEL_LABELS, get_config


def per_model_errors(df: pl.LazyFrame) -> pl.LazyFrame:
    """Add per-model absolute error columns for every variable.

    error_{label}_{model_label} = |fc_{var}_{model} - truth_{var}|
    bias_{label}_{model_label}  = fc_{var}_{model} - truth_{var}
    """
    lf = df
    for var in VARIABLES:
        label = VARIABLE_LABELS[var]
        tcol = f"truth_{var}"
        for m in VAR_MODELS:
            fcol = f"fc_{var}_{m}"
            ml = MODEL_LABELS[m]
            lf = lf.with_columns(
                (pl.col(fcol) - pl.col(tcol)).alias(f"bias_{label}_{ml}"),
                (pl.col(fcol) - pl.col(tcol)).abs().alias(f"err_{label}_{ml}"),
            )
    return lf


def add_consensus(df: pl.LazyFrame) -> pl.LazyFrame:
    """Add the multi-model consensus (mean) per variable and its errors."""
    lf = df
    for var in VARIABLES:
        label = VARIABLE_LABELS[var]
        fc_cols = [f"fc_{var}_{m}" for m in VAR_MODELS]
        mean_col = f"fc_{var}_mean"
        lf = lf.with_columns(pl.mean_horizontal(fc_cols).alias(mean_col))
        tcol = f"truth_{var}"
        lf = lf.with_columns(
            (pl.col(mean_col) - pl.col(tcol)).abs().alias(f"err_{label}_consensus"),
            (pl.col(mean_col) - pl.col(tcol)).alias(f"bias_{label}_consensus"),
        )
    return lf


def add_consensus_median(df: pl.LazyFrame) -> pl.LazyFrame:
    """Median-based consensus (more robust for skewed distributions)."""
    lf = df
    for var in VARIABLES:
        fc_cols = [f"fc_{var}_{m}" for m in VAR_MODELS]
        lf = lf.with_columns(
            pl.concat_list(*fc_cols).list.median().alias(f"fc_{var}_median")
        )
    return lf


def compute_error_feature_frame(
    core_path: str | None = None,
) -> pl.DataFrame:
    """Full eager error computation entry point used by preprocessing."""
    raise NotImplementedError("Moved to src.data.preprocess.build_core_frame")