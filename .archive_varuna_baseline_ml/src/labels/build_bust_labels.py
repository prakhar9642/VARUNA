"""Bust label construction.

Truth is consumed ONLY to build the retrospective training labels. The
functions here never emit truth columns into the feature matrix.
"""

from __future__ import annotations

import polars as pl

from src.common import VARIABLES, VARIABLE_LABELS, get_config, get_logger
from src.labels.bust_definitions import load_bust_thresholds

logger = get_logger(__name__)


def _threshold_tall(thresholds: dict) -> pl.DataFrame:
    """Long threshold table (variable, lead_day, thr, percentile_label)."""
    rows = []
    for var, by_day in thresholds["thresholds"].items():
        for day, thr in by_day.items():
            rows.append({"variable": var, "lead_day": int(day), "thr": float(thr)})
    return pl.DataFrame(rows)


def add_bust_labels(
    frame: pl.DataFrame,
    thresholds: dict | None = None,
) -> pl.DataFrame:
    """Add per-variable bust columns and overall_bust.

    Thresholds default to the stored TRAINING-estimated ones. Each row is
    labelled bust=1 when consensus absolute error exceeds the threshold for
    that (variable, lead_day).
    """
    cfg = get_config("labels.yaml")["labels"]
    thresholds = thresholds or load_bust_thresholds()

    tall = _threshold_tall(thresholds)
    lf = frame.lazy()

    for var in VARIABLES:
        label = VARIABLE_LABELS[var]
        err_col = f"err_{label}_consensus"
        target = cfg["targets"][var]
        lf = lf.join(
            tall.filter(pl.col("variable") == var)
            .select(["lead_day", "thr"]).lazy(),
            on="lead_day",
            how="left",
        )
        lf = lf.with_columns(
            (pl.col(err_col) > pl.col("thr")).cast(pl.Int8).alias(target)
        ).drop("thr")

    # overall bust from the configured aggregation rule
    targets = [cfg["targets"][v] for v in cfg["overall_variables"]]
    overall = cfg["overall_target"]
    if cfg["overall_rule"] == "any_variable":
        expr = pl.max_horizontal(targets)
    elif cfg["overall_rule"] == "majority_variable":
        # more than half of the selected variables bust
        k = (len(targets) + 1) // 2
        expr = pl.sum_horizontal(targets) >= k
    else:
        raise ValueError(f"Unknown overall_rule: {cfg['overall_rule']}")
    lf = lf.with_columns(expr.cast(pl.Int8).alias(overall))
    return lf.collect()


def bust_target_names() -> list[str]:
    cfg = get_config("labels.yaml")["labels"]
    return [cfg["targets"][v] for v in cfg["overall_variables"]] + [
        cfg["overall_target"]
    ]