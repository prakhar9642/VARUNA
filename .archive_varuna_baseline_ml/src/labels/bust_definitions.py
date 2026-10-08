"""Bust threshold estimation.

Thresholds are estimated from the TRAINING partition only. Never from
validation or test. They are stored in artifacts/bust_thresholds.json and
loaded by the label builder + inference pipeline (no retraining at inference).
"""

from __future__ import annotations

import json
from pathlib import Path

import polars as pl

from src.common import (
    ML_ROOT,
    VARIABLES,
    VARIABLE_LABELS,
    get_config,
    get_logger,
)

logger = get_logger(__name__)


def estimate_bust_thresholds(train: pl.DataFrame) -> dict:
    """Estimate per-(variable, lead_day) bust thresholds from training rows.

    Parameters
    ----------
    train : training core/frame with lead_day and err_<label>_consensus cols.

    Returns
    -------
    dict with structure
        {"mode": "per_variable_per_lead_day",
         "percentile": 0.90,
         "thresholds": {variable: {lead_day: float}}, ...}
    """
    cfg = get_config("labels.yaml")["labels"]
    pct = float(cfg["bust_percentile"])
    min_rows = int(cfg["min_rows_per_cell"])
    thresholds: dict[str, dict[str, float]] = {}
    for var in VARIABLES:
        label = VARIABLE_LABELS[var]
        col = f"err_{label}_consensus"
        q = train.lazy().group_by("lead_day").agg(
            pl.col(col).quantile(pct).alias("thr"), pl.len().alias("n")
        ).collect()
        ts = {
            str(int(r["lead_day"])): float(r["thr"])
            for r in q.to_dicts()
            if int(r["n"]) >= min_rows
        }
        thresholds[var] = ts

    out = {
        "mode": cfg["threshold_mode"],
        "error_metric": cfg["error_metric"],
        "percentile": pct,
        "estimated_from": "TRAINING ONLY",
        "thresholds": thresholds,
    }
    path = ML_ROOT / "artifacts" / "bust_thresholds.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, indent=2), encoding="utf-8")
    logger.info("Estimated bust thresholds, saved %s", path)
    return out


def load_bust_thresholds(path: str | Path | None = None) -> dict:
    path = Path(path) if path else ML_ROOT / "artifacts" / "bust_thresholds.json"
    if not path.exists():
        raise FileNotFoundError(
            f"Bust thresholds not found at {path}. Run threshold estimation "
            "on TRAINING data first."
        )
    return json.loads(path.read_text(encoding="utf-8"))