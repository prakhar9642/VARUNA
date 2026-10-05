# VARUNA Multi-Variable Scientific Validation Report

**Date Generated**: 2026-10-05 03:18:30 UTC  
**Reference Ground Truth**: ERA5 reanalysis (Open-Meteo archive API) — *deliberately treated as reference dataset, not station ground truth*  
**NWP Centers Synthesized**: ECMWF IFS (0.25°), ECMWF AIFS (0.25° ML), NOAA GFS (13km), DWD ICON (13km)  
**Benchmark Scope**: 6 synoptic benchmark regions, 4 benchmark seasons, operational leads (+24h, +48h, +72h, +120h)  
**Chronological Split**: Earliest 65% train, next 15% validation, final 20% held-out test (no shuffling, strict timestamp isolation)  

---

## 1. Executive Summary & Production Promotion Matrix

A variable is **strictly promoted** to production Adaptive XGBoost weighting only if held-out test evaluation demonstrates genuine, statistically sound improvement over both individual NWP members and equal-weight consensus without pathological degradation on tail diagnostics.

| Variable | Adaptive Model Trained | Held-Out Gate Passed | Best Single NWP Member | Equal Blend RMSE | Adaptive Blend RMSE | Improvement vs Best Single | Production Weighting Scheme |
| :--- | :---: | :---: | :--- | :---: | :---: | :---: | :--- |
| **Temperature** | Yes | **PASS** | ECMWF AIFS (1.1050) | 0.9600 | **0.7800** | +29.41% | **Adaptive XGBoost** |
| **Rainfall** | Yes | FAIL | NOAA GFS (0.3230) | 0.2820 | **0.2680** | +17.03% | Equal-Weight Consensus |
| **Wind Speed** | Yes | FAIL | ECMWF AIFS (2.4270) | 2.1370 | **2.2240** | +8.36% | Equal-Weight Consensus |
| **Pressure** | Yes | **PASS** | DWD ICON (0.7480) | 0.8380 | **0.6740** | +9.89% | **Adaptive XGBoost** |

---

## 2. Detailed Variable Evaluations

### 2.1 Temperature (°C)

- **Validation Gate Status**: ✅ **PROMOTED TO ADAPTIVE XGBOOST**
- **Decision Rationale**: Adaptive XGBoost weighting enabled after held-out validation (+29.4% vs ecmwf_aifs).

#### Held-Out Test Evaluation Matrix (N = 4,512, Post-Monsoon Season)

| System / Member | RMSE | MAE | Bias | Pearson r | Description |
| :--- | :---: | :---: | :---: | :---: | :--- |
| ECMWF IFS | 1.195 | 0.924 | -0.561 | 0.973 | Raw NWP Member |
| ECMWF AIFS | 1.105 | 0.866 | +0.51 | 0.981 | Raw NWP Member |
| NOAA GFS | 2.32 | 1.874 | +0.674 | 0.93 | Raw NWP Member |
| DWD ICON | 1.131 | 0.876 | +0.056 | 0.969 | Raw NWP Member |
| Equal Blend | 0.96 | 0.759 | +0.17 | 0.978 | Unweighted Consensus |
| Static Inverse Rmse Blend | 0.787 | 0.622 | +0.082 | 0.984 | Train-Derived Baseline |
| Varuna Adaptive | 0.78 | 0.612 | +0.066 | 0.984 | **VARUNA Adaptive Ensemble** |

### 2.2 Rainfall (mm)

- **Validation Gate Status**: ❌ **REMAINS EQUAL-WEIGHT CONSENSUS**
- **Decision Rationale**: Adaptive model trained but not promoted: zero-inflated skew suppresses precipitation detection (wet-event POD drops from 89.2% to 75.2%, missing 475 wet events) and underperforms equal blend at +24h lead.

#### Held-Out Test Evaluation Matrix (N = 4,512, Post-Monsoon Season)

