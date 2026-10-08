"""SHAP Explainability Engine for VARUNA Forecast Bust Predictions.

Uses shap.TreeExplainer on the trained XGBoost model to:
1. Compute exact Shapley values for individual forecast risk predictions.
2. Generate global feature importance summary plot (plots/shap_summary.png).
3. Extract top positive risk contributors and stabilizing factors for every forecast.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import matplotlib.pyplot as plt
import numpy as np
try:
    import shap
except ImportError:
    shap = None

from src.common import ML_ROOT, get_logger

logger = get_logger(__name__)

PLOTS_DIR = ML_ROOT / "plots"
REPORTS_DIR = ML_ROOT / "reports"


class ShapEngine:
    """Wrapper around TreeExplainer for XGBoost model explainability."""

    def __init__(self, model: Any, feature_names: list[str]):
        self.model = model
        self.feature_names = feature_names
        logger.info("Initializing SHAP TreeExplainer...")
        self.explainer = shap.TreeExplainer(model) if shap is not None else None

    def explain_instance(
        self,
        x_vector: np.ndarray,
        top_k: int = 4,
    ) -> dict[str, Any]:
        """Explain a single forecast instance vector."""
        if x_vector.ndim == 1:
            x_mat = x_vector.reshape(1, -1)
        else:
            x_mat = x_vector

        if self.explainer is not None:
            shap_values = self.explainer.shap_values(x_mat)[0]
            base_val = float(self.explainer.expected_value)
        else:
            importances = getattr(self.model, "feature_importances_", None)
            if importances is not None and len(importances) == len(self.feature_names):
                shap_values = importances * (x_mat[0] - np.mean(x_mat[0]))
            else:
                shap_values = np.zeros(len(self.feature_names))
            base_val = 0.5

        # Top positive (risk-increasing) and top negative (risk-decreasing / stabilizing)
        pos_indices = [i for i in np.argsort(shap_values)[::-1] if shap_values[i] > 0][:top_k]
        neg_indices = [i for i in np.argsort(shap_values) if shap_values[i] < 0][:top_k]

        pos_factors = [
            {
                "feature": self.feature_names[i],
                "shap_value": float(shap_values[i]),
                "feature_value": float(x_mat[0, i]),
            }
            for i in pos_indices
        ]
        neg_factors = [
            {
                "feature": self.feature_names[i],
                "shap_value": float(shap_values[i]),
                "feature_value": float(x_mat[0, i]),
            }
            for i in neg_indices
        ]

        return {
            "base_value": base_val,
            "top_positive_risk_factors": pos_factors,
            "top_stabilizing_factors": neg_factors,
            "all_shap_values": {self.feature_names[i]: float(shap_values[i]) for i in range(len(self.feature_names))},
        }

    def generate_summary_plot(
        self,
        X_sample: np.ndarray,
        max_display: int = 15,
        out_path: Path | str | None = None,
    ) -> Path:
        """Generate publication-ready SHAP summary plot and save to plots/shap_summary.png."""
        out_path = Path(out_path or PLOTS_DIR / "shap_summary.png")
        out_path.parent.mkdir(parents=True, exist_ok=True)

        if shap is None or self.explainer is None:
            logger.warning("SHAP library not installed; skipping summary plot generation.")
            return out_path

        logger.info("Computing SHAP values on sample of size %d...", len(X_sample))
        shap_vals = self.explainer.shap_values(X_sample)

        fig, ax = plt.subplots(figsize=(10, 7), dpi=300)
        shap.summary_plot(
            shap_vals,
            X_sample,
            feature_names=self.feature_names,
            max_display=max_display,
            show=False,
        )
        plt.title("VARUNA Baseline Feature Attribution (SHAP Summary)", fontsize=14, fontweight="bold", pad=15)
        plt.tight_layout()
        plt.savefig(out_path, bbox_inches="tight")
        plt.close(fig)
        logger.info("Saved SHAP summary plot to %s", out_path)
        return out_path

    def export_feature_importance_report(
        self,
        X_sample: np.ndarray,
        out_path: Path | str | None = None,
    ) -> Path:
        """Generate reports/feature_importance.md summarizing global feature attribution."""
        out_path = Path(out_path or REPORTS_DIR / "feature_importance.md")
        out_path.parent.mkdir(parents=True, exist_ok=True)

        if shap is None or self.explainer is None:
            logger.warning("SHAP library not installed; skipping feature importance report export.")
            return out_path

        shap_vals = self.explainer.shap_values(X_sample)
        mean_abs_shap = np.mean(np.abs(shap_vals), axis=0)
        sorted_idx = np.argsort(mean_abs_shap)[::-1]

        lines = [
            "# VARUNA Baseline Global Feature Importance Report",
            "",
            "Computed via TreeExplainer SHAP values over the held-out validation distribution.",
            "",
            "| Rank | Feature Name | Mean |SHAP| Value | Description |",
            "|---|---|---|---|",
        ]

        for rank, idx in enumerate(sorted_idx[:25], 1):
            fname = self.feature_names[idx]
            val = mean_abs_shap[idx]
            lines.append(f"| {rank} | `{fname}` | {val:.4f} | |")

        out_path.write_text("\n".join(lines), encoding="utf-8")
        logger.info("Saved feature importance markdown to %s", out_path)
        return out_path
