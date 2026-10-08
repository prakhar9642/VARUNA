# VARUNA Baseline ML Subsystem

**SIH26081 — AI-Based Forecast Bust Detection for Medium-Range Weather Forecasts**

---

## 1. Quickstart & Execution

### 1.1 Run Full End-to-End Pipeline
```bash
cd ml
python -m src.pipeline.run_all
```
This automatically orchestrates:
1. Data verification and schema validation
2. Flat core assembly and causal feature engineering
3. Feature leakage audit (`reports/leakage_audit.json`)
4. Baseline model benchmarking and primary XGBoost training
5. Validation-based probability calibration (Platt / Isotonic)
6. Comprehensive test set evaluation & SIH plot generation (`plots/`)
7. SHAP TreeExplainer analysis & human-readable reason generation
8. Historical analogue search engine fitting
9. Meteorological case studies generation (`reports/case_studies.json`)
10. Model artifact serialization (`models/`)

### 1.2 Run Offline Standalone CLI Demo
```bash
python -m src.inference.demo
```

### 1.3 Start the Production FastAPI Service
```bash
uvicorn src.inference.api:app --host 0.0.0.0 --port 8000 --reload
```
Interactive Swagger docs: `http://localhost:8000/docs`

### 1.4 Run Automated Test Suite
```bash
pytest tests/ -v
```

---

## 2. Directory Structure

```
ml/
├── configs/                  # Declarative YAML configurations (data, features, labels, models, confidence)
├── src/
│   ├── data/                 # Dataset download, loading, preprocessing, TIGGE adapter
│   ├── features/             # Multi-model spread, issue-time causal historical features, deltas
│   ├── labels/               # Training-only threshold estimation and bust label assignment
│   ├── models/               # Splitting, Baselines, XGBoost training, Probability calibration
│   ├── evaluation/           # Evaluation metrics, per-lead day, regional breakdown, SIH plots
│   ├── explainability/       # SHAP TreeExplainer, human-readable reason engine
│   ├── analogs/              # Nearest-neighbor historical case retrieval, case study extractor
│   ├── inference/            # Predictor service, FastAPI app, standalone CLI demo
│   ├── validation/           # Zero-leakage audit engine
│   └── pipeline/             # Master run_all orchestrator
├── artifacts/                # Persisted feature schemas, thresholds, split manifests
├── models/                   # Serialized XGBoost models, calibrators, and metadata
├── reports/                  # Data inventory, leakage audit, case studies, evaluation summary
├── plots/                    # SIH presentation figures (model comparison, lead decay, calibration)
├── tests/                    # Comprehensive pytest test suite
├── requirements.txt          # Python dependencies
└── README.md
```

---

## 3. Dataset & Provenance

- **Primary Source:** Real multi-model NWP forecast archive vs ERA5-Land ground truth for 127 Indian locations (9.58M rows).
- **Hugging Face Repository:** `Arko007/weathergpt-d1-mos-dataset`
- **Models:** GFS Seamless, ECMWF IFS 0.25°, ICON Seamless, GEM Seamless.
- **Variables:** 2m Temperature, Total Precipitation, 10m Wind Speed, 2m Relative Humidity.
- **Horizon:** Day 1 to Day 8 (up to 191 hours).

---

## 4. Scientific Integrity & Leakage Prevention

1. **No Target Leakage:** ERA5-Land ground truth is used strictly for retrospective label construction.
2. **Causal History:** Historical rolling performance statistics use data strictly before forecast issue time $T$.
3. **Strict Splitting:** Chronological time-series split on forecast initialization time + 20% spatial holdout locations.
4. **Calibration:** Calibrators fitted exclusively on validation partition.