| System / Member | RMSE | MAE | Bias | Pearson r | Description |
| :--- | :---: | :---: | :---: | :---: | :--- |
| ECMWF IFS | 0.425 | 0.172 | +0.102 | 0.389 | Raw NWP Member |
| ECMWF AIFS | 0.447 | 0.19 | +0.133 | 0.332 | Raw NWP Member |
| NOAA GFS | 0.323 | 0.126 | -0.025 | 0.231 | Raw NWP Member |
| DWD ICON | 0.333 | 0.131 | -0.019 | 0.294 | Raw NWP Member |
| Equal Blend | 0.282 | 0.128 | +0.048 | 0.45 | Unweighted Consensus |
| Static Inverse Rmse Blend | 0.297 | 0.137 | +0.064 | 0.446 | Train-Derived Baseline |
| Varuna Adaptive | 0.268 | 0.104 | -0.006 | 0.427 | **VARUNA Adaptive Ensemble** |

#### Rainfall-Specific Zero-Inflation & Detection Diagnostics
- **Zero-Inflation Ratio**: 2596 dry hours (57.5%) vs 1916 wet hours (42.5%).
- **Contingency Analysis (Measurable Precipitation Threshold ≥ 0.1 mm/h)**:

| System | Hits | Misses | False Alarms | Hit Rate (POD) | False Alarm Ratio (FAR) | Critical Success Index (CSI) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| ECMWF IFS | 1765 | 151 | 632 | 0.921 | 0.264 | 0.693 |
| ECMWF AIFS | 1858 | 58 | 1055 | 0.970 | 0.362 | 0.625 |
| NOAA GFS | 1142 | 774 | 174 | 0.596 | 0.132 | 0.546 |
| DWD ICON | 1095 | 821 | 202 | 0.572 | 0.156 | 0.517 |
| Equal Blend | 1710 | 206 | 509 | 0.892 | 0.229 | 0.705 |
| Varuna Adaptive | 1441 | 475 | 244 | 0.752 | 0.145 | 0.667 |

> **Scientific Finding**: Although VARUNA Adaptive achieves a lower overall RMSE (0.268 mm vs 0.282 mm) by penalizing false alarms on dry hours, its wet-event Probability of Detection (POD) drops from 89.2% to 75.2% (missing 475 wet hours vs 206 for equal consensus). Furthermore, it degrades error at +24h lead (-8.3% vs equal blend). Because precipitation is zero-inflated and detection preservation is critical, **rainfall fails the promotion gate and remains on equal consensus**.

### 2.3 Wind Speed (km/h)

- **Validation Gate Status**: ❌ **REMAINS EQUAL-WEIGHT CONSENSUS**
- **Decision Rationale**: Adaptive model trained but not promoted: adaptive blend RMSE (2.224 km/h) underperforms equal-weight consensus (2.137 km/h) across leads and degrades on high winds.

#### Held-Out Test Evaluation Matrix (N = 4,512, Post-Monsoon Season)

| System / Member | RMSE | MAE | Bias | Pearson r | Description |
| :--- | :---: | :---: | :---: | :---: | :--- |
| ECMWF IFS | 3.441 | 2.766 | -0.556 | 0.625 | Raw NWP Member |
| ECMWF AIFS | 2.427 | 1.9 | -0.328 | 0.799 | Raw NWP Member |
| NOAA GFS | 6.098 | 4.953 | +3.881 | 0.648 | Raw NWP Member |
| DWD ICON | 4.031 | 3.329 | -2.077 | 0.569 | Raw NWP Member |
| Equal Blend | 2.137 | 1.655 | +0.23 | 0.846 | Unweighted Consensus |
| Static Inverse Rmse Blend | 2.171 | 1.707 | -0.105 | 0.84 | Train-Derived Baseline |
| Varuna Adaptive | 2.224 | 1.741 | -0.043 | 0.831 | **VARUNA Adaptive Ensemble** |

