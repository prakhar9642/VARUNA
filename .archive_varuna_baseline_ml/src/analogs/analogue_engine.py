"""Historical Analogue Engine for VARUNA Baseline.

Implements lightweight nearest-neighbor retrieval on normalized meteorological and
NWP context features over historical training cases (strictly before current forecast).

Returns:
- Top-K similar historical cases
- Historical bust rate among analogues
- Mean historical realized error
- Situation similarity score
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import polars as pl
from sklearn.neighbors import NearestNeighbors
from sklearn.preprocessing import RobustScaler

from src.common import ML_ROOT, get_logger

logger = get_logger(__name__)

ANALOGS_DIR = ML_ROOT / "artifacts" / "analogs"


class HistoricalAnalogueEngine:
    """Fast nearest-neighbor search over historical weather forecast contexts."""

    def __init__(self, n_neighbors: int = 15):
        self.n_neighbors = n_neighbors
        self.scaler = RobustScaler()
        self.nn = NearestNeighbors(n_neighbors=n_neighbors, metric="euclidean", algorithm="auto")
        self.feature_columns: list[str] = []
        self.case_records: list[dict[str, Any]] = []
        self.is_fitted: bool = False

    def fit(
        self,
        historical_df: pl.DataFrame,
        feature_columns: list[str],
        sample_limit: int = 25000,
    ) -> HistoricalAnalogueEngine:
        """Fit scaler and nearest neighbor index on historical training rows."""
        self.feature_columns = feature_columns

        # Sample representative training cases if dataset is large to maintain sub-millisecond retrieval
        if historical_df.height > sample_limit:
            sub_df = historical_df.sample(n=sample_limit, seed=42)
        else:
            sub_df = historical_df

        X = sub_df.select(feature_columns).to_numpy()
        X_clean = np.nan_to_num(X, nan=0.0, posinf=0.0, neginf=0.0)
        X_scaled = np.nan_to_num(self.scaler.fit_transform(X_clean), nan=0.0, posinf=0.0, neginf=0.0)
        self.nn.fit(X_scaled)

        # Store compact metadata for retrieval
        meta_cols = [
            "loc_id", "valid_time", "lead_hours", "lead_day",
            "overall_bust", "lat", "lon", "admin1"
        ]
        available_cols = [c for c in meta_cols if c in sub_df.columns]

        rows = sub_df.select(available_cols).to_dicts()
        for r in rows:
            if "valid_time" in r and hasattr(r["valid_time"], "isoformat"):
                r["valid_time"] = r["valid_time"].isoformat()
            self.case_records.append(r)

        self.is_fitted = True
        logger.info("Analogue engine fitted on %d historical cases with %d features", len(self.case_records), len(feature_columns))
        return self

    def find_analogs(
        self,
        x_vector: np.ndarray,
        k: int | None = None,
    ) -> dict[str, Any]:
        """Retrieve nearest historical cases for a given forecast feature vector."""
        if not self.is_fitted:
            return {
                "n_analogs": 0,
                "historical_bust_rate": 0.0,
                "historical_mean_similarity": 0.0,
                "similar_cases": [],
            }

        k = k or self.n_neighbors
        if x_vector.ndim == 1:
            x_mat = x_vector.reshape(1, -1)
        else:
            x_mat = x_vector

        x_clean = np.nan_to_num(x_mat, nan=0.0, posinf=0.0, neginf=0.0)
        x_scaled = np.nan_to_num(self.scaler.transform(x_clean), nan=0.0, posinf=0.0, neginf=0.0)
        distances, indices = self.nn.kneighbors(x_scaled, n_neighbors=k)

        dists = distances[0]
        idxs = indices[0]

        similar_cases = []
        bust_count = 0

        # Similarity score: decaying exponential over distance
        similarities = np.exp(-0.5 * dists)
        mean_sim = float(np.mean(similarities))

        for rank, (dist, idx, sim) in enumerate(zip(dists, idxs, similarities), 1):
            record = self.case_records[idx].copy()
            record["distance"] = float(dist)
            record["similarity_score"] = float(sim)
            record["rank"] = rank
            is_bust = bool(record.get("overall_bust", 0))
            if is_bust:
                bust_count += 1
            similar_cases.append(record)

        analogue_bust_rate = float(bust_count / len(similar_cases)) if similar_cases else 0.0

        return {
            "n_analogs": len(similar_cases),
            "historical_bust_rate": analogue_bust_rate,
            "historical_mean_similarity": mean_sim,
            "summary_statement": (
                f"{bust_count} of {len(similar_cases)} similar historical forecasts ({analogue_bust_rate * 100:.0f}%) "
                "experienced a forecast bust under comparable synoptic and multi-model spread conditions."
            ),
            "similar_cases": similar_cases[:5],
        }

    def save(self, path: Path | str | None = None) -> Path:
        out_path = Path(path or ANALOGS_DIR / "analogue_engine.joblib")
        out_path.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump(self, out_path)
        logger.info("Saved Analogue Engine to %s", out_path)
        return out_path

    @classmethod
    def load(cls, path: Path | str | None = None) -> HistoricalAnalogueEngine:
        in_path = Path(path or ANALOGS_DIR / "analogue_engine.joblib")
        if not in_path.exists():
            raise FileNotFoundError(f"Analogue engine not found at {in_path}")
        return joblib.load(in_path)
