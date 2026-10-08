"""Preprocessing: build the clean flat "core" frame from raw shards.

Output: data/processed/core.parquet — one row per (location, valid time,
lead), restricted to rows usable for all four target variables (all forecast
model values + ERA5 truth present). Adds init_time, lead_day and all
per-model errors + consensus errors.
"""

from __future__ import annotations

import logging
from pathlib import Path

import polars as pl

from src.common import ML_ROOT, VARIABLES, get_config, get_logger
from src.data.load import column_sets, scan_all, save_interim_df
from src.features.errors import add_consensus, add_consensus_median, per_model_errors
from src.features.lead_time import add_init_time, add_lead_day

logger = get_logger(__name__)

CORE_FILE = ML_ROOT / "data" / "processed" / "core.parquet"


def build_core_frame(params: dict | None = None, force: bool = False) -> pl.DataFrame:
    """Build (or reload cached) core frame.

    Parameters
    ----------
    params : optional overrides, e.g. {"smoke_fraction": 0.01}
    force : force rebuild from raw shards
    """
    if CORE_FILE.exists() and not params and not force:
        logger.info("Reusing cached core frame %s", CORE_FILE)
        return pl.read_parquet(CORE_FILE)

    lf = scan_all()
    cols = column_sets()

    needed: list[str] = [
        "loc_id", "lat", "lon", "elevation_m", "admin1",
        "valid_time", "lead_hours", "lead_age_days", "hour_utc", "doy", "month",
    ]
    for var in VARIABLES:
        needed += cols["forecast"][var] + [cols["truth"][var]]
    lf = lf.select(
        [pl.col(c) for c in needed if c in lf.collect_schema().names()]
    )

    # usable rows: all 4 forecasts + truth present for every variable
    for var in VARIABLES:
        cond = pl.all_horizontal(
            [pl.col(c).is_not_null() for c in cols["forecast"][var]]
        ) & pl.col(cols["truth"][var]).is_not_null()
        lf = lf.filter(cond)

    # coerce ints to float64 for uniform arithmetic
    lf = lf.with_columns(
        [pl.col("fc_relative_humidity_2m_gfs_seamless").cast(pl.Float64)]
    ).with_columns(
        pl.col("truth_relative_humidity_2m").cast(pl.Float64)
    ) if True else lf

    if params and params.get("smoke_fraction"):
        frac = float(params["smoke_fraction"])
        logger.info("Smoke mode: keeping %s of rows", frac)
        keep_ids = (
            lf.select("loc_id").unique()
            .collect()
            .get_column("loc_id")
            .sample(fraction=frac, seed=1, shuffle=True)
            .to_list()
        )
        lf = lf.filter(pl.col("loc_id").is_in(keep_ids))

    lf = add_init_time(lf)
    lf = add_lead_day(lf)
    lf = add_consensus(lf)
    lf = add_consensus_median(lf)
    lf = per_model_errors(lf)

    frame = lf.collect(streaming=True)
    logger.info("Core frame: %s rows, %s cols", frame.height, frame.width)
    CORE_FILE.parent.mkdir(parents=True, exist_ok=True)
    frame.write_parquet(CORE_FILE)
    logger.info("Saved %s", CORE_FILE)
    return frame


def reload_core() -> pl.DataFrame:
    return pl.read_parquet(CORE_FILE)


if __name__ == "__main__":
    frame = build_core_frame()
    print("rows:", frame.height, "cols:", frame.width)
    print(frame.select(["loc_id", "valid_time", "init_time", "lead_hours",
                        "lead_age_days", "lead_day"]).head(5))