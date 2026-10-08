"""Baseline Models for Forecast Bust Detection.

Implements standard benchmark baselines to rigorously demonstrate ML lift:
1. Baseline 1: Constant zero (Predict no bust, P(bust) = prior or 0.0)
2. Baseline 2: Multi-model spread threshold heuristic (P(bust) proportional to normalized spread)
3. Baseline 3: Historical bust frequency (P(bust) = historical rolling bust rate)
4. Baseline 4: Standard regularized Logistic Regression
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline


@dataclass
class BaselinePrediction:
    model_name: str
    probabilities: np.ndarray
    predictions: np.ndarray


class ConstantNoBustBaseline:
    """Baseline 1: Always predicts 0 (no bust), probability equals empirical training prior."""

    def __init__(self):
        self.prior: float = 0.0

    def fit(self, X: np.ndarray, y: np.ndarray) -> ConstantNoBustBaseline:
        self.prior = float(np.mean(y))
        return self

    def predict_proba(self, X: np.ndarray) -> np.ndarray:
        p1 = np.full(len(X), self.prior)
        p0 = 1.0 - p1
        return np.column_stack([p0, p1])

    def predict(self, X: np.ndarray, threshold: float = 0.5) -> np.ndarray:
        return (self.predict_proba(X)[:, 1] >= threshold).astype(int)


class ModelSpreadBaseline:
    """Baseline 2: Forecast bust probability is directly estimated from normalized multi-model spread."""

    def __init__(self, spread_feature_idx: int = 0):
        self.spread_feature_idx = spread_feature_idx
        self.min_val: float = 0.0
        self.max_val: float = 1.0

    def fit(self, X: np.ndarray, y: np.ndarray) -> ModelSpreadBaseline:
        spreads = X[:, self.spread_feature_idx]
        self.min_val = float(np.percentile(spreads, 1))
        self.max_val = float(np.percentile(spreads, 99))
        if self.max_val <= self.min_val:
            self.max_val = self.min_val + 1e-6
        return self

    def predict_proba(self, X: np.ndarray) -> np.ndarray:
        spreads = X[:, self.spread_feature_idx]
        clipped = np.clip(spreads, self.min_val, self.max_val)
        p1 = (clipped - self.min_val) / (self.max_val - self.min_val)
        p1 = np.clip(p1, 0.01, 0.99)
        p0 = 1.0 - p1
        return np.column_stack([p0, p1])

    def predict(self, X: np.ndarray, threshold: float = 0.5) -> np.ndarray:
        return (self.predict_proba(X)[:, 1] >= threshold).astype(int)


class HistoricalFrequencyBaseline:
    """Baseline 3: Predict probability based on historical rolling bust frequency."""

    def __init__(self, hist_freq_feature_idx: int = 0):
        self.hist_freq_feature_idx = hist_freq_feature_idx
        self.default_prior: float = 0.10

    def fit(self, X: np.ndarray, y: np.ndarray) -> HistoricalFrequencyBaseline:
        self.default_prior = float(np.mean(y))
        return self

    def predict_proba(self, X: np.ndarray) -> np.ndarray:
        rates = X[:, self.hist_freq_feature_idx]
        p1 = np.nan_to_num(rates, nan=self.default_prior)
        p1 = np.clip(p1, 0.001, 0.999)
        p0 = 1.0 - p1
        return np.column_stack([p0, p1])

    def predict(self, X: np.ndarray, threshold: float = 0.5) -> np.ndarray:
        return (self.predict_proba(X)[:, 1] >= threshold).astype(int)


from sklearn.impute import SimpleImputer


class LogisticRegressionBaseline:
    """Baseline 4: Scaled L2-regularized Logistic Regression."""

    def __init__(self, C: float = 1.0, max_iter: int = 500):
        self.pipeline = Pipeline([
            ("imputer", SimpleImputer(strategy="median")),
            ("scaler", StandardScaler()),
            ("clf", LogisticRegression(C=C, max_iter=max_iter, solver="lbfgs", random_state=42)),
        ])

    def fit(self, X: np.ndarray, y: np.ndarray) -> LogisticRegressionBaseline:
        X_clean = np.nan_to_num(X, nan=np.nan, posinf=1e6, neginf=-1e6)
        self.pipeline.fit(X_clean, y)
        return self

    def predict_proba(self, X: np.ndarray) -> np.ndarray:
        X_clean = np.nan_to_num(X, nan=np.nan, posinf=1e6, neginf=-1e6)
        return self.pipeline.predict_proba(X_clean)

    def predict(self, X: np.ndarray, threshold: float = 0.5) -> np.ndarray:
        return (self.predict_proba(X)[:, 1] >= threshold).astype(int)


def train_and_eval_baselines(
    X_train: np.ndarray,
    y_train: np.ndarray,
    X_val: np.ndarray,
    feature_names: list[str],
) -> dict[str, Any]:
    """Train all 4 baselines on X_train/y_train and predict probabilities on X_val."""
    # Find spread and historical indices if available
    spread_idx = 0
    hist_idx = 0
    for idx, name in enumerate(feature_names):
        if "mm_std_temp" in name or "mm_range_temp" in name:
            spread_idx = idx
            break
    for idx, name in enumerate(feature_names):
        if "hist_bust_rate_temp_w30" in name:
            hist_idx = idx
            break

    baselines = {
        "baseline_no_bust": ConstantNoBustBaseline().fit(X_train, y_train),
        "spread_threshold": ModelSpreadBaseline(spread_idx).fit(X_train, y_train),
        "historical_frequency": HistoricalFrequencyBaseline(hist_idx).fit(X_train, y_train),
        "logistic_regression": LogisticRegressionBaseline().fit(X_train, y_train),
    }

    preds = {}
    for name, model in baselines.items():
        probs = model.predict_proba(X_val)[:, 1]
        preds[name] = {
            "model": model,
            "val_probabilities": probs,
        }
    return preds
