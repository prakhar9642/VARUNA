"""End-to-end feature matrix assembly.

Order of operations (all causation-safe):

1.  core frame   -> data/processed/core.parquet   (errors + consensus)
2.  chronological split on init_time,
3.  bust thresholds estimated from TRAIN CORE ONLY,
4.  bust labels applied to the full core frame,
5.  historical rolling features (issue-time causal),
6.  cyclic + forecast-change + ensemble-spread features,
7.  final feature matrix -> data/processed/features.parquet
"""

from __future__ import annotations

import json
from pathlib import Path

import polars as pl

from src.common import (
    ML_ROOT,
    VARIABLES,
    VARIABLE_LABELS,
    VAR_MODELS,
    get_config,
    get_logger,
)
from src.data.preprocess import build_core_frame, reload_core
from src.features.aggregates import add_ensemble_stats
from src.features.historical import (
    add_historical_features,
    compute_global_prior,
    fill_historical_missing,
)
from src.features.lead_time import add_lead_day
from src.features.temporal import add_cyclic_features, add_forecast_change_features
from src.labels.build_bust_labels import add_bust_labels
from src.labels.bust_definitions import estimate_bust_thresholds
from src.models.split import (
    add_partition_columns,
    compute_time_quantiles,
    spatial_holdout_locations,
    write_split_manifest,
)

logger = get_logger(__name__)

FEATURES_FILE = ML_ROOT / "data" / "processed" / "features.parquet"
ADMIN1_FILE = ML_ROOT / "artifacts" / "admin1_encoding.json"
SCHEMA_FILE = ML_ROOT / "artifacts" / "feature_schema.json"


def _admin1_codes(frame: pl.DataFrame) -> tuple[pl.DataFrame, dict]:
    """Integer-encode admin1 (used only inside the model)."""
    vals = sorted(frame.select("admin1").unique().get_column("admin1").to_list())
    mapping = {v: i for i, v in enumerate(vals)}
    out = frame.with_columns(
        pl.col("admin1").replace(mapping).alias("admin1_code")
    )
    ADMIN1_FILE.write_text(json.dumps(mapping, indent=2), encoding="utf-8")
    return out, mapping


def select_features_and_targets(frame: pl.DataFrame) -> pl.DataFrame:
    """Choose the exact feature set + targets, enforce float32."""
    cfg_f = get_config("features.yaml")["features"]
    cfg_l = get_config("labels.yaml")["labels"]

    features: list[str] = []

    if cfg_f["use_location"]:
        features += ["lat", "lon", "elevation_km", "admin1_code"]
    if cfg_f["use_lead"]:
        features += ["lead_hours", "lead_age_days"]
    if cfg_f["use_temporal_cycles"]:
        features += ["month", "season", "hour_sin", "hour_cos", "doy_sin",
                     "doy_cos", "init_hour_sin", "init_hour_cos",
                     "init_doy_sin", "init_doy_cos"]
    if cfg_f["use_forecast_values"]:
        for var in VARIABLES:
            features += [f"fc_{var}_{m}" for m in VAR_MODELS]
    if cfg_f["use_spread_stats"]:
        for var in VARIABLES:
            label = VARIABLE_LABELS[var]
            features += [
                f"mm_mean_{label}", f"mm_median_{label}", f"mm_std_{label}",
                f"mm_min_{label}", f"mm_max_{label}", f"mm_range_{label}",
                f"mm_cv_{label}", f"mm_disagreement_{label}",
            ]
    if cfg_f["use_forecast_change"]:
        for var in VARIABLES:
            label = VARIABLE_LABELS[var]
            features += [f"chg_{label}_12h", f"chg_{label}_24h", f"chg_{label}_48h"]
            features += [f"run2run_{label}_24h", f"run2run_{label}_48h"]
    if cfg_f["use_historical_error_stats"]:
        for var in VARIABLES:
            label = VARIABLE_LABELS[var]
            for w in cfg_f["historical_windows_days"]:
                features += [
                    f"hist_err_mean_{label}_w{w}",
                    f"hist_err_std_{label}_w{w}",
                    f"hist_bust_rate_{label}_w{w}",
                    f"hist_bias_{label}_w{w}",
                ]

    keep = features + ["loc_id", "valid_time", "init_time", "init_h",
                       "lead_hours", "lead_day", "period", "group", "lat",
                       "lon", "admin1", "elevation_km", "season"]
    targets = [cfg_l["targets"][v] for v in cfg_l["overall_variables"]]
    targets.append(cfg_l["overall_target"])
    keep += targets
    # de-duplicate while preserving order
    seen: set[str] = set()
    keep = [c for c in keep if not (c in seen or seen.add(c))]

    missing = [c for c in keep if c not in frame.columns]
    if missing:
        raise KeyError(f"Missing expected columns: {missing}")

    out = frame.select(keep)
    # float32 for the numeric features to halve memory
    numeric = [c for c in features if out.schema[c] in (
        pl.Float64, pl.Int32, pl.Int64) and c not in ("admin1_code",)]
    out = out.with_columns(
        [pl.col(c).cast(pl.Float32) for c in numeric]
    )
    return out


