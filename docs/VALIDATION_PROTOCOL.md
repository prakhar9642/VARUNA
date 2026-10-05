# VARUNA: Validation Protocol & Scientific Integrity

**Document**: Anti-Leakage Chronological Validation Protocol  
**Status**: Authoritative  

---

## 1. Zero Temporal Leakage Principle

Weather prediction is strictly an autoregressive, time-dependent process. Shuffling time-series observations or performing random $k$-fold cross-validation causes severe information leakage:
- If date $T+1$ is in the training set and date $T$ is in the test set, the model memorizes atmospheric persistence and synoptic persistence, producing artificially low errors.

### The VARUNA Chronological Split
All meta-model evaluation strictly partitions aligned datasets chronologically across unique timestamps (zero leakage):
- **Training Set (65%)**: Earliest 608 timestamps ($T_0 \dots T_{607}$).
- **Validation Set (15%)**: Next 140 timestamps ($T_{608} \dots T_{747}$).
- **Held-Out Test Set (20%)**: Final 188 timestamps ($T_{748} \dots T_{935}$, Post-Monsoon window).
- **Disjoint Partition Guarantee**: All rows for any single timestamp share one partition; pairwise disjointness is asserted before training.

---

## 2. Multi-Variable Promotion Gate Protocol

Validation is an experiment, not a foregone conclusion. A variable is promoted to operational Adaptive XGBoost (`validated: true`) if and only if:
1. Held-out test RMSE improves over the best single NWP center by $\ge 1.0\%$.
2. MAE and bias remain non-pathological.
3. Variable-specific diagnostics pass:
   - For rainfall: contingency analysis demonstrates no severe suppression of wet-event detection (POD $\ge$ equal blend).
   - For wind speed: adaptive blend outperforms equal-weight consensus overall and does not degrade on high-wind deciles.

Variables failing the held-out gate remain on **operational equal-weight consensus** (`equal_fallback_untrained`, `validated: false`).

### Empirical Status:
- **Temperature:** PASSED (RMSE 0.780 °C, +29.4% vs best single, +18.7% vs equal blend) $\to$ **Adaptive XGBoost**
- **Surface Pressure:** PASSED (RMSE 0.674 hPa, +9.9% vs best single, +19.5% vs equal blend) $\to$ **Adaptive XGBoost**
- **Wind Speed:** FAILED (RMSE 2.224 vs equal blend 2.137 km/h, degrades on high winds) $\to$ **Equal-Weight Consensus**
- **Rainfall:** FAILED (POD drops to 75.2% vs 89.2% equal blend, 475 misses) $\to$ **Equal-Weight Consensus**

---

## 3. Invariant Rules of Scientific Integrity

1. **No Synthetic Waveforms**: Verification curves and RMSE values are derived from actual differences against ERA5 reanalysis reference points.
2. **No Hardcoded Multipliers**: The system strictly prohibits synthetic scaling constants (e.g. `blend_rmse = min_rmse * 0.78`).
3. **No Phantom Sample Counts**: Sample counts ($N = 4,512$ held-out rows per variable) match the exact dataframe rows.
4. **Transparent Degradation**: If an external API is unavailable or returns nulls, the system shifts to `REPLAY` or `DEMO` mode with an explicit badge in the UI.
5. **Truthful Gating**: Unvalidated variables explicitly declare `validated: false` and equal fallback rather than mimicking temperature skill.
