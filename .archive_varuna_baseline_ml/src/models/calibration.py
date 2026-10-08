"""Probability Calibration Engine (Platt Scaling & Isotonic Regression).

Calibrates raw tree model output probabilities on the VALIDATION set.
Never fits calibrators on the test set.
Computes Brier score, Log Loss, Expected Calibration Error (ECE), and Reliability Diagrams.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import joblib
import numpy as np
from sklearn.calibration import CalibratedClassifierCV, calibration_curve
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, log_loss

from src.common import ML_ROOT, get_logger

logger = get_logger(__name__)


@dataclass
class CalibrationMetrics:
    brier_score: float
    log_loss: float
    ece: float
    prob_true: list[float]
    prob_pred: list[float]


def compute_ece(y_true: np.ndarray, y_prob: np.ndarray, n_bins: int = 10) -> tuple[float, list[float], list[float]]:
    """Compute Expected Calibration Error (ECE) and reliability curve points."""
    bin_edges = np.linspace(0.0, 1.0, n_bins + 1)
    ece = 0.0
    n = len(y_true)
    prob_true_list = []
    prob_pred_list = []

    for i in range(n_bins):
        bin_mask = (y_prob >= bin_edges[i]) & (y_prob < bin_edges[i + 1])
        if i == n_bins - 1:
            bin_mask = (y_prob >= bin_edges[i]) & (y_prob <= bin_edges[i + 1])

        bin_count = np.sum(bin_mask)
        if bin_count > 0:
            avg_true = float(np.mean(y_true[bin_mask]))
            avg_pred = float(np.mean(y_prob[bin_mask]))
            ece += (bin_count / n) * abs(avg_true - avg_pred)
            prob_true_list.append(avg_true)
            prob_pred_list.append(avg_pred)

    return float(ece), prob_true_list, prob_pred_list


class ForecastCalibrator:
    """Post-hoc probability calibrator fitted on validation predictions."""

    def __init__(self, method: str = "isotonic"):
        self.method = method
        self.calibrator: Any = None
        self.is_fitted: bool = False

    def fit(self, y_raw_prob: np.ndarray, y_true: np.ndarray) -> ForecastCalibrator:
        y_raw_prob = np.clip(y_raw_prob, 1e-7, 1.0 - 1e-7)
        if self.method == "isotonic":
            self.calibrator = IsotonicRegression(out_of_bounds="clip", y_min=0.0, y_max=1.0)
            self.calibrator.fit(y_raw_prob, y_true)
        elif self.method == "sigmoid":  # Platt scaling
            # Log-odds
            logits = np.log(y_raw_prob / (1.0 - y_raw_prob)).reshape(-1, 1)
            self.calibrator = LogisticRegression(solver="lbfgs", C=1.0, random_state=42)
            self.calibrator.fit(logits, y_true)
        else:
            raise ValueError(f"Unsupported calibration method: {self.method}")

        self.is_fitted = True
        return self

    def predict(self, y_raw_prob: np.ndarray) -> np.ndarray:
        if not self.is_fitted:
            return y_raw_prob

        y_raw_prob = np.clip(y_raw_prob, 1e-7, 1.0 - 1e-7)
        if self.method == "isotonic":
            calibrated = self.calibrator.predict(y_raw_prob)
        elif self.method == "sigmoid":
            logits = np.log(y_raw_prob / (1.0 - y_raw_prob)).reshape(-1, 1)
            calibrated = self.calibrator.predict_proba(logits)[:, 1]
        else:
            calibrated = y_raw_prob

        return np.clip(calibrated, 0.0, 1.0)

    def save(self, path: Path | str | None = None) -> Path:
        out_path = Path(path or ML_ROOT / "models" / "varuna_calibrator.joblib")
        out_path.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump(self, out_path)
        logger.info("Saved calibrator to %s", out_path)
        return out_path

    @classmethod
    def load(cls, path: Path | str | None = None) -> ForecastCalibrator:
        in_path = Path(path or ML_ROOT / "models" / "varuna_calibrator.joblib")
        if not in_path.exists():
            raise FileNotFoundError(f"Calibrator not found at {in_path}")
        return joblib.load(in_path)


def select_best_calibrator(
    y_raw_val_prob: np.ndarray,
    y_val_true: np.ndarray,
) -> tuple[ForecastCalibrator, dict[str, Any]]:
    """Compare Uncalibrated, Platt Scaling (Sigmoid), and Isotonic Regression on validation data."""
    methods = ["uncalibrated", "sigmoid", "isotonic"]
    comparison: dict[str, Any] = {}

    best_method = "uncalibrated"
    best_brier = float("inf")
    best_calibrator = None

    for m in methods:
        if m == "uncalibrated":
            probs = y_raw_val_prob
            calib = ForecastCalibrator(method="sigmoid")  # not fitted
        else:
            calib = ForecastCalibrator(method=m).fit(y_raw_val_prob, y_val_true)
            probs = calib.predict(y_raw_val_prob)

        brier = float(brier_score_loss(y_val_true, probs))
        ll = float(log_loss(y_val_true, np.clip(probs, 1e-6, 1.0 - 1e-6)))
        ece, p_true, p_pred = compute_ece(y_val_true, probs)

        comparison[m] = {
            "brier_score": brier,
            "log_loss": ll,
            "ece": ece,
            "reliability_curve": {"prob_true": p_true, "prob_pred": p_pred},
        }

        # Prefer lower Brier score and lower ECE
        if brier < best_brier:
            best_brier = brier
            best_method = m
            best_calibrator = calib

    logger.info("Best calibration method on validation set: %s (Brier: %.4f)", best_method, best_brier)
    if best_method == "uncalibrated":
        best_calibrator = ForecastCalibrator(method="sigmoid")  # pass-through

    return best_calibrator, {"best_method": best_method, "comparison": comparison}
