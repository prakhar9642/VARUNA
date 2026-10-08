"""Efficient data loading for the VARUNA baseline primary dataset (Polars/PyArrow)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import polars as pl

from src.common import (
    ML_ROOT,
    VARIABLES,
    VAR_MODELS,
    get_config,
    get_logger,
)

logger = get_logger(__name__)


def raw_data_dir() -> Path:
    cfg = get_config("data.yaml")
    return ML_ROOT / cfg["data"]["raw_dir"]


def raw_glob(pattern: str = "d1_mos/*.parquet") -> list[Path]:
    return sorted(raw_data_dir().glob(pattern))


def scan_all(raw_pattern: str = "d1_mos/*.parquet") -> pl.LazyFrame:
    """Lazy scan over all location parquet shards."""
    files = raw_glob(raw_pattern)
    if not files:
        raise FileNotFoundError(
            f"No parquet files found under {raw_data_dir() / 'd1_mos'}. "
            "Run `python -m src.data.download_dataset` first."
        )
    return pl.scan_parquet([str(f) for f in files])


def column_sets() -> dict[str, dict[str, list[str]]]:
    """Return column name sets for forecasts and truths per variable."""
    fc_by_var: dict[str, list[str]] = {}
    truth_by_var: dict[str, str] = {}
    for var in VARIABLES:
        fc_by_var[var] = [f"fc_{var}_{m}" for m in VAR_MODELS]
        truth_by_var[var] = f"truth_{var}"
    return {"forecast": fc_by_var, "truth": truth_by_var}


def make_usable_rows(
    df: pl.DataFrame,
    vars_: list[str] | None = None,
) -> pl.DataFrame:
    """Filter rows to those usable for every selected variable.

    A row is usable when the truth and all four model forecasts for the
    variable are non-null and the row has valid lead/temporal columns.
    """
    use_vars = vars_ or VARIABLES
    cols = column_sets()
    needed: list[str] = ["loc_id", "lat", "lon", "elevation_m", "admin1",
                         "valid_time", "lead_hours", "lead_age_days",
                         "hour_utc", "doy", "month", "chunk_misses"]
    for v in use_vars:
        needed += cols["forecast"][v] + [cols["truth"][v]]
    missing = [c for c in needed if c not in df.columns]
    if missing:
        raise ValueError(f"Missing columns: {missing}")

    lf = df.lazy()
    for v in use_vars:
        cond = pl.all_horizontal(
            [pl.col(c).is_not_null() for c in cols["forecast"][v]]
        ) & pl.col(cols["truth"][v]).is_not_null()
        lf = lf.filter(cond)
    lf = lf.filter(
        pl.col("lead_hours").is_not_null()
        & pl.col("valid_time").is_not_null()
        & pl.col("loc_id").is_not_null()
    )
    return lf.select(needed).collect()


def load_interim_df(name: str) -> pl.DataFrame | None:
    """Load an interim parquet by stem name, if present."""
    path = (ML_ROOT / "data" / "interim" / f"{name}.parquet")
    if not path.exists():
        return None
    logger.info("Loading cached interim %s", path)
    return pl.read_parquet(path)


def save_interim_df(df: pl.DataFrame, name: str) -> Path:
    """Persist an intermediate frame to data/interim."""
    (ML_ROOT / "data" / "interim").mkdir(parents=True, exist_ok=True)
    path = ML_ROOT / "data" / "interim" / f"{name}.parquet"
    df.write_parquet(path)
    logger.info("Saved interim %s (%s rows)", name, df.height)
    return path


def row_count(pattern: str = "d1_mos/*.parquet") -> int:
    return scan_all(pattern).select(pl.len()).collect()[0, 0]


def describe_columns(pattern: str = "d1_mos/*.parquet") -> dict[str, Any]:
    """Compact dtype + null report over the whole corpus."""
    lf = scan_all(pattern)
    schema = lf.collect_schema()
    n = lf.select(pl.len()).collect()[0, 0]
    nulls = lf.select(pl.all().is_null().sum().name.suffix("_null")).collect()
    out: dict[str, Any] = {"row_count": n, "columns": {}}
    for name in schema.names():
        out["columns"][name] = {
            "dtype": str(schema[name]),
            "nulls": int(nulls[f"{name}_null"][0]),
        }
    return out