def build_feature_matrix(
    params: dict | None = None,
    force: bool = False,
) -> pl.DataFrame:
    """Build and cache the full feature matrix."""
    if FEATURES_FILE.exists() and not force and not params:
        logger.info("Reusing cached feature matrix %s", FEATURES_FILE)
        return pl.read_parquet(FEATURES_FILE)

    core = build_core_frame(params=params, force=force) if (params or force) else reload_core()

    # chronological boundaries from FULL core (stable ids used for all)
    boundaries = compute_time_quantiles(core)
    held = spatial_holdout_locations(core)

    # split core -> train-only (excluding spatial holdout) for thresholds
    train_core = core.filter((pl.col("init_h") <= boundaries[0]) & ~pl.col("loc_id").is_in(held))

    # thresholds from TRAINING ONLY
    thresholds = estimate_bust_thresholds(train_core)

    # partition + group columns, labels, features on the full core
    core = add_partition_columns(core, init_boundaries=(boundaries[0], boundaries[1]),
                                 held_locations=held)
    core = add_bust_labels(core, thresholds)
    write_split_manifest((boundaries[0], boundaries[1]), held, core)

    # historical features: causal rolling, then fill cold-start with priors
    # prior is computed from the earliest init cycles only => never future info
    q_cut = int(core.select(pl.col("init_h").quantile(0.25)).to_series()[0])
    prior = compute_global_prior(core, init_before_h=q_cut)
    core = add_historical_features(core)
    core = fill_historical_missing(core, prior)

    # ensemble spread stats
    core = add_ensemble_stats(core.lazy()).collect()

    core = add_lead_day(core.lazy()).collect()
    core = add_cyclic_features(core.lazy()).collect()
    core = add_forecast_change_features(core)

    core, mapping = _admin1_codes(core)
    core = core.with_columns(
        (pl.col("elevation_m") / 1000.0).cast(pl.Float32).alias("elevation_km")
    )

    mat = select_features_and_targets(core)
    mat.write_parquet(FEATURES_FILE)
    logger.info("Saved feature matrix %s (%s rows, %s cols)",
                FEATURES_FILE, mat.height, mat.width)

    target_cols = [f for f in mat.columns if f.startswith("bust") or f.endswith("bust")]
    non_features = set([
        "loc_id", "valid_time", "init_time", "init_h", "lead_hours", "lead_day",
        "period", "group", "lat", "lon", "admin1", "elevation_km", "season"
    ] + target_cols)

    feat_cols = [c for c in mat.columns if c not in non_features]

    schema = {
        "filename": str(FEATURES_FILE),
        "admin1_encoding": mapping,
        "feature_columns": feat_cols,
        "target_columns": target_cols,
        "n_rows": mat.height,
    }
    SCHEMA_FILE.parent.mkdir(parents=True, exist_ok=True)
    SCHEMA_FILE.write_text(json.dumps(schema, indent=2), encoding="utf-8")
    return mat


def reload_features() -> pl.DataFrame:
    return pl.read_parquet(FEATURES_FILE)


def model_feature_columns(path: Path | None = None) -> list[str]:
    p = Path(path) if path else SCHEMA_FILE
    if not p.exists():
        raise FileNotFoundError(f"Feature schema not found: {p}")
    return json.loads(p.read_text(encoding="utf-8"))["feature_columns"]


if __name__ == "__main__":
    m = build_feature_matrix()
    print("rows:", m.height, "cols:", m.width)
    print("groups:", m.group_by("group").agg(pl.len()).sort("group").to_dicts())
    print("features:", len(model_feature_columns()))