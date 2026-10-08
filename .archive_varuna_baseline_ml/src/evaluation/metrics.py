"""Comprehensive Evaluation Engine for VARUNA Forecast Bust Prediction.

Generates evaluation metrics and SIH presentation artifacts:
1. Primary temporal test metrics (PR-AUC, ROC-AUC, F1, Precision, Recall, Brier, LogLoss).
2. Spatial holdout metrics (unseen locations).
3. Baseline vs ML model comparison table & plot.
4. Per-lead-day metrics (Day 1 through Day 8).
5. Per-variable metrics (Temperature, Rain, Wind, Humidity).
6. Regional performance breakdown by state/admin1.
7. Publication-quality evaluation plots.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import matplotlib.pyplot as plt
import numpy as np
import polars as pl
from sklearn.calibration import calibration_curve
from sklearn.metrics import (
    average_precision_score,
    brier_score_loss,
    f1_score,
    log_loss,
    precision_recall_curve,
    precision_score,
    recall_score,
    roc_auc_score,
    roc_curve,
)

from src.common import ML_ROOT, VARIABLES, VARIABLE_LABELS, get_config, get_logger
from src.models.calibration import ForecastCalibrator, compute_ece

logger = get_logger(__name__)

PLOTS_DIR = ML_ROOT / "plots"
REPORTS_DIR = ML_ROOT / "reports"


def calculate_metrics(
    y_true: np.ndarray,
    y_prob: np.ndarray,
    threshold: float = 0.5,
) -> dict[str, float]:
    """Calculate all standard classification and calibration metrics."""
    if len(y_true) == 0 or len(np.unique(y_true)) < 2:
        return {
            "pr_auc": 0.0,
            "roc_auc": 0.0,
            "f1": 0.0,
            "precision": 0.0,
            "recall": 0.0,
            "brier_score": 0.0,
            "log_loss": 0.0,
            "ece": 0.0,
            "n_samples": len(y_true),
            "pos_rate": float(np.mean(y_true)) if len(y_true) > 0 else 0.0,
        }

    y_prob_clipped = np.clip(y_prob, 1e-6, 1.0 - 1e-6)
    y_pred = (y_prob >= threshold).astype(int)

    ece, _, _ = compute_ece(y_true, y_prob)

    return {
        "pr_auc": float(average_precision_score(y_true, y_prob)),
        "roc_auc": float(roc_auc_score(y_true, y_prob)),
        "f1": float(f1_score(y_true, y_pred, zero_division=0)),
        "precision": float(precision_score(y_true, y_pred, zero_division=0)),
        "recall": float(recall_score(y_true, y_pred, zero_division=0)),
        "brier_score": float(brier_score_loss(y_true, y_prob)),
        "log_loss": float(log_loss(y_true, y_prob_clipped)),
        "ece": ece,
        "n_samples": int(len(y_true)),
        "pos_rate": float(np.mean(y_true)),
    }


def evaluate_lead_days(
    test_df: pl.DataFrame,
    y_prob: np.ndarray,
    target_col: str = "overall_bust",
) -> list[dict[str, Any]]:
    """Evaluate performance partitioned by lead day (Day 1 - Day 8)."""
    df_eval = test_df.with_columns(
        pl.Series("y_prob", y_prob),
    )
    days = sorted(df_eval.select("lead_day").unique().get_column("lead_day").to_list())
    results = []

    for d in days:
        subset = df_eval.filter(pl.col("lead_day") == d)
        y_t = subset.select(target_col).to_numpy().ravel()
        y_p = subset.select("y_prob").to_numpy().ravel()
        m = calculate_metrics(y_t, y_p)
        m["lead_day"] = int(d)
        results.append(m)
    return results


def evaluate_regions(
    test_df: pl.DataFrame,
    y_prob: np.ndarray,
    target_col: str = "overall_bust",
    min_samples: int = 50,
) -> list[dict[str, Any]]:
    """Evaluate performance partitioned by administrative region."""
    df_eval = test_df.with_columns(
        pl.Series("y_prob", y_prob),
    )
    regions = sorted(df_eval.select("admin1").unique().get_column("admin1").to_list())
    results = []

    for reg in regions:
        subset = df_eval.filter(pl.col("admin1") == reg)
        if subset.height < min_samples:
            continue
        y_t = subset.select(target_col).to_numpy().ravel()
        y_p = subset.select("y_prob").to_numpy().ravel()
        m = calculate_metrics(y_t, y_p)
        m["admin1"] = str(reg)
        results.append(m)
    return results


def plot_model_comparison(comparison_data: dict[str, dict[str, float]], out_path: Path | str | None = None) -> Path:
    """Generate bar chart comparing baselines vs final ML model."""
    out_path = Path(out_path or PLOTS_DIR / "model_comparison.png")
    out_path.parent.mkdir(parents=True, exist_ok=True)

    models = list(comparison_data.keys())
    metrics_to_plot = ["pr_auc", "roc_auc", "f1", "precision", "recall"]
    metric_labels = ["PR-AUC", "ROC-AUC", "F1 Score", "Precision", "Recall"]

    x = np.arange(len(metrics_to_plot))
    width = 0.8 / len(models)

    fig, ax = plt.subplots(figsize=(10, 6), dpi=300)
    for i, m_name in enumerate(models):
        vals = [comparison_data[m_name].get(m, 0.0) for m in metrics_to_plot]
        offset = (i - len(models) / 2 + 0.5) * width
        ax.bar(x + offset, vals, width, label=m_name.replace("_", " ").title())

    ax.set_ylabel("Score (0.0 - 1.0)", fontsize=12)
    ax.set_title("VARUNA Baseline Model Benchmark: Baselines vs Primary XGBoost", fontsize=14, fontweight="bold")
    ax.set_xticks(x)
    ax.set_xticklabels(metric_labels, fontsize=11)
    ax.legend(frameon=True, fontsize=10)
    ax.grid(axis="y", linestyle="--", alpha=0.5)
    ax.set_ylim(0, 1.05)
    fig.tight_layout()
    fig.savefig(out_path)
    plt.close(fig)
    return out_path


def plot_lead_day_analysis(lead_results: list[dict[str, Any]], out_dir: Path | str | None = None) -> list[Path]:
    """Generate bust rate and model performance vs lead day curves."""
    out_dir = Path(out_dir or PLOTS_DIR)
    out_dir.mkdir(parents=True, exist_ok=True)

    days = [r["lead_day"] for r in lead_results]
    pr_aucs = [r["pr_auc"] for r in lead_results]
    f1s = [r["f1"] for r in lead_results]
    brier = [r["brier_score"] for r in lead_results]
    bust_rates = [r["pos_rate"] * 100 for r in lead_results]

    p1 = out_dir / "model_performance_by_lead.png"
    p2 = out_dir / "bust_rate_by_lead.png"
    p3 = out_dir / "confidence_by_lead.png"

    # Plot 1: Performance vs Lead
    fig, ax1 = plt.subplots(figsize=(8, 5), dpi=300)
    ax1.plot(days, pr_aucs, marker="o", color="#1f77b4", linewidth=2.5, label="PR-AUC")
    ax1.plot(days, f1s, marker="s", color="#2ca02c", linewidth=2.5, label="F1 Score")
    ax1.set_xlabel("Forecast Lead Day", fontsize=12)
    ax1.set_ylabel("Metric Score", fontsize=12)
    ax1.set_title("Forecast Bust Detection Performance vs Lead Time", fontsize=13, fontweight="bold")
    ax1.set_xticks(days)
    ax1.set_xticklabels([f"Day {d}" for d in days])
    ax1.set_ylim(0, 1.0)
    ax1.grid(True, linestyle="--", alpha=0.5)
    ax1.legend(loc="lower left")
    fig.tight_layout()
    fig.savefig(p1)
    plt.close(fig)

    # Plot 2: Empirical Bust Rate vs Lead
    fig, ax2 = plt.subplots(figsize=(8, 5), dpi=300)
    ax2.bar(days, bust_rates, color="#d62728", alpha=0.85, width=0.6)
    ax2.set_xlabel("Forecast Lead Day", fontsize=12)
    ax2.set_ylabel("Realized Forecast Bust Rate (%)", fontsize=12)
    ax2.set_title("Empirical Forecast Bust Frequency by Lead Day", fontsize=13, fontweight="bold")
    ax2.set_xticks(days)
    ax2.set_xticklabels([f"Day {d}" for d in days])
    ax2.grid(axis="y", linestyle="--", alpha=0.5)
    fig.tight_layout()
    fig.savefig(p2)
    plt.close(fig)

    # Plot 3: Confidence Variation with Lead
    fig, ax3 = plt.subplots(figsize=(8, 5), dpi=300)
    avg_conf = [100.0 * (1.0 - r["pos_rate"]) for r in lead_results]
    ax3.plot(days, avg_conf, marker="^", color="#9467bd", linewidth=2.5, label="Mean Forecast Confidence")
    ax3.set_xlabel("Forecast Lead Day", fontsize=12)
    ax3.set_ylabel("Confidence Score (0-100)", fontsize=12)
    ax3.set_title("VARUNA Baseline Forecast Reliability & Confidence Decay with Lead", fontsize=13, fontweight="bold")
    ax3.set_xticks(days)
    ax3.set_xticklabels([f"Day {d}" for d in days])
    ax3.set_ylim(0, 100)
    ax3.grid(True, linestyle="--", alpha=0.5)
    ax3.legend(loc="upper right")
    fig.tight_layout()
    fig.savefig(p3)
    plt.close(fig)

    return [p1, p2, p3]


def plot_calibration_curve(
    y_true: np.ndarray,
    y_prob_raw: np.ndarray,
    y_prob_cal: np.ndarray,
    out_path: Path | str | None = None,
) -> Path:
    """Generate reliability diagram comparing uncalibrated vs calibrated probabilities."""
    out_path = Path(out_path or PLOTS_DIR / "calibration_curve.png")
    out_path.parent.mkdir(parents=True, exist_ok=True)

    prob_true_raw, prob_pred_raw = calibration_curve(y_true, y_prob_raw, n_bins=10)
    prob_true_cal, prob_pred_cal = calibration_curve(y_true, y_prob_cal, n_bins=10)

    fig, ax = plt.subplots(figsize=(7, 6), dpi=300)
    ax.plot([0, 1], [0, 1], "k--", label="Perfect Calibration")
    ax.plot(prob_pred_raw, prob_true_raw, "s-", color="#ff7f0e", label="Raw Model Output")
    ax.plot(prob_pred_cal, prob_true_cal, "o-", color="#2ca02c", linewidth=2, label="Calibrated Probability")

    ax.set_xlabel("Mean Predicted Probability", fontsize=12)
    ax.set_ylabel("Empirical Fraction of Busts", fontsize=12)
    ax.set_title("Probability Calibration Reliability Diagram", fontsize=14, fontweight="bold")
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.grid(True, linestyle="--", alpha=0.5)
    ax.legend(loc="upper left")
    fig.tight_layout()
    fig.savefig(out_path)
    plt.close(fig)
    return out_path


def run_full_evaluation(
    train_output: dict[str, Any],
) -> dict[str, Any]:
    """Run full evaluation suite across Temporal Test, Spatial Holdout, Leads, and Regions."""
    PLOTS_DIR.mkdir(parents=True, exist_ok=True)
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)

    splits = train_output["splits"]
    primary_model = train_output["primary_model"]
    calibrator: ForecastCalibrator = train_output["calibrator"]
    baselines = train_output["baselines"]

    # 1. Temporal Test Predictions
    X_test_temp = splits["X_test_temp"]
    y_test_temp = splits["y_test_temp"]
    test_temp_df = splits["test_temp_df"]

    raw_probs_temp = primary_model.predict_proba(X_test_temp)[:, 1]
    cal_probs_temp = calibrator.predict(raw_probs_temp)

    # 2. Spatial Holdout Test Predictions
    X_test_spat = splits["X_test_spat"]
    y_test_spat = splits["y_test_spat"]
    test_spat_df = splits["test_spat_df"]

    has_spatial = len(X_test_spat) > 0
    if has_spatial:
        raw_probs_spat = primary_model.predict_proba(X_test_spat)[:, 1]
        cal_probs_spat = calibrator.predict(raw_probs_spat)
        spatial_metrics = calculate_metrics(y_test_spat, cal_probs_spat)
    else:
        spatial_metrics = {}

    # 3. Overall Metrics
    temp_metrics = calculate_metrics(y_test_temp, cal_probs_temp)

    # 4. Baselines Evaluation on Temporal Test
    comparison_table = {}
    feature_names = train_output["feature_cols"]

    # Evaluate baselines on test set
    spread_idx = 0
    hist_idx = 0
    for idx, name in enumerate(feature_names):
        if "mm_std_temp" in name:
            spread_idx = idx
            break
    for idx, name in enumerate(feature_names):
        if "hist_bust_rate_temp_w30" in name:
            hist_idx = idx
            break

    from src.models.baselines import (
        ConstantNoBustBaseline,
        HistoricalFrequencyBaseline,
        LogisticRegressionBaseline,
        ModelSpreadBaseline,
    )

    b_no_bust = ConstantNoBustBaseline().fit(splits["X_train"], splits["y_train"])
    b_spread = ModelSpreadBaseline(spread_idx).fit(splits["X_train"], splits["y_train"])
    b_hist = HistoricalFrequencyBaseline(hist_idx).fit(splits["X_train"], splits["y_train"])
    b_lr = LogisticRegressionBaseline().fit(splits["X_train"], splits["y_train"])

    comparison_table["baseline_no_bust"] = calculate_metrics(y_test_temp, b_no_bust.predict_proba(X_test_temp)[:, 1])
    comparison_table["spread_threshold"] = calculate_metrics(y_test_temp, b_spread.predict_proba(X_test_temp)[:, 1])
    comparison_table["historical_frequency"] = calculate_metrics(y_test_temp, b_hist.predict_proba(X_test_temp)[:, 1])
    comparison_table["logistic_regression"] = calculate_metrics(y_test_temp, b_lr.predict_proba(X_test_temp)[:, 1])
    comparison_table["varuna_xgboost"] = temp_metrics

    # 5. Lead Day Breakdown
    lead_day_metrics = evaluate_lead_days(test_temp_df, cal_probs_temp)

    # 6. Regional Breakdown
    regional_metrics = evaluate_regions(test_temp_df, cal_probs_temp)

    # 7. Variable-Specific Model Evaluation
    var_metrics = {}
    var_models = train_output.get("var_models", {})
    cfg_labels = get_config("labels.yaml")["labels"]["targets"]
    for var, v_pack in var_models.items():
        v_target = cfg_labels[var]
        if v_target in test_temp_df.columns:
            y_v_true = test_temp_df.select(v_target).to_numpy().ravel()
            v_raw = v_pack["model"].predict_proba(X_test_temp)[:, 1]
            v_cal = v_pack["calibrator"].predict(v_raw)
            var_metrics[var] = calculate_metrics(y_v_true, v_cal)

    # 8. Generate Plots
    plot_model_comparison(comparison_table)
    plot_lead_day_analysis(lead_day_metrics)
    plot_calibration_curve(y_test_temp, raw_probs_temp, cal_probs_temp)

    # 9. Save Evaluation Results Summary JSON
    eval_summary = {
        "temporal_test": temp_metrics,
        "spatial_holdout": spatial_metrics,
        "model_comparison": comparison_table,
        "lead_day_breakdown": lead_day_metrics,
        "regional_breakdown": regional_metrics[:15],
        "variable_models": var_metrics,
    }
    out_json = REPORTS_DIR / "evaluation_summary.json"
    out_json.write_text(json.dumps(eval_summary, indent=2), encoding="utf-8")
    logger.info("Saved evaluation summary to %s", out_json)

    return eval_summary
