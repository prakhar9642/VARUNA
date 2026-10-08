"""Multi-model spread / disagreement statistics.

The four NWP centres (GFS, ECMWF IFS, ICON, GEM) are independent centre
forecasts, NOT ensemble members of one system. The correct terminology used
throughout VARUNA is "multi-model forecast spread". These spread features
are central predictors of forecast unreliability.
"""

from __future__ import annotations

import polars as pl

from src.common import VARIABLES, VAR_MODELS, VARIABLE_LABELS

CV_EPSILON = 1e-6


def add_ensemble_stats(df: pl.LazyFrame) -> pl.LazyFrame:
    """Add per-variable multi-model statistics to a lazyframe."""
    lf = df
    for var in VARIABLES:
        label = VARIABLE_LABELS[var]
        fc_cols = [f"fc_{var}_{m}" for m in VAR_MODELS]
        mean_expr = pl.mean_horizontal(fc_cols)
        std_expr = pl.concat_list(*[pl.col(c) for c in fc_cols]).list.std()
        lf = lf.with_columns(
            mean_expr.alias(f"mm_mean_{label}"),
            pl.concat_list(*fc_cols).list.median().alias(f"mm_median_{label}"),
            std_expr.alias(f"mm_std_{label}"),
            pl.min_horizontal(fc_cols).alias(f"mm_min_{label}"),
            pl.max_horizontal(fc_cols).alias(f"mm_max_{label}"),
        )
        lf = lf.with_columns(
            (pl.col(f"mm_max_{label}") - pl.col(f"mm_min_{label}")).alias(
                f"mm_range_{label}"
            ),
        )
        # coefficient of variation |std/mean| with epsilon guard
        lf = lf.with_columns(
            (pl.col(f"mm_std_{label}") / (pl.col(f"mm_mean_{label}").abs() + CV_EPSILON))
            .cast(pl.Float64)
            .alias(f"mm_cv_{label}"),
        )
        # inter-model agreement: mean absolute deviation from the median
        dev_expr = pl.mean_horizontal(
            *[(pl.col(c) - pl.col(f"mm_median_{label}")).abs() for c in fc_cols]
        )
        lf = lf.with_columns(dev_expr.alias(f"mm_disagreement_{label}"))
    return lf


def spread_feature_names() -> list[str]:
    names = []
    for var in VARIABLES:
        label = VARIABLE_LABELS[var]
        for stat in ["mean", "median", "std", "min", "max", "range", "cv",
                     "disagreement"]:
            names.append(f"mm_{stat}_{label}")
    return names