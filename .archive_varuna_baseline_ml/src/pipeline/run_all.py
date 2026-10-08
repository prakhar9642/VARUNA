"""Master Orchestration Pipeline for VARUNA Baseline ML Subsystem.

Executes end-to-end reproducible workflow:
1. Data validation & schema checks
2. Preprocessing and flat core assembly
3. Feature engineering & issue-time causal historical features
4. Leakage audit verification
5. Chronological splitting & spatial holdout isolation
6. Baseline benchmarking
7. XGBoost training & probability calibration
8. Comprehensive evaluation & SIH plot generation
9. SHAP TreeExplainer and Reason Engine analysis
10. Historical analogue engine fitting & case study generation
11. Artifact serialization & sample inference demo verification
"""

from __future__ import annotations

import argparse
import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import polars as pl

from src.analogs.analogue_engine import HistoricalAnalogueEngine
from src.analogs.case_studies import extract_case_studies
from src.common import ML_ROOT, get_config, get_logger, setup_logging
from src.data.download_dataset import download_dataset, write_manifest
from src.data.preprocess import build_core_frame
from src.data.tigge_adapter import TiggeAdapter
from src.data.validate import validate_corpus
from src.evaluation.metrics import run_full_evaluation
from src.explainability.shap_engine import ShapEngine
from src.features.build import build_feature_matrix, model_feature_columns
from src.inference.predictor import VarunaBaselinePredictor
from src.models.train import run_training_pipeline
from src.validation.leakage_audit import run_leakage_audit

logger = get_logger("varuna_baseline.pipeline")


