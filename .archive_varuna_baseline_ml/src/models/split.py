"""Chronological train/validation/test split + spatial (unseen-location) holdout.

No random time shuffling is ever used. Frames are partitioned on forecast
ISSUE time (init_time), which is the only causally correct split key: at
training time the model is never shown forecasts issued after the boundary.

Spatial holdout: a fixed seed samples ~20% of locations, which never appear
in any training/validation row. Evaluation then reports both
    - temporal test  (held-out time, seen locations)
    - spatial test   (unseen locations, all time)
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import polars as pl

from src.common import ML_ROOT, get_config, get_logger

logger = get_logger(__name__)


def datetime_str(v) -> str:
    if isinstance(v, datetime):
        return v.isoformat()
    return str(v)


def compute_time_quantiles(frame: pl.DataFrame) -> list[int]:
    """Return the init_h boundary values for the three partitions."""
    cfg = get_config("data.yaml")["split"]
    ts = frame.select(pl.col("init_h")).sort("init_h").to_series()
    n = ts.len()
    q1 = float(cfg["train_fraction"])
    q2 = q1 + float(cfg["validation_fraction"])
    b1 = ts[int((n - 1) * q1)]
    b2 = ts[int((n - 1) * q2)]
    return [int(b1), int(b2)]


def split_chronological(frame: pl.DataFrame) -> dict[str, pl.DataFrame]:
    """Split on init_h quantiles; returns {"train", "validation", "test"}."""
    b1, b2 = compute_time_quantiles(frame)
    parts = {
        "train": frame.filter(pl.col("init_h") <= b1),
        "validation": frame.filter((pl.col("init_h") > b1) & (pl.col("init_h") <= b2)),
        "test": frame.filter(pl.col("init_h") > b2),
    }
    for k, v in parts.items():
        logger.info("%s: %s rows, init %s..%s", k, v.height,
                    v["init_h"].min(), v["init_h"].max())
    return parts


def spatial_holdout_locations(frame: pl.DataFrame) -> list[str]:
    """Deterministically sample held-out locations."""
    cfg = get_config("data.yaml")["split"]
    seed = int(cfg["spatial_holdout_seed"])
    frac = float(cfg["spatial_holdout_fraction"])
    locs = frame.select("loc_id").unique().get_column("loc_id")
    held = locs.sample(fraction=frac, shuffle=True, seed=seed).to_list()
    logger.info("Spatial holdout: %s of %s locations", len(held), locs.len())
    return held


def add_partition_columns(
    frame: pl.DataFrame,
    init_boundaries: tuple[int, int] | None = None,
    held_locations: list[str] | None = None,
) -> pl.DataFrame:
    """Attach partition/group columns for downstream analysis.

    group in {train, validation, test_temporal, test_spatial}
    """
    if init_boundaries is None:
        b1, b2 = compute_time_quantiles(frame)
    else:
        b1, b2 = init_boundaries
    if held_locations is None:
        held_locations = spatial_holdout_locations(frame)

    return frame.with_columns(
        pl.when(pl.col("init_h") <= b1).then(pl.lit("train"))
        .when((pl.col("init_h") > b1) & (pl.col("init_h") <= b2))
        .then(pl.lit("validation"))
        .otherwise(pl.lit("test"))
        .alias("period")
    ).with_columns(
        pl.when(
            pl.col("loc_id").is_in(held_locations)
        ).then(pl.lit("test_spatial"))
        .when(
            (pl.col("period") == "test") & ~pl.col("loc_id").is_in(held_locations)
        ).then(pl.lit("test_temporal"))
        .otherwise(pl.col("period"))
        .alias("group")
    )


def write_split_manifest(
    boundaries: tuple[int, int],
    held_locations: list[str],
    frame: pl.DataFrame,
) -> Path:
    """Persist split boundaries + held-out locations to artifacts."""
    cfg = get_config("data.yaml")["split"]
    b1, b2 = boundaries

    def to_utc_dt(h: int) -> str:
        return datetime.fromtimestamp(h, tz=timezone.utc).isoformat()

    manifest = {
        "split_key": cfg["split_epoch_key"],
        "fractions": {
            "train": cfg["train_fraction"],
            "validation": cfg["validation_fraction"],
            "test": cfg["test_fraction"],
        },
        "boundaries_init_h": {"train_end": b1, "validation_end": b2},
        "boundaries_utc": {
            "train_start": to_utc_dt(int(frame["init_h"].min())),
            "train_end": to_utc_dt(b1),
            "validation_start": to_utc_dt(b1),
            "validation_end": to_utc_dt(b2),
            "test_start": to_utc_dt(b2),
            "test_end": to_utc_dt(int(frame["init_h"].max())),
        },
        "spatial_holdout": {
            "fraction": cfg["spatial_holdout_fraction"],
            "seed": cfg["spatial_holdout_seed"],
            "n_locations": len(held_locations),
            "locations": held_locations,
        },
    }
    path = ML_ROOT / "artifacts" / "split_manifest.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    loc_path = ML_ROOT / "artifacts" / "spatial_holdout_locations.json"
    loc_path.write_text(json.dumps(
        {"n": len(held_locations), "locations": held_locations}, indent=2),
        encoding="utf-8")
    logger.info("Wrote %s and %s", path, loc_path)
    return path