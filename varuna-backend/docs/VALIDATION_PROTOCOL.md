# Validation Protocol

## 1. What is being verified

| item | value |
|------|-------|
| target variables | `temperature_2m` (°C), `surface_pressure` (hPa), `wind_speed_10m` (km/h), `precipitation` (mm) |
| reference | ERA5 reanalysis (Open-Meteo archive, `models=era5`) |
| models | `ecmwf_ifs025`, `ecmwf_aifs025_single`, `gfs_seamless`, `icon_seamless` |
| leads | 24, 48, 72, 120 h (`previous_day1/2/3/5`) |
| regions | 6 benchmarked |
| windows | winter Jan 10–17, pre-monsoon Apr 10–17, monsoon Jul 1–15, post-monsoon Sep 1–8 (2026) |
| metrics | RMSE, MAE, bias (mean error), Pearson r |

"Reference" is used deliberately: ERA5 is a reanalysis, not station
observation and not ground truth (`docs/DATA_PROVENANCE.md`).

## 2. Alignment

1. Fetch archived forecast runs for a (region, window, lead, variable) from
   the Previous-Runs API — one `previous_dayN` field per lead.
2. Fetch ERA5 for the same coordinates and window.
3. Keep a row only where forecast timestamp **and** reference timestamp both
   exist and match exactly. No interpolation, no nearest-time substitution,
   no filling. Dropped rows are counted in `data/provenance.json`
   (`failed_fetches`).
4. Compute per-model `err`, `abs_err`, `sq_err` against ERA5, plus shared
   features: `ensemble_mean`, `ensemble_spread` (available members only),
   `day_of_year`, `hour_of_day`, `month`, `regime_index` (from ensemble values,
   never ERA5).

Result: **86,004 total aligned rows / 936 unique timestamps** (wind_speed: 22,464, rainfall: 21,474, temperature: 21,042, pressure: 21,024), 6 regions × 4 seasons × 4 leads. Test partition contains exactly 4,512 rows for each variable.

## 3. Split (leakage guards)

* Chronological by **unique timestamp**: earliest 65% train, next 15%
  validation, final 20% test. No shuffling.
* All rows of one timestamp share one partition (asserted in
  `tests/test_split.py`).
* The pipeline asserts pairwise-disjoint timestamp sets before training and
  aborts otherwise.
* ERA5 never appears as a forecast-time feature; it is only the training
  target `|forecast − ERA5|` and the evaluation reference.
* Static inverse-RMSE weights are computed from **TRAIN rows only**.

## 4. Models trained

Four `XGBRegressor` (one per forecast model), spec-exact:

```
n_estimators = 80, max_depth = 4, learning_rate = 0.06,
subsample = 1.0, colsample_bytree = 1.0,
objective = reg:squarederror, random_state = 42
```

Target per model: `y = |forecast_model − ERA5|`.
Features (fixed 11, fixed order): `latitude, longitude, elevation_m,
lead_time_hours, day_of_year, hour_of_day, month, regime_index,
ensemble_mean, ensemble_spread, model_own_forecast` — where
`model_own_forecast` is that model's own forecast value.

## 5. Systems compared (identical rows)

| system | definition |
|--------|-----------|
| 4 single models | raw member forecasts |
| `equal_blend` | unweighted mean |
| `static_inverse_rmse_blend` | train-only inverse-RMSE integer weights |
| `varuna_adaptive` | per-row XGB predicted errors → `w ∝ 1/E²` → Hamilton-Hare integers |

Blend rule everywhere: `blend = Σ (w_i/100) × value_i`, integer weights summing
to exactly 100, never renormalised, null members skipped.

## 6. Headline results across variables (held-out, `scope: held_out_test`, n = 4,512)

### A. 2m Temperature (°C) — VALIDATED & PROMOTED
| system | RMSE | MAE | bias | r | Decision |
|--------|------|-----|------|---|:---:|
| ecmwf_ifs | 1.195 | 0.924 | −0.561 | 0.973 | |
| ecmwf_aifs (best NWP) | 1.105 | 0.866 | +0.510 | 0.981 | |
| ncep_gfs | 2.320 | 1.874 | +0.674 | 0.930 | |
| dwd_icon | 1.131 | 0.876 | +0.056 | 0.969 | |
| equal_blend | 0.960 | 0.759 | +0.170 | 0.978 | |
| static_inverse_rmse | 0.787 | 0.622 | +0.082 | 0.984 | |
| **varuna_adaptive** | **0.780** | **0.612** | **+0.066** | **0.984** | **PROMOTED** (+29.4% vs best single, +18.7% vs equal) |

### B. Surface Pressure (hPa) — VALIDATED & PROMOTED
| system | RMSE | MAE | bias | r | Decision |
|--------|------|-----|------|---|:---:|
| ecmwf_ifs | 0.932 | 0.751 | −0.692 | 1.000 | |
| ecmwf_aifs | 0.809 | 0.637 | −0.257 | 1.000 | |
| ncep_gfs | 1.763 | 1.459 | −1.399 | 1.000 | |
| dwd_icon (best NWP) | 0.748 | 0.602 | −0.483 | 1.000 | |
| equal_blend | 0.838 | 0.727 | −0.708 | 1.000 | |
| static_inverse_rmse | 0.716 | 0.592 | −0.547 | 1.000 | |
| **varuna_adaptive** | **0.674** | **0.540** | **−0.450** | **1.000** | **PROMOTED** (+9.9% vs best single, +19.5% vs equal) |

### C. 10m Wind Speed (km/h) — GATE NOT PASSED (Equal Consensus Fallback)
| system | RMSE | MAE | bias | r | Decision |
|--------|------|-----|------|---|:---:|
| ecmwf_ifs | 3.441 | 2.766 | −0.556 | 0.625 | |
| ecmwf_aifs (best NWP) | 2.427 | 1.900 | −0.328 | 0.799 | |
| ncep_gfs | 6.098 | 4.953 | +3.881 | 0.648 | |
| dwd_icon | 4.031 | 3.329 | −2.077 | 0.569 | |
| **equal_blend** | **2.137** | **1.655** | **+0.230** | **0.846** | **OPERATIONAL SELECTION** |
| static_inverse_rmse | 2.171 | 1.707 | −0.105 | 0.840 | |
| varuna_adaptive | 2.224 | 1.741 | −0.043 | 0.831 | **FAILED** (underperforms equal blend by -4.06%) |

*Rationale:* Adaptive weighting is worse than equal blend across all lead times (+24h: 2.05 vs 1.98; +48h: 2.11 vs 1.99; +72h: 2.28 vs 2.20; +120h: 2.43 vs 2.36) and degrades severely on the upper 10% high-wind decile (RMSE 3.09 vs 2.49 km/h). Retained on equal consensus (`validated: false`).

### D. Precipitation (mm) — GATE NOT PASSED (Equal Consensus Fallback)
| system | RMSE | MAE | bias | r | Decision |
|--------|------|-----|------|---|:---:|
| ecmwf_ifs | 0.425 | 0.172 | +0.102 | 0.389 | |
| ecmwf_aifs | 0.447 | 0.190 | +0.133 | 0.332 | |
| ncep_gfs (best single) | 0.323 | 0.126 | −0.025 | 0.231 | |
| dwd_icon | 0.333 | 0.131 | −0.019 | 0.294 | |
| **equal_blend** | **0.282** | **0.128** | **+0.048** | **0.450** | **OPERATIONAL SELECTION** |
| static_inverse_rmse | 0.297 | 0.137 | +0.064 | 0.446 | |
| varuna_adaptive | 0.268 | 0.104 | −0.006 | 0.427 | **FAILED** (contingency hit rate degradation) |

*Rationale:* 57.54% zero-inflation causes the adaptive model to suppress wet-event detection. On rainy hours ($\ge 0.1$ mm/h), the adaptive blend hit rate (POD) drops to 75.2% (missing 475 wet events) vs 89.2% (206 misses) for equal blend. At +24h lead, adaptive RMSE is 0.257 vs 0.237 equal blend (-8.3% worse). Retained on equal consensus (`validated: false`).

## 7. Reproduce

```sh
cd varuna-backend
pip install -r requirements.txt
python scripts/run_pipeline.py --variables temperature,pressure,rainfall,wind_speed
python -m pytest tests -q
python -m uvicorn app.main:app --port 8000
```

The pipeline writes aligned data, `data/provenance.json`, `data/replay/timelines.json`,
`models/xgboost_meta_<var>.joblib`, `reports/blend_test_results_<var>.csv`,
`reports/skill_by_*_<var>.csv`, `reports/variable_validation_summary.csv`, and
`reports/MULTIVARIABLE_VALIDATION_REPORT.md`.

## 8. Regression gate

`pytest` must pass before any commit:

* Multi-variable bundle loading, saving, and variable isolation (`test_multivariable_validation.py`)
* Hamilton-Hare integer apportionment (`test_weighting.py`)
* Null handling and missing member robustness (`test_nulls.py`)
* Chronological split disjointness (`test_split.py`)
* Regime classification determinism (`test_regime.py`)
* Extreme alerts and hazard validation flags (`test_extremes.py`)
* API contract + LIVE→CACHED→REPLAY resilience (`test_api.py`)

## 9. What is deliberately NOT claimed

* No adaptive ML claim for rainfall or wind speed (gate failed → `validated: false`, operational equal consensus).
* No skill claim for the 6 non-benchmarked regional monitoring stations.
* No station-observation accuracy claim (ERA5 reanalysis reference).
* No forecast claim in `REPLAY` mode.