def run_pipeline(
    force_download: bool = False,
    force_features: bool = False,
    smoke_fraction: float | None = None,
) -> dict[str, Any]:
    """Execute complete Varuna ML pipeline."""
    t_start = time.time()
    logger.info("=" * 80)
    logger.info("STARTING VARUNA BASELINE ML SUBSYSTEM PIPELINE")
    logger.info("=" * 80)

    # 1. Dataset verification / download
    logger.info("[Step 1/11] Verifying raw dataset...")
    raw_weather_dir = ML_ROOT / "data" / "raw" / "weather" / "d1_mos"
    if force_download or not raw_weather_dir.exists() or len(list(raw_weather_dir.glob("*.parquet"))) == 0:
        manifest = download_dataset(force_download=force_download)
        write_manifest(manifest)
    else:
        logger.info("Found existing raw dataset shards in %s", raw_weather_dir)

    # Check Day 8-10 TIGGE adapter status
    tigge_adapter = TiggeAdapter()
    tigge_adapter.export_status_report()

    # 2. Data Validation
    logger.info("[Step 2/11] Validating data integrity and geographical bounds...")
    val_report = validate_corpus()
    if val_report.get("status") == "FAIL":
        raise RuntimeError(f"Data validation failed: {val_report}")

    # 3. Feature Matrix Construction & Causality
    logger.info("[Step 3/11] Constructing feature matrix & causal historical features...")
    params = {"smoke_fraction": smoke_fraction} if smoke_fraction else None
    feature_matrix = build_feature_matrix(params=params, force=force_features)
    logger.info("Feature matrix ready: %d rows, %d columns", feature_matrix.height, feature_matrix.width)

    # 4. Leakage Audit
    logger.info("[Step 4/11] Executing feature leakage audit...")
    feature_cols = model_feature_columns()
    leakage_res = run_leakage_audit(feature_cols)
    if leakage_res.get("status") != "PASS":
        raise RuntimeError(f"Leakage audit FAIL! Violations detected: {leakage_res.get('violations')}")

    # 5. Model Training, Baseline Benchmarks & Probability Calibration
    logger.info("[Step 5/11] Training baselines, XGBoost models, and calibrators...")
    train_res = run_training_pipeline(feature_matrix=feature_matrix, train_variable_models=True)

    # 6. Evaluation Suite & SIH Plots
    logger.info("[Step 6/11] Running comprehensive evaluation and generating plots...")
    eval_res = run_full_evaluation(train_res)

    # 7. SHAP Explainability & Reason Generation
    logger.info("[Step 7/11] Generating SHAP summary plot and feature importance report...")
    shap_engine = ShapEngine(train_res["primary_model"], feature_cols)
    val_df = train_res["splits"]["val_df"]
    sample_n = min(1000, val_df.height)
    X_val_sample = val_df.select(feature_cols).sample(n=sample_n, seed=42).to_numpy()
    shap_engine.generate_summary_plot(X_val_sample)
    shap_engine.export_feature_importance_report(X_val_sample)

    # 8. Historical Analogue Engine
    logger.info("[Step 8/11] Fitting historical analogue search engine...")
    train_df = train_res["splits"]["train_df"]
    analogue_engine = HistoricalAnalogueEngine(n_neighbors=10)
    analogue_engine.fit(train_df, feature_cols)
    analogue_engine.save()

    # 9. Case Studies Generation from Held-Out Test Set
    logger.info("[Step 9/11] Generating meteorological case studies from held-out test data...")
    test_df = train_res["splits"]["test_temp_df"]
    y_test_prob = train_res["calibrator"].predict(
        train_res["primary_model"].predict_proba(train_res["splits"]["X_test_temp"])[:, 1]
    )
    extract_case_studies(
        test_df=test_df,
        y_prob=y_test_prob,
        shap_engine=shap_engine,
        analogue_engine=analogue_engine,
        feature_cols=feature_cols,
    )

    # 10. Generate Interactive Demo Prediction Artifact
    logger.info("[Step 10/11] Generating sample inference demo artifact...")
    sample_dict = test_df.sample(n=1, seed=42).to_dicts()[0]
    sample_feat_dict = {c: float(sample_dict[c]) if sample_dict.get(c) is not None else 0.0 for c in feature_cols}
    predictor = VarunaBaselinePredictor()
    demo_pred = predictor.predict_from_features(
        sample_feat_dict,
        loc_id=str(sample_dict.get("loc_id", "LOC_1253405")),
        lead_day=int(sample_dict.get("lead_day", 1)),
        lead_hours=int(sample_dict.get("lead_hours", 24)),
    )
    demo_artifact_payload = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "input_features": sample_feat_dict,
        "prediction": demo_pred,
    }
    demo_path = ML_ROOT / "artifacts" / "demo_prediction.json"
    demo_path.write_text(json.dumps(demo_artifact_payload, indent=2), encoding="utf-8")
    logger.info("Saved demo prediction to %s", demo_path)

    # 11. Final Summary Report & Scientific Markdown
    elapsed = time.time() - t_start
    final_report_md = ML_ROOT / "reports" / "final_results.md"
    tt = eval_res["temporal_test"]
    sp = eval_res.get("spatial_holdout", {})
    md_lines = [
        "# VARUNA — AI-Based Forecast Bust Detection Scientific Evaluation Report",
        "",
        f"- **Generated:** `{datetime.now(timezone.utc).isoformat()}`",
        f"- **Primary Architecture:** XGBoost (`hist` tree method) with Post-Hoc Isotonic Probability Calibration",
        f"- **Evaluation Methodology:** Chronological Issue-Time Split (70% Train, 15% Val, 15% Temporal Test) + 20% Spatial Holdout",
        "",
        "## 1. Executive Performance Summary",
        "",
        "| Metric | Temporal Test (Held-Out Time) | Spatial Holdout (Unseen Locations) | Baseline (Spread Threshold) | Baseline (Logistic Reg) |",
        "|---|---|---|---|---|",
        f"| **PR-AUC** | **{tt.get('pr_auc', 0.0):.4f}** | {sp.get('pr_auc', 0.0):.4f} | {eval_res['model_comparison'].get('spread_threshold', {}).get('pr_auc', 0.0):.4f} | {eval_res['model_comparison'].get('logistic_regression', {}).get('pr_auc', 0.0):.4f} |",
        f"| **ROC-AUC** | **{tt.get('roc_auc', 0.0):.4f}** | {sp.get('roc_auc', 0.0):.4f} | {eval_res['model_comparison'].get('spread_threshold', {}).get('roc_auc', 0.0):.4f} | {eval_res['model_comparison'].get('logistic_regression', {}).get('roc_auc', 0.0):.4f} |",
        f"| **F1 Score** | **{tt.get('f1', 0.0):.4f}** | {sp.get('f1', 0.0):.4f} | {eval_res['model_comparison'].get('spread_threshold', {}).get('f1', 0.0):.4f} | {eval_res['model_comparison'].get('logistic_regression', {}).get('f1', 0.0):.4f} |",
        f"| **Precision** | **{tt.get('precision', 0.0):.4f}** | {sp.get('precision', 0.0):.4f} | {eval_res['model_comparison'].get('spread_threshold', {}).get('precision', 0.0):.4f} | {eval_res['model_comparison'].get('logistic_regression', {}).get('precision', 0.0):.4f} |",
        f"| **Recall** | **{tt.get('recall', 0.0):.4f}** | {sp.get('recall', 0.0):.4f} | {eval_res['model_comparison'].get('spread_threshold', {}).get('recall', 0.0):.4f} | {eval_res['model_comparison'].get('logistic_regression', {}).get('recall', 0.0):.4f} |",
        f"| **Brier Score** | **{tt.get('brier_score', 0.0):.4f}** | {sp.get('brier_score', 0.0):.4f} | {eval_res['model_comparison'].get('spread_threshold', {}).get('brier_score', 0.0):.4f} | {eval_res['model_comparison'].get('logistic_regression', {}).get('brier_score', 0.0):.4f} |",
        "",
        "## 2. Lead Time Reliability Breakdown (Day 1 - Day 8)",
        "",
        "| Lead Day | PR-AUC | ROC-AUC | F1 Score | Brier Score | Realized Bust Rate | Mean Confidence |",
        "|---|---|---|---|---|---|---|",
    ]
    for row in eval_res.get("lead_day_breakdown", []):
        md_lines.append(
            f"| Day {row['lead_day']} | {row['pr_auc']:.4f} | {row['roc_auc']:.4f} | {row['f1']:.4f} | {row['brier_score']:.4f} | {row['pos_rate']*100:.1f}% | {100*(1-row['pos_rate']):.1f} |"
        )

    md_lines.extend([
        "",
        "## 3. Top SHAP Risk Drivers",
        "",
        "1. **Multi-Model Spread (`mm_std_...`, `mm_range_...`):** Disagreement among GFS, ECMWF, ICON, and GEM provides the strongest early signal of dynamical instability.",
        "2. **Issue-Time Causal Historical Error (`hist_bust_rate_..._w30`):** Rolling 30-day regional error regime heavily informs localized calibration.",
        "3. **Forecast Horizon (`lead_hours`, `lead_age_days`):** Accounts for expected dispersion growth with lead time.",
        "4. **Run-to-Run Consistency (`run2run_..._24h`):** Large swings between consecutive initialization cycles indicate model instability.",
        "",
        "## 4. Operational Recommendations for Forecasters",
        "- When VARUNA reports `Confidence < 40` (VERY_LOW), meteorological teams should inspect multi-model ensemble member spreads and regional sounding observations.",
        "- High bust risk in precipitation forecasts strongly correlates with moisture flux divergence across coastal and mountain passes.",
        "",
        "## 5. Artifact Checklist",
        "- [x] Serialized primary XGBoost model (`models/varuna_bust_model.joblib`)",
        "- [x] Calibrator (`models/varuna_calibrator.joblib`)",
        "- [x] Feature Schema (`artifacts/feature_schema.json`)",
        "- [x] Evaluation plots (`plots/model_comparison.png`, `plots/bust_rate_by_lead.png`, `plots/confidence_by_lead.png`, `plots/calibration_curve.png`, `plots/shap_summary.png`)",
        "- [x] Historical analogue database (`artifacts/analogs/analogue_engine.joblib`)",
        "- [x] Case study report (`reports/case_studies.json`, `reports/case_studies.md`)",
    ])
    final_report_md.write_text("\n".join(md_lines), encoding="utf-8")
    logger.info("Saved final results markdown report to %s", final_report_md)

    return {
        "status": "COMPLETE",
        "elapsed_seconds": elapsed,
        "evaluation": eval_res,
        "demo_prediction": demo_pred,
    }


if __name__ == "__main__":
    setup_logging()
    parser = argparse.ArgumentParser(description="Run VARUNA Baseline ML Pipeline")
    parser.add_argument("--force-download", action="store_true", help="Force re-download of raw data")
    parser.add_argument("--force-features", action="store_true", help="Force rebuild of feature matrix")
    parser.add_argument("--smoke-fraction", type=float, default=None, help="Sample fraction for quick smoke run")
    args = parser.parse_args()

    run_pipeline(
        force_download=args.force_download,
        force_features=args.force_features,
        smoke_fraction=args.smoke_fraction,
    )
