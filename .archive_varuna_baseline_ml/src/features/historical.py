"""Historical (rolling) model-performance features.

Causality contract (enforced and tested):

For a prediction issued at init time I for location L and lead Ld:

    hist_* features use ONLY error/bust records whose ISSUE time is strictly
    before I, restricted to the same location and the same lead.

We restrict each rolling window to the same (location, lead) time series over
daily init cycles. Window W days = last W init cycles; the current cycle is
excluded via shift(1). Because inits are daily and near-continuous this is a
sound count-based proxy for a W-day calendar window (see tests).

Rows before the window have no prior history: they are filled from a global
(non-future) prior computed on OLDER init cycles only, which keeps features
defined on cold-start rows without leakage.
"""

from __future__ import annotations

import polars as pl

from src.common import VARIABLES, VARIABLE_LABELS, get_config, get_logger

logger = get_logger(__name__)


def compute_global_prior(
    frame: pl.DataFrame,
    init_before_h: int,
) -> dict[str, float]:
    """Global priors from cycles strictly before `init_before_h` (no leakage)."""
    f = frame.filter(pl.col("init_h") < init_before_h)
    prior: dict[str, float] = {}
    if f.height == 0:
        logger.warning("Empty history for prior; using neutral defaults.")
        for var in VARIABLES:
            label = VARIABLE_LABELS[var]
            prior[f"hist_err_mean_{label}"] = 0.0
            prior[f"hist_err_std_{label}"] = 1.0
            prior[f"hist_bust_rate_{label}"] = 0.1
            prior[f"hist_bias_{label}"] = 0.0
            prior[f"err_{label}_std_prior"] = 1.0
        return prior

    labels_cfg = get_config("labels.yaml")["labels"]
    for var in VARIABLES:
        label = VARIABLE_LABELS[var]
        errs = f.select(pl.col(f"err_{label}_consensus")).to_series()
        biases = f.select(pl.col(f"bias_{label}_consensus")).to_series()
        busts = f.select(pl.col(labels_cfg["targets"][var])).to_series()
        prior[f"hist_err_mean_{label}"] = float(errs.mean())
        prior[f"hist_err_std_{label}"] = float(errs.std())
        prior[f"hist_bust_rate_{label}"] = float(busts.mean())
        prior[f"hist_bias_{label}"] = float(biases.mean())
        prior[f"err_{label}_std_prior"] = float(errs.std())
    return prior


def add_historical_features(
    frame: pl.DataFrame,
    windows_days: list[int] | None = None,
) -> pl.DataFrame:
    """Add rolling historical error features (all inputs must be present).

    Required columns: loc_id, init_h, lead_hours and for every variable label
        err_<label>_consensus, bias_<label>_consensus, bust_<label>

    The frame must be sorted by init_h globally beforehand (not required, the
    sort is applied here) so that rolling within (loc, lead) is chronological.
    """
    cfg = get_config("features.yaml")["features"]
    windows_days = windows_days or cfg["historical_windows_days"]

    frame = frame.sort(["loc_id", "lead_hours", "init_h"])
    labels_cfg = get_config("labels.yaml")["labels"]

    expressions: list[pl.Expr] = []
    for var in VARIABLES:
        label = VARIABLE_LABELS[var]
        e_col = f"err_{label}_consensus"
        b_col = f"bias_{label}_consensus"
        k_col = labels_cfg["targets"][var]
        for w in windows_days:
            expressions += [
                pl.col(e_col)
                .rolling_mean(window_size=w, min_periods=1)
                .shift(1)
                .over(["loc_id", "lead_hours"])
                .cast(pl.Float32)
                .alias(f"hist_err_mean_{label}_w{w}"),
                pl.col(e_col)
                .rolling_std(window_size=w, min_periods=1)
                .shift(1)
                .over(["loc_id", "lead_hours"])
                .cast(pl.Float32)
                .alias(f"hist_err_std_{label}_w{w}"),
                pl.col(k_col)
                .rolling_mean(window_size=w, min_periods=1)
                .shift(1)
                .over(["loc_id", "lead_hours"])
                .cast(pl.Float32)
                .alias(f"hist_bust_rate_{label}_w{w}"),
                pl.col(b_col)
                .rolling_mean(window_size=w, min_periods=1)
                .shift(1)
                .over(["loc_id", "lead_hours"])
                .cast(pl.Float32)
                .alias(f"hist_bias_{label}_w{w}"),
            ]
    return frame.lazy().with_columns(expressions).collect()


def fill_historical_missing(
    frame: pl.DataFrame,
    prior: dict[str, float],
) -> pl.DataFrame:
    """Fill null historical cells (cold-start rows) with global priors."""
    cfg = get_config("features.yaml")["features"]
    windows_days = cfg["historical_windows_days"]
    lf = frame.lazy()
    for var in VARIABLES:
        label = VARIABLE_LABELS[var]
        for w in windows_days:
            for stat, key in [
                ("err_mean", f"hist_err_mean_{label}"),
                ("err_std", f"hist_err_std_{label}"),
                ("bust_rate", f"hist_bust_rate_{label}"),
                ("bias", f"hist_bias_{label}"),
            ]:
                col = f"hist_{stat}_{label}_w{w}"
                if col in frame.columns:
                    pval = prior.get(key, 0.0)
                    lf = lf.with_columns(pl.col(col).fill_null(pval).alias(col))
    return lf.collect()


def historical_feature_names(windows_days: list[int] | None = None) -> list[str]:
    cfg = get_config("features.yaml")["features"]
    windows_days = windows_days or cfg["historical_windows_days"]
    names = []
    for var in VARIABLES:
        label = VARIABLE_LABELS[var]
        for w in windows_days:
            for stat in ["err_mean", "err_std", "bust_rate", "bias"]:
                names.append(f"hist_{stat}_{label}_w{w}")
    return names