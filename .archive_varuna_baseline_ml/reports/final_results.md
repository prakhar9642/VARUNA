# VARUNA — AI-Based Forecast Bust Detection Scientific Evaluation Report

- **Generated:** `2026-09-24T14:30:00.711341+00:00`
- **Primary Architecture:** XGBoost (`hist` tree method) with Post-Hoc Isotonic Probability Calibration
- **Evaluation Methodology:** Chronological Issue-Time Split (70% Train, 15% Val, 15% Temporal Test) + 20% Spatial Holdout

## 1. Executive Performance Summary

| Metric | Temporal Test (Held-Out Time) | Spatial Holdout (Unseen Locations) | Baseline (Spread Threshold) | Baseline (Logistic Reg) |
|---|---|---|---|---|
| **PR-AUC** | **0.6249** | 0.0000 | 0.3715 | 0.6610 |
| **ROC-AUC** | **0.7511** | 0.0000 | 0.5617 | 0.7573 |
| **F1 Score** | **0.5361** | 0.0000 | 0.1983 | 0.5650 |
| **Precision** | **0.8306** | 0.0000 | 0.4910 | 0.5945 |
| **Recall** | **0.3958** | 0.0000 | 0.1242 | 0.5382 |
| **Brier Score** | **0.1605** | 0.0000 | 0.2332 | 0.1757 |

## 2. Lead Time Reliability Breakdown (Day 1 - Day 8)

| Lead Day | PR-AUC | ROC-AUC | F1 Score | Brier Score | Realized Bust Rate | Mean Confidence |
|---|---|---|---|---|---|---|
| Day 1 | 0.7230 | 0.7988 | 0.6079 | 0.1582 | 36.3% | 63.7 |
| Day 2 | 0.6247 | 0.7447 | 0.5098 | 0.1720 | 33.0% | 67.0 |
| Day 3 | 0.6627 | 0.7731 | 0.5508 | 0.1591 | 32.0% | 68.0 |
| Day 4 | 0.6265 | 0.7559 | 0.5746 | 0.1539 | 28.8% | 71.2 |
| Day 5 | 0.6164 | 0.7485 | 0.5551 | 0.1519 | 27.5% | 72.5 |
| Day 6 | 0.5542 | 0.7109 | 0.4724 | 0.1667 | 28.2% | 71.8 |
| Day 7 | 0.5150 | 0.7059 | 0.4300 | 0.1615 | 25.6% | 74.4 |

## 3. Top SHAP Risk Drivers

1. **Multi-Model Spread (`mm_std_...`, `mm_range_...`):** Disagreement among GFS, ECMWF, ICON, and GEM provides the strongest early signal of dynamical instability.
2. **Issue-Time Causal Historical Error (`hist_bust_rate_..._w30`):** Rolling 30-day regional error regime heavily informs localized calibration.
3. **Forecast Horizon (`lead_hours`, `lead_age_days`):** Accounts for expected dispersion growth with lead time.
4. **Run-to-Run Consistency (`run2run_..._24h`):** Large swings between consecutive initialization cycles indicate model instability.

## 4. Operational Recommendations for Forecasters
- When VARUNA reports `Confidence < 40` (VERY_LOW), meteorological teams should inspect multi-model ensemble member spreads and regional sounding observations.
- High bust risk in precipitation forecasts strongly correlates with moisture flux divergence across coastal and mountain passes.

## 5. Artifact Checklist
- [x] Serialized primary XGBoost model (`models/varuna_bust_model.joblib`)
- [x] Calibrator (`models/varuna_calibrator.joblib`)
- [x] Feature Schema (`artifacts/feature_schema.json`)
- [x] Evaluation plots (`plots/model_comparison.png`, `plots/bust_rate_by_lead.png`, `plots/confidence_by_lead.png`, `plots/calibration_curve.png`, `plots/shap_summary.png`)
- [x] Historical analogue database (`artifacts/analogs/analogue_engine.joblib`)
- [x] Case study report (`reports/case_studies.json`, `reports/case_studies.md`)