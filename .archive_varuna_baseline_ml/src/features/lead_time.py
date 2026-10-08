"""Lead-time handling and Day 1-8 mapping.

The dataset is verified to use  init_time = valid_time - lead_hours  with
daily 00Z init cycles. lead_age_days is byte-for-byte consistent with
floor(lead_hours / 24), i.e. it already is the 0-based "day" index.
Day N (1-based) maps as follows (config-driven offset):
    0-23h  -> Day 1   lead_age_days=0
    24-47h -> Day 2   lead_age_days=1
    48-71h -> Day 3   lead_age_days=2
    72-95h -> Day 4   lead_age_days=3
    96-119h-> Day 5   lead_age_days=4
    120-143h->Day 6   lead_age_days=5
    144-167h->Day 7   lead_age_days=6
    168-191h->Day 8   lead_age_days=7
"""

from __future__ import annotations

import polars as pl

from src.common import get_config

MAX_LEAD_HOURS = 191  # verified from the corpus


def lead_day_from_hours(lead_hours: pl.Expr | int) -> pl.Expr | int:
    """1-based lead day: floor(lead_hours / 24) + 1."""
    offset = get_config("features.yaml")["features"]["lead_day_offset"]
    if isinstance(lead_hours, pl.Expr):
        return (lead_hours // 24) + offset
    return (lead_hours // 24) + offset


def lead_day_series(days0: pl.Expr | int) -> pl.Expr | int:
    """Map a 0-based lead index (lead_age_days) to 1-based Day."""
    offset = get_config("features.yaml")["features"]["lead_day_offset"]
    if isinstance(days0, pl.Expr):
        return days0 + offset
    return days0 + offset


def add_init_time(
    df: pl.LazyFrame,
    valid_col: str = "valid_time",
    lead_col: str = "lead_hours",
) -> pl.LazyFrame:
    """Add init_time (datetime) and init_h (epoch hours) to a frame."""
    return df.with_columns(
        (
            pl.col(valid_col).dt.epoch("s") - pl.col(lead_col) * 3600
        ).alias("init_h"),
    ).with_columns(
        pl.from_epoch(pl.col("init_h"), time_unit="s")
        .dt.replace_time_zone("UTC")
        .alias("init_time"),
    )


def add_lead_day(df: pl.LazyFrame, days0_col: str = "lead_age_days") -> pl.LazyFrame:
    """Add lead_day column from lead_age_days or lead_hours."""
    schema_names = df.collect_schema().names()
    if days0_col in schema_names:
        return df.with_columns(lead_day_series(pl.col(days0_col)).alias("lead_day"))
    elif "lead_hours" in schema_names:
        return df.with_columns(lead_day_from_hours(pl.col("lead_hours")).alias("lead_day"))
    return df.with_columns(lead_day_series(pl.col(days0_col)).alias("lead_day"))


VALID_LEADS = list(range(0, MAX_LEAD_HOURS + 1))