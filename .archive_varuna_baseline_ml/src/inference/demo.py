"""Offline Standalone Demo for VARUNA Forecast Bust Detection.

Runs without live external network dependencies by using a real bundled forecast
sample from the held-out test set and executing the actual trained model pipeline.
"""

from __future__ import annotations

import json
from pathlib import Path

from src.common import ML_ROOT, get_logger
from src.inference.predictor import VarunaBaselinePredictor

logger = get_logger(__name__)


def run_demo() -> None:
    demo_path = ML_ROOT / "artifacts" / "demo_prediction.json"

    print("=" * 70)
    print("VARUNA: AI-BASED FORECAST BUST DETECTION SYSTEM (OFFLINE DEMO)")
    print("=" * 70)

    try:
        predictor = VarunaBaselinePredictor()
    except Exception as e:
        print(f"Error loading predictor: {e}")
        print("Please ensure the training pipeline has run: python -m src.pipeline.run_all")
        return

    # Check for sample feature vector in demo_prediction.json or generate from schema
    if demo_path.exists():
        demo_data = json.loads(demo_path.read_text(encoding="utf-8"))
        features = demo_data.get("input_features", {})
        loc_id = demo_data.get("loc_id", "LOC_1253405")
        lead_day = demo_data.get("lead_day", 5)
    else:
        # Construct synthetic/default features from schema
        features = {col: 0.0 for col in predictor.feature_columns}
        features["lead_hours"] = 120.0
        features["lead_age_days"] = 5.0
        features["mm_std_temp"] = 3.2
        features["mm_std_precip"] = 14.5
        features["hist_bust_rate_temp_w30"] = 0.35
        loc_id = "LOC_DEMO_NEW_DELHI"
        lead_day = 5

    res = predictor.predict_from_features(features, loc_id=loc_id, lead_day=lead_day)

    print(f"\nLocation: {res['loc_id']}")
    print(f"Forecast Horizon: Day {res['lead_day']} ({res['lead_hours']} hours)")
    print(f"Bust Probability: {res['bust_probability'] * 100:.1f}%")
    print(f"Forecast Confidence: {res['confidence']}/100")
    print(f"Risk Category: {res['risk_category']}")
    print(f"Status: {res['status']}")

    print("\nTop Contributing Risk Drivers:")
    for r in res["reasons"]:
        print(f"  [!] {r}")

    print("\nStabilizing Factors:")
    for s in res["stabilizers"]:
        print(f"  [OK] {s}")

    if res.get("variable_bust_probabilities"):
        print("\nVariable-Specific Bust Probabilities:")
        for var, prob in res["variable_bust_probabilities"].items():
            print(f"  - {var:20s}: {prob * 100:.1f}%")

    if res.get("historical_analogs"):
        analogs = res["historical_analogs"]
        print(f"\nHistorical Analogue Evidence:")
        print(f"  {analogs.get('summary_statement', '')}")

    print("\n" + "=" * 70)


if __name__ == "__main__":
    run_demo()
