"""Case Study Generator for VARUNA Baseline.

Extracts real, representative meteorological case studies from the HELD-OUT TEST SET:
1. True Positive: Successful high-risk forecast bust detection.
2. True Negative: Successful high-confidence stable forecast detection.
3. False Positive / False Negative: Failure mode analysis and scientific critique.

Saves:
- reports/case_studies.json
- reports/case_studies.md
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
import polars as pl

from src.analogs.analogue_engine import HistoricalAnalogueEngine
from src.common import ML_ROOT, get_logger
from src.explainability.reason_engine import explain_prediction_factors
from src.explainability.shap_engine import ShapEngine

logger = get_logger(__name__)

REPORTS_DIR = ML_ROOT / "reports"


def extract_case_studies(
    test_df: pl.DataFrame,
    y_prob: np.ndarray,
    shap_engine: ShapEngine,
    analogue_engine: HistoricalAnalogueEngine,
    feature_cols: list[str],
    target_col: str = "overall_bust",
    threshold: float = 0.5,
) -> dict[str, Any]:
    """Identify TP, TN, FP, and FN cases from held-out test predictions."""
    y_true = test_df.select(target_col).to_numpy().ravel()
    y_pred = (y_prob >= threshold).astype(int)

    tp_indices = np.where((y_true == 1) & (y_pred == 1))[0]
    tn_indices = np.where((y_true == 0) & (y_pred == 0))[0]
    fp_indices = np.where((y_true == 0) & (y_pred == 1))[0]
    fn_indices = np.where((y_true == 1) & (y_pred == 0))[0]

    # Select representative case index for each
    cases_selection = {}
    if len(tp_indices) > 0:
        # Pick high probability bust case
        best_tp = tp_indices[np.argmax(y_prob[tp_indices])]
        cases_selection["successful_bust_detection"] = (best_tp, "True Positive: Model correctly detected high-risk bust.")
    if len(tn_indices) > 0:
        # Pick low probability normal case
        best_tn = tn_indices[np.argmin(y_prob[tn_indices])]
        cases_selection["successful_normal_forecast"] = (best_tn, "True Negative: Model correctly identified reliable forecast.")
    if len(fp_indices) > 0:
        best_fp = fp_indices[np.argmax(y_prob[fp_indices])]
        cases_selection["false_alarm_case"] = (best_fp, "False Positive: Model warned of bust, but forecast remained stable.")
    elif len(fn_indices) > 0:
        best_fn = fn_indices[np.argmin(y_prob[fn_indices])]
        cases_selection["missed_bust_case"] = (best_fn, "False Negative: Forecast busted unexpectedly despite high model confidence.")

    detailed_cases: dict[str, Any] = {}

    for case_type, (idx, desc) in cases_selection.items():
        row_dict = test_df.slice(int(idx), 1).to_dicts()[0]
        x_vec = test_df.select(feature_cols).slice(int(idx), 1).to_numpy()

        p_bust = float(y_prob[idx])
        confidence = float(np.clip(100.0 * (1.0 - p_bust), 0.0, 100.0))

        # Risk category
        if confidence >= 80:
            category = "HIGH_CONFIDENCE"
        elif confidence >= 60:
            category = "MODERATE_CONFIDENCE"
        elif confidence >= 40:
            category = "LOW_CONFIDENCE"
        else:
            category = "VERY_LOW_CONFIDENCE_HIGH_RISK"

        # SHAP & Reasons
        shap_res = shap_engine.explain_instance(x_vec, top_k=3)
        reasons, stabilizers = explain_prediction_factors(
            shap_res["top_positive_risk_factors"],
            shap_res["top_stabilizing_factors"],
        )

        # Analogs
        analog_res = analogue_engine.find_analogs(x_vec, k=10)

        # Format timestamps
        v_time = str(row_dict.get("valid_time", ""))
        i_time = str(row_dict.get("init_time", ""))

        detailed_cases[case_type] = {
            "case_id": f"CASE_{case_type.upper()}_{row_dict.get('loc_id', 'LOC')}",
            "description": desc,
            "location": {
                "loc_id": str(row_dict.get("loc_id", "")),
                "admin1": str(row_dict.get("admin1", "")),
                "lat": float(row_dict.get("lat", 0.0)),
                "lon": float(row_dict.get("lon", 0.0)),
                "elevation_m": float(row_dict.get("elevation_m", 0.0)),
            },
            "forecast_timing": {
                "valid_time": v_time,
                "init_time": i_time,
                "lead_hours": int(row_dict.get("lead_hours", 0)),
                "lead_day": int(row_dict.get("lead_day", 1)),
            },
            "ground_truth_outcome": {
                "realized_overall_bust": int(y_true[idx]),
                "target_definition": target_col,
            },
            "varuna_prediction": {
                "bust_probability": round(p_bust, 4),
                "confidence_score": round(confidence, 1),
                "risk_category": category,
            },
            "explainability": {
                "key_risk_drivers": reasons,
                "stabilizing_factors": stabilizers,
                "top_shap_factors": shap_res["top_positive_risk_factors"] + shap_res["top_stabilizing_factors"],
            },
            "historical_analogs": analog_res,
        }

    # Save to JSON
    json_path = REPORTS_DIR / "case_studies.json"
    json_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(json.dumps(detailed_cases, indent=2), encoding="utf-8")

    # Generate Markdown Report
    md_lines = [
        "# VARUNA Baseline Case Studies (Held-Out Test Set)",
        "",
        "Representative real meteorological case studies evaluating forecast bust detection performance and failure modes.",
        "",
    ]

    for c_key, c_val in detailed_cases.items():
        loc = c_val["location"]
        tim = c_val["forecast_timing"]
        pred = c_val["varuna_prediction"]
        gt = c_val["ground_truth_outcome"]

        md_lines.extend([
            f"## Case: {c_val['case_id']}",
            f"**Type:** {c_val['description']}",
            "",
            f"- **Location:** {loc['admin1']} (`{loc['loc_id']}`) at ({loc['lat']:.2f}°N, {loc['lon']:.2f}°E)",
            f"- **Lead Time:** Day {tim['lead_day']} ({tim['lead_hours']} hours)",
            f"- **Valid UTC:** `{tim['valid_time']}`",
            f"- **VARUNA Bust Probability:** **{pred['bust_probability'] * 100:.1f}%** (Confidence: {pred['confidence_score']}/100, {pred['risk_category']})",
            f"- **Realized Outcome:** {'BUST DETECTED' if gt['realized_overall_bust'] else 'NORMAL (NO BUST)'}",
            "",
            "### Risk Drivers & Meteorological Rationale",
        ])
        for r in c_val["explainability"]["key_risk_drivers"]:
            md_lines.append(f"- {r}")

        md_lines.extend([
            "",
            "### Historical Analogue Evidence",
            f"- {c_val['historical_analogs']['summary_statement']}",
            "",
            "---",
            "",
        ])

    md_path = REPORTS_DIR / "case_studies.md"
    md_path.write_text("\n".join(md_lines), encoding="utf-8")
    logger.info("Saved case studies to %s and %s", json_path, md_path)
    return detailed_cases