#### Wind Speed Tail & High-Wind Diagnostics
- **Distribution**: 75th percentile = 13.6 km/h, 90th percentile = 15.9 km/h.
- **High Winds Regime (≥ 15.9 km/h, N = 452)**:
  - Equal Blend: RMSE = 2.487 km/h, MAE = 2.1124 km/h, Bias = -2.0033 km/h
  - VARUNA Adaptive: RMSE = 3.0927 km/h, MAE = 2.7866 km/h, Bias = -2.6461 km/h

> **Scientific Finding**: Although VARUNA Adaptive improves over individual NWP models, it **underperforms the Equal-Weight Blend across all operational leads** (+24h: 2.05 vs 1.98 km/h, +48h: 2.11 vs 1.99 km/h, +72h: 2.28 vs 2.20 km/h, +120h: 2.43 vs 2.36 km/h) and noticeably degrades in higher-wind conditions (high-wind RMSE degrades from 2.49 to 3.09 km/h). Promoting adaptive weighting would represent an active regression over the operational equal-weight consensus. Therefore, **wind speed fails the promotion gate and remains on equal consensus**.

### 2.4 Pressure (hPa)

- **Validation Gate Status**: ✅ **PROMOTED TO ADAPTIVE XGBOOST**
- **Decision Rationale**: Adaptive XGBoost weighting enabled after held-out validation (+9.9% vs dwd_icon, +19.6% vs equal blend).

#### Held-Out Test Evaluation Matrix (N = 4,512, Post-Monsoon Season)

| System / Member | RMSE | MAE | Bias | Pearson r | Description |
| :--- | :---: | :---: | :---: | :---: | :--- |
| ECMWF IFS | 0.932 | 0.751 | -0.692 | 1.0 | Raw NWP Member |
| ECMWF AIFS | 0.809 | 0.637 | -0.257 | 1.0 | Raw NWP Member |
| NOAA GFS | 1.763 | 1.459 | -1.399 | 1.0 | Raw NWP Member |
| DWD ICON | 0.748 | 0.602 | -0.483 | 1.0 | Raw NWP Member |
| Equal Blend | 0.838 | 0.727 | -0.708 | 1.0 | Unweighted Consensus |
| Static Inverse Rmse Blend | 0.716 | 0.592 | -0.547 | 1.0 | Train-Derived Baseline |
| Varuna Adaptive | 0.674 | 0.54 | -0.45 | 1.0 | **VARUNA Adaptive Ensemble** |

#### Surface Pressure Stability Diagnostics
- **Multi-Lead Superiority**: VARUNA Adaptive outperforms the best single NWP center at every operational lead (+24h: +18.2%, +48h: +10.7%, +72h: +13.2%, +120h: +2.1%) and beats equal blend by +14.5% to +32.3%.
- **Weight Dispersion**: Weights are well-balanced across centers (AIFS 40.4%, IFS 27.6%, ICON 25.0%, GFS 7.0%) without pathological collapse to one member.

> **Scientific Finding**: Surface pressure exhibits strong synoptic coherence, and XGBoost successfully learns contextual barometric error corrections across centers, improving RMSE by +9.82% over the best single NWP center (DWD ICON) and +19.48% over equal blend. **Surface pressure passes validation and is promoted to Adaptive XGBoost**.

---

## 3. Methodological Protocol & Scientific Integrity Guards

1. **Leakage Protection**: Models were trained strictly on the 65% train partition. Feature sets contain NO ERA5 reanalysis inputs at forecast time. Validation (15%) and Held-out Test (20%) partitions were partitioned chronologically by unique timestamps with zero temporal overlap.
2. **Baseline Fairness**: Static inverse-RMSE weights were derived exclusively from the training partition.
3. **Zero Synthetic Metric Rule**: Every reported metric in this document was calculated directly from verified historical Open-Meteo previous runs aligned with ERA5 reanalysis.
4. **Truthful Operational Status**: Only temperature and surface pressure are promoted to adaptive weighting. Rainfall and wind speed remain on equal-weight consensus.