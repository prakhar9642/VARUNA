"""Model Training Engine for VARUNA Forecast Bust Detection.

Trains XGBoost classifiers for:
1. Overall Forecast Bust (Primary unified model)
2. Variable-Specific Bust Models (Temperature, Precipitation, Wind Speed, Relative Humidity)

Features include multi-model spread, issue-time causal historical performance,
lead time, location, cyclic temporal features, and run-to-run forecast deltas.
Validates early stopping on validation partition and calibrates probabilities.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import polars as pl
import xgboost as xgb

from src.common import ML_ROOT, VARIABLES, VARIABLE_LABELS, get_config, get_logger
from src.features.build import model_feature_columns, reload_features
from src.models.baselines import train_and_eval_baselines
from src.models.calibration import ForecastCalibrator, select_best_calibrator

logger = get_logger(__name__)

MODELS_DIR = ML_ROOT / "models"
EXPERIMENTS_DIR = ML_ROOT / "artifacts" / "experiments"


def get_data_splits(
    frame: pl.DataFrame,
    feature_cols: list[str],
    target_col: str = "overall_bust",
) -> dict[str, Any]:
    """Extract train, validation, temporal test, and spatial holdout numpy arrays."""
    # Ensure splits are sorted and clean
    train_df = frame.filter(pl.col("group") == "train")
    val_df = frame.filter(pl.col("group") == "validation")
    test_temp_df = frame.filter(pl.col("group").is_in(["test_temporal", "test"]))
    test_spat_df = frame.filter(pl.col("group").is_in(["test_spatial", "spatial_holdout"]))

    # If spatial holdout rows are in period 'test', handle cleanly
    if test_spat_df.height == 0:
        # Check if held locations exist in split manifest
        split_manifest_path = ML_ROOT / "artifacts" / "split_manifest.json"
        if split_manifest_path.exists():
            manifest = json.loads(split_manifest_path.read_text(encoding="utf-8"))
            held_locs = manifest.get("spatial_holdout", {}).get("locations", [])
            test_spat_df = frame.filter(pl.col("loc_id").is_in(held_locs))
            test_temp_df = frame.filter(
                pl.col("group").is_in(["test_temporal", "test"]) & ~pl.col("loc_id").is_in(held_locs)
            )

    logger.info(
        "Splits row counts: Train=%d, Val=%d, Test-Temp=%d, Test-Spatial=%d",
        train_df.height,
        val_df.height,
        test_temp_df.height,
        test_spat_df.height,
    )

    X_train = train_df.select(feature_cols).to_numpy()
    y_train = train_df.select(target_col).to_numpy().ravel()

    X_val = val_df.select(feature_cols).to_numpy()
    y_val = val_df.select(target_col).to_numpy().ravel()

    X_test_temp = test_temp_df.select(feature_cols).to_numpy()
    y_test_temp = test_temp_df.select(target_col).to_numpy().ravel()

    X_test_spat = test_spat_df.select(feature_cols).to_numpy() if test_spat_df.height > 0 else np.empty((0, len(feature_cols)))
    y_test_spat = test_spat_df.select(target_col).to_numpy().ravel() if test_spat_df.height > 0 else np.empty(0)

    return {
        "X_train": X_train,
        "y_train": y_train,
        "X_val": X_val,
        "y_val": y_val,
        "X_test_temp": X_test_temp,
        "y_test_temp": y_test_temp,
        "X_test_spat": X_test_spat,
        "y_test_spat": y_test_spat,
        "train_df": train_df,
        "val_df": val_df,
        "test_temp_df": test_temp_df,
        "test_spat_df": test_spat_df,
    }


def train_xgboost_model(
    X_train: np.ndarray,
    y_train: np.ndarray,
    X_val: np.ndarray,
    y_val: np.ndarray,
    feature_names: list[str],
    scale_pos_weight: float | None = None,
    params_override: dict[str, Any] | None = None,
) -> xgb.XGBClassifier:
    """Train XGBoost classifier with early stopping on validation loss."""
    model_cfg = get_config("model.yaml").get("model", {})
    fixed_cfg = model_cfg.get("xgboost_fixed", {})
    hparams = fixed_cfg.copy()

    if params_override:
        hparams.update(params_override)

    # Compute scale_pos_weight if not specified to handle class imbalance
    if scale_pos_weight is None:
        neg_count = np.sum(y_train == 0)
        pos_count = np.sum(y_train == 1)
        if pos_count > 0:
            scale_pos_weight = float(neg_count / pos_count)
            # Moderated weight to avoid over-predicting false alarms
            scale_pos_weight = float(np.clip(np.sqrt(scale_pos_weight), 1.0, 5.0))
        else:
            scale_pos_weight = 1.0

    model = xgb.XGBClassifier(
        n_estimators=int(hparams.get("n_estimators", 300)),
        learning_rate=float(hparams.get("learning_rate", 0.05)),
        max_depth=int(hparams.get("max_depth", 6)),
        min_child_weight=float(hparams.get("min_child_weight", 3)),
        subsample=float(hparams.get("subsample", 0.8)),
        colsample_bytree=float(hparams.get("colsample_bytree", 0.8)),
        scale_pos_weight=scale_pos_weight,
        eval_metric="logloss",
        early_stopping_rounds=int(hparams.get("early_stopping_rounds", 25)),
        tree_method="hist",
        random_state=42,
        n_jobs=-1,
    )

    logger.info("Training XGBoost (scale_pos_weight=%.2f, max_depth=%d)...", scale_pos_weight, model.max_depth)
    model.fit(
        X_train,
        y_train,
        eval_set=[(X_train, y_train), (X_val, y_val)],
        verbose=False,
    )
    logger.info("Training finished. Best iteration: %d", model.best_iteration)
    return model


def run_training_pipeline(
    feature_matrix: pl.DataFrame | None = None,
    target_col: str = "overall_bust",
    train_variable_models: bool = True,
) -> dict[str, Any]:
    """Execute complete model training, baseline benchmarking, calibration, and serialization."""
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    EXPERIMENTS_DIR.mkdir(parents=True, exist_ok=True)

    frame = feature_matrix if feature_matrix is not None else reload_features()
    feature_cols = model_feature_columns()

    logger.info("Feature count: %d, Target: %s", len(feature_cols), target_col)

    # 1. Extract splits
    splits = get_data_splits(frame, feature_cols, target_col)

    # 2. Train and evaluate Baselines on Validation Set
    logger.info("Evaluating baselines on validation split...")
    baseline_results = train_and_eval_baselines(
        splits["X_train"],
        splits["y_train"],
        splits["X_val"],
        feature_cols,
    )

    # 3. Train Primary Overall XGBoost Model
    primary_model = train_xgboost_model(
        splits["X_train"],
        splits["y_train"],
        splits["X_val"],
        splits["y_val"],
        feature_cols,
    )

    # 4. Calibrate Probabilities using Validation Split
    val_raw_probs = primary_model.predict_proba(splits["X_val"])[:, 1]
    calibrator, calib_info = select_best_calibrator(val_raw_probs, splits["y_val"])

    # 5. Train Variable-Specific Models (if requested)
    var_models: dict[str, Any] = {}
    if train_variable_models:
        cfg_labels = get_config("labels.yaml")["labels"]["targets"]
        for var in VARIABLES:
            var_target = cfg_labels[var]
            if var_target in frame.columns:
                logger.info("Training variable-specific model for %s (target: %s)...", var, var_target)
                var_splits = get_data_splits(frame, feature_cols, var_target)
                v_model = train_xgboost_model(
                    var_splits["X_train"],
                    var_splits["y_train"],
                    var_splits["X_val"],
                    var_splits["y_val"],
                    feature_cols,
                )
                v_raw_val = v_model.predict_proba(var_splits["X_val"])[:, 1]
                v_calib, _ = select_best_calibrator(v_raw_val, var_splits["y_val"])
                var_models[var] = {
                    "target": var_target,
                    "model": v_model,
                    "calibrator": v_calib,
                }

    # 6. Save Artifacts and Models
    model_path = MODELS_DIR / "varuna_bust_model.joblib"
    calib_path = MODELS_DIR / "varuna_calibrator.joblib"
    var_models_path = MODELS_DIR / "varuna_variable_models.joblib"
    metadata_path = MODELS_DIR / "model_metadata.json"

    joblib.dump(primary_model, model_path)
    calibrator.save(calib_path)
    if var_models:
        joblib.dump(var_models, var_models_path)

    # Compute Feature Importances
    importances = primary_model.feature_importances_
    sorted_idx = np.argsort(importances)[::-1]
    feature_importance_list = [
        {"feature": feature_cols[i], "importance": float(importances[i])}
        for i in sorted_idx
    ]

    # Model Metadata
    metadata = {
        "model_name": "varuna_xgboost_bust_detector",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "primary_target": target_col,
        "n_features": len(feature_cols),
        "features": feature_cols,
        "best_iteration": int(primary_model.best_iteration),
        "calibration_method": calib_info["best_method"],
        "calibration_comparison": calib_info["comparison"],
        "top_features": feature_importance_list[:20],
        "training_rows": int(len(splits["X_train"])),
        "validation_rows": int(len(splits["X_val"])),
        "temporal_test_rows": int(len(splits["X_test_temp"])),
        "spatial_holdout_rows": int(len(splits["X_test_spat"])),
    }
    metadata_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    logger.info("Saved model metadata to %s", metadata_path)

    # Save Experiment Record
    exp_id = f"exp_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}"
    exp_record_path = EXPERIMENTS_DIR / f"{exp_id}.json"
    exp_record = {
        "experiment_id": exp_id,
        "metadata": metadata,
        "feature_importance_top10": feature_importance_list[:10],
    }
    exp_record_path.write_text(json.dumps(exp_record, indent=2), encoding="utf-8")

    return {
        "primary_model": primary_model,
        "calibrator": calibrator,
        "var_models": var_models,
        "splits": splits,
        "metadata": metadata,
        "baselines": baseline_results,
        "feature_cols": feature_cols,
    }


if __name__ == "__main__":
    results = run_training_pipeline()
    print("Training finished successfully!")
    print(f"Top 5 features: {results['metadata']['top_features'][:5]}")
