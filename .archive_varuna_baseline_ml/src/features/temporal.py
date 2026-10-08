"""Temporal, cyclical and forecast-change features (all causally safe).

Every feature in this module is fully known at forecast issue time:

- cyclic transforms of hour-of-day / day-of-year (causal, deterministic);
- "within-run" forecast change: fc at valid time VT minus fc at VT-W within
  the SAME forecast run (both values issued at init time);
- "run-to-run" forecast change: fc for valid time VT from this run minus the
  fc for the very same VT from the previous day's run (issued strictly before
  this run's issue time).

No realized weather is used anywhere here.
"""

from __future__ import annotations

import math

import polars as pl

from src.common import VARIABLES, VARIABLE_LABELS, get_config

CHANGE_WINDOWS = [12, 24, 48]
RUN_WINDOWS = [24, 48]


def add_cyclic_features(df: pl.LazyFrame) -> pl.LazyFrame:
    """Add sin/cos encodings of hour-of-day and day-of-year (valid + init)."""
    init_dt = pl.from_epoch(pl.col("init_h"), time_unit="s").dt.replace_time_zone("UTC")
    lf = df.with_columns(
        (2 * math.pi * pl.col("hour_utc") / 24).sin().alias("hour_sin"),
        (2 * math.pi * pl.col("hour_utc") / 24).cos().alias("hour_cos"),
        (2 * math.pi * pl.col("doy") / 365.25).sin().alias("doy_sin"),
        (2 * math.pi * pl.col("doy") / 365.25).cos().alias("doy_cos"),
        ((pl.col("init_h") // 3600 % 24).cast(pl.Float64)).alias("init_hour"),
        init_dt.dt.ordinal_day().cast(pl.Float64).alias("init_doy"),
    ).with_columns(
        (2 * math.pi * pl.col("init_hour") / 24).sin().alias("init_hour_sin"),
        (2 * math.pi * pl.col("init_hour") / 24).cos().alias("init_hour_cos"),
        (2 * math.pi * pl.col("init_doy") / 365.25).sin().alias("init_doy_sin"),
        (2 * math.pi * pl.col("init_doy") / 365.25).cos().alias("init_doy_cos"),
    ).drop(["init_hour", "init_doy"])
    return lf.with_columns(
        pl.when(pl.col("month").is_in([3, 4, 5])).then(pl.lit("spring"))
        .when(pl.col("month").is_in([6, 7, 8])).then(pl.lit("summer"))
        .when(pl.col("month").is_in([9, 10, 11])).then(pl.lit("autumn"))
        .otherwise(pl.lit("winter"))
        .alias("season")
    )


def add_forecast_change_features(core: pl.DataFrame) -> pl.DataFrame:
    """Add within-run and run-to-run forecast change features (eager).

    Within-run change:  chg_{label}_{w}h at lead L equals
        fc_mean(L) - fc_mean(L - w)
    within the SAME run (same init). Definitional shift within (loc, init)
    ordered by lead hours: because leads are contiguous hourly rows, a shift
    of w rows is exactly the forecast w hours earlier in the run. Rows with
    L < w are null (no earlier forecast exists in the run).

    Run-to-run change:  run2run_{label}_{w}h at valid time VT equals
        fc_mean(VT from this run) - fc_mean(VT from the run w hours earlier)
    Within a (loc, valid_time) group, the earlier cyce's forecast of VT is the
    row with w more lead hours, i.e. a shift of -w.
    """
    if core is None or core.height == 0:
        return core

    # pass 1: within-run changes, sorted by (loc, init, lead ASC).
    # shift(+w) in this order = forecast w hours earlier in the same run.
    lf = core.sort(["loc_id", "init_h", "lead_hours"]).lazy()
    for var in VARIABLES:
        label = VARIABLE_LABELS[var]
        col = f"fc_{var}_mean"
        for w in CHANGE_WINDOWS:
            lf = lf.with_columns(
                (pl.col(col) - pl.col(col).shift(w))
                .over(["loc_id", "init_h"])
                .alias(f"chg_{label}_{w}h")
            )

    changed = lf.collect()

    # pass 2: run-to-run changes, sorted by (loc, valid_time, lead ASC).
    # Inits are daily (00Z), so within a (loc, valid_time) group rows are
    # spaced 24h in lead. The previous cycle's forecast of the same valid time
    # is therefore the NEXT row (shift -1 for 24h, -2 for 48h).
    rlf = changed.sort(["loc_id", "valid_time", "lead_hours"]).lazy()
    for var in VARIABLES:
        label = VARIABLE_LABELS[var]
        col = f"fc_{var}_mean"
        for w in RUN_WINDOWS:
            step = w // 24
            rlf = rlf.with_columns(
                (pl.col(col) - pl.col(col).shift(-step))
                .over(["loc_id", "valid_time"])
                .alias(f"run2run_{label}_{w}h")
            )

    return rlf.collect()


def temporal_feature_names() -> list[str]:
    names = ["hour_sin", "hour_cos", "doy_sin", "doy_cos",
             "init_hour_sin", "init_hour_cos", "init_doy_sin", "init_doy_cos"]
    for var in VARIABLES:
        label = VARIABLE_LABELS[var]
        for w in CHANGE_WINDOWS:
            names.append(f"chg_{label}_{w}h")
        for w in RUN_WINDOWS:
            names.append(f"run2run_{label}_{w}h")
    return names