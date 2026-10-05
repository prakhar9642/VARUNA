"""
Research and Validation Partition Experimentation for Rainfall and Wind Speed
=============================================================================
Strictly uses TRAIN (65%) for fitting and VALIDATION (15%) for candidate evaluation.
Held-out TEST (20%) is NOT touched during experimentation.
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np
import pandas as pd
from xgboost import XGBRegressor, XGBClassifier
from app.config import BENCHMARK_REGION_IDS, BENCHMARK_WINDOWS, LEAD_TIMES, MODEL_KEYS, FEATURE_NAMES, WEIGHT_EPSILON
from app.science.alignment import collect_all_rows, split_partitions
from app.science.meta_model import build_feature_frame
from app.science.verification import metrics
from app.science.weighting import weights_from_predicted_errors, blend_value, hamilton_hare

print("Loading aligned dataset...")
df_all = pd.read_csv(Path(__file__).resolve().parents[1] / "data" / "aligned_multi_season_lead_data.csv")

# =========================================================================
# EXPERIMENT 1: RAINFALL ON VALIDATION PARTITION
# =========================================================================
print("\n" + "="*80)
print("EXPERIMENT 1: RAINFALL CANDIDATE ARCHITECTURES ON VALIDATION PARTITION")
print("="*80)

df_rain = df_all[df_all["variable"] == "rainfall"].reset_index(drop=True)
train_r, val_r, test_r = split_partitions(df_rain)
print(f"Rainfall partition sizes: Train={len(train_r)}, Val={len(val_r)}, Test={len(test_r)}")

ref_val = val_r["reference_val"].to_numpy(dtype=float)
cols_val = {m: val_r[f"{m}_val"].to_numpy(dtype=float) for m in MODEL_KEYS}
equal_val = np.mean(np.vstack([cols_val[m] for m in MODEL_KEYS]), axis=0)

eq_metrics = metrics(equal_val, ref_val)
thresh = 0.1
ref_event_val = ref_val >= thresh
eq_event = equal_val >= thresh
hits_eq = int(np.sum(eq_event & ref_event_val))
miss_eq = int(np.sum((~eq_event) & ref_event_val))
fa_eq = int(np.sum(eq_event & (~ref_event_val)))
pod_eq = hits_eq / (hits_eq + miss_eq) if (hits_eq + miss_eq) > 0 else 0
far_eq = fa_eq / (hits_eq + fa_eq) if (hits_eq + fa_eq) > 0 else 0
csi_eq = hits_eq / (hits_eq + miss_eq + fa_eq) if (hits_eq + miss_eq + fa_eq) > 0 else 0

print(f"Equal Blend Baseline (Val): RMSE={eq_metrics['rmse']:.4f}, MAE={eq_metrics['mae']:.4f}, Bias={eq_metrics['bias']:.4f}, POD={pod_eq*100:.1f}%, Misses={miss_eq}, CSI={csi_eq:.3f}")
for m in MODEL_KEYS:
    m_m = metrics(cols_val[m], ref_val)
    m_event = cols_val[m] >= thresh
    h = int(np.sum(m_event & ref_event_val))
    mi = int(np.sum((~m_event) & ref_event_val))
    print(f"  Single NWP {m:12s} (Val): RMSE={m_m['rmse']:.4f}, MAE={m_m['mae']:.4f}, Bias={m_m['bias']:.4f}, POD={h/(h+mi)*100:.1f}%, Misses={mi}")

# Candidate A: Baseline Direct Absolute Error (Previous implementation)
models_base = {}
for m in MODEL_KEYS:
    X_tr = build_feature_frame(train_r, model_key=m)
    y_tr = train_r[f"{m}_abs_err"].astype(float)
    xgb = XGBRegressor(n_estimators=100, max_depth=5, learning_rate=0.08, subsample=0.8, colsample_bytree=0.8, random_state=42)
    xgb.fit(X_tr, y_tr)
    models_base[m] = xgb

pred_base = {}
for m in MODEL_KEYS:
    X_va = build_feature_frame(val_r, model_key=m)
    pred_base[m] = pd.Series(np.maximum(models_base[m].predict(X_va), WEIGHT_EPSILON), index=val_r.index)

adapt_base = np.empty(len(val_r), dtype=float)
for pos, idx in enumerate(val_r.index):
    errs = {m: float(pred_base[m].loc[idx]) for m in MODEL_KEYS}
    w = weights_from_predicted_errors(errs)
    vals = {m: float(cols_val[m][pos]) for m in MODEL_KEYS}
    adapt_base[pos] = blend_value(vals, w)

base_m = metrics(adapt_base, ref_val)
base_ev = adapt_base >= thresh
h_b = int(np.sum(base_ev & ref_event_val))
mi_b = int(np.sum((~base_ev) & ref_event_val))
csi_b = h_b / (h_b + mi_b + int(np.sum(base_ev & (~ref_event_val))))
print(f"Candidate A (Direct Abs Err): RMSE={base_m['rmse']:.4f}, MAE={base_m['mae']:.4f}, Bias={base_m['bias']:.4f}, POD={h_b/(h_b+mi_b)*100:.1f}%, Misses={mi_b}, CSI={csi_b:.3f}")

# Candidate B: log1p transformed error target: log1p(abs_err)
models_log = {}
for m in MODEL_KEYS:
    X_tr = build_feature_frame(train_r, model_key=m)
    y_tr = np.log1p(train_r[f"{m}_abs_err"].astype(float))
    xgb = XGBRegressor(n_estimators=100, max_depth=5, learning_rate=0.08, subsample=0.8, colsample_bytree=0.8, random_state=42)
    xgb.fit(X_tr, y_tr)
    models_log[m] = xgb

pred_log = {}
for m in MODEL_KEYS:
    X_va = build_feature_frame(val_r, model_key=m)
    pred_log[m] = pd.Series(np.maximum(np.expm1(models_log[m].predict(X_va)), WEIGHT_EPSILON), index=val_r.index)

adapt_log = np.empty(len(val_r), dtype=float)
for pos, idx in enumerate(val_r.index):
    errs = {m: float(pred_log[m].loc[idx]) for m in MODEL_KEYS}
    w = weights_from_predicted_errors(errs)
    vals = {m: float(cols_val[m][pos]) for m in MODEL_KEYS}
    adapt_log[pos] = blend_value(vals, w)

log_m = metrics(adapt_log, ref_val)
log_ev = adapt_log >= thresh
h_l = int(np.sum(log_ev & ref_event_val))
mi_l = int(np.sum((~log_ev) & ref_event_val))
csi_l = h_l / (h_l + mi_l + int(np.sum(log_ev & (~ref_event_val))))
print(f"Candidate B (log1p Target):   RMSE={log_m['rmse']:.4f}, MAE={log_m['mae']:.4f}, Bias={log_m['bias']:.4f}, POD={h_l/(h_l+mi_l)*100:.1f}%, Misses={mi_l}, CSI={csi_l:.3f}")

# Candidate C: Relative / Normalized error or Squared Error target
models_sq = {}
for m in MODEL_KEYS:
    X_tr = build_feature_frame(train_r, model_key=m)
    y_tr = train_r[f"{m}_sq_err"].astype(float)
    xgb = XGBRegressor(n_estimators=100, max_depth=5, learning_rate=0.08, subsample=0.8, colsample_bytree=0.8, random_state=42)
    xgb.fit(X_tr, y_tr)
    models_sq[m] = xgb

pred_sq = {}
for m in MODEL_KEYS:
    X_va = build_feature_frame(val_r, model_key=m)
    pred_sq[m] = pd.Series(np.maximum(np.sqrt(np.maximum(models_sq[m].predict(X_va), 0)), WEIGHT_EPSILON), index=val_r.index)

adapt_sq = np.empty(len(val_r), dtype=float)
for pos, idx in enumerate(val_r.index):
    errs = {m: float(pred_sq[m].loc[idx]) for m in MODEL_KEYS}
    w = weights_from_predicted_errors(errs)
    vals = {m: float(cols_val[m][pos]) for m in MODEL_KEYS}
    adapt_sq[pos] = blend_value(vals, w)

sq_m = metrics(adapt_sq, ref_val)
sq_ev = adapt_sq >= thresh
h_s = int(np.sum(sq_ev & ref_event_val))
mi_s = int(np.sum((~sq_ev) & ref_event_val))
csi_s = h_s / (h_s + mi_s + int(np.sum(sq_ev & (~ref_event_val))))
print(f"Candidate C (Sqrt of Sq Err): RMSE={sq_m['rmse']:.4f}, MAE={sq_m['mae']:.4f}, Bias={sq_m['bias']:.4f}, POD={h_s/(h_s+mi_s)*100:.1f}%, Misses={mi_s}, CSI={csi_s:.3f}")

# Candidate D: Wet-Stratified / Event-Conditioned Weighting
# When ensemble indicates rain (ensemble_mean > 0.1), train error models ONLY on wet samples (reference > 0 or model > 0)
# or weight based on wet-regime error
models_wet = {}
wet_train = train_r[(train_r["ensemble_mean"] >= 0.1) | (train_r["reference_val"] >= 0.1)]
for m in MODEL_KEYS:
    X_tr = build_feature_frame(wet_train, model_key=m)
    y_tr = wet_train[f"{m}_abs_err"].astype(float)
    xgb = XGBRegressor(n_estimators=100, max_depth=5, learning_rate=0.08, subsample=0.8, colsample_bytree=0.8, random_state=42)
    xgb.fit(X_tr, y_tr)
    models_wet[m] = xgb

pred_wet = {}
for m in MODEL_KEYS:
    X_va = build_feature_frame(val_r, model_key=m)
    pred_wet[m] = pd.Series(np.maximum(models_wet[m].predict(X_va), WEIGHT_EPSILON), index=val_r.index)

adapt_wet = np.empty(len(val_r), dtype=float)
for pos, idx in enumerate(val_r.index):
    ens_mean = float(val_r["ensemble_mean"].iloc[pos])
    if ens_mean < 0.1:
        # Dry regime: equal blend or dry weights
        w = {m: 25 for m in MODEL_KEYS}
    else:
        errs = {m: float(pred_wet[m].loc[idx]) for m in MODEL_KEYS}
        w = weights_from_predicted_errors(errs)
    vals = {m: float(cols_val[m][pos]) for m in MODEL_KEYS}
    adapt_wet[pos] = blend_value(vals, w)

wet_m = metrics(adapt_wet, ref_val)
wet_ev = adapt_wet >= thresh
h_w = int(np.sum(wet_ev & ref_event_val))
mi_w = int(np.sum((~wet_ev) & ref_event_val))
csi_w = h_w / (h_w + mi_w + int(np.sum(wet_ev & (~ref_event_val))))
print(f"Candidate D (Wet Stratified): RMSE={wet_m['rmse']:.4f}, MAE={wet_m['mae']:.4f}, Bias={wet_m['bias']:.4f}, POD={h_w/(h_w+mi_w)*100:.1f}%, Misses={mi_w}, CSI={csi_w:.3f}")


# =========================================================================
# EXPERIMENT 2: WIND SPEED ON VALIDATION PARTITION
# =========================================================================
print("\n" + "="*80)
print("EXPERIMENT 2: WIND SPEED CANDIDATE ARCHITECTURES ON VALIDATION PARTITION")
print("="*80)

df_wind = df_all[df_all["variable"] == "wind_speed"].reset_index(drop=True)
train_w, val_w, test_w = split_partitions(df_wind)
print(f"Wind speed partition sizes: Train={len(train_w)}, Val={len(val_w)}, Test={len(test_w)}")

ref_w_val = val_w["reference_val"].to_numpy(dtype=float)
cols_w_val = {m: val_w[f"{m}_val"].to_numpy(dtype=float) for m in MODEL_KEYS}
equal_w_val = np.mean(np.vstack([cols_w_val[m] for m in MODEL_KEYS]), axis=0)

eq_w_m = metrics(equal_w_val, ref_w_val)
p90_w = float(np.percentile(ref_w_val, 90))
high_mask_w = ref_w_val >= p90_w
eq_w_high_rmse = float(np.sqrt(np.mean((equal_w_val[high_mask_w] - ref_w_val[high_mask_w])**2)))
print(f"Equal Blend Baseline (Val): Overall RMSE={eq_w_m['rmse']:.4f}, MAE={eq_w_m['mae']:.4f}, Bias={eq_w_m['bias']:.4f}, High-Wind RMSE={eq_w_high_rmse:.4f}")
for m in MODEL_KEYS:
    m_m = metrics(cols_w_val[m], ref_w_val)
    m_h_rmse = float(np.sqrt(np.mean((cols_w_val[m][high_mask_w] - ref_w_val[high_mask_w])**2)))
    print(f"  Single NWP {m:12s} (Val): Overall RMSE={m_m['rmse']:.4f}, Bias={m_m['bias']:.4f}, High-Wind RMSE={m_h_rmse:.4f}")

# Candidate W1: Standard Baseline
models_w_base = {}
for m in MODEL_KEYS:
    X_tr = build_feature_frame(train_w, model_key=m)
    y_tr = train_w[f"{m}_abs_err"].astype(float)
    xgb = XGBRegressor(n_estimators=100, max_depth=5, learning_rate=0.08, subsample=0.8, colsample_bytree=0.8, random_state=42)
    xgb.fit(X_tr, y_tr)
    models_w_base[m] = xgb

pred_w_base = {}
for m in MODEL_KEYS:
    X_va = build_feature_frame(val_w, model_key=m)
    pred_w_base[m] = pd.Series(np.maximum(models_w_base[m].predict(X_va), WEIGHT_EPSILON), index=val_w.index)

adapt_w_base = np.empty(len(val_w), dtype=float)
for pos, idx in enumerate(val_w.index):
    errs = {m: float(pred_w_base[m].loc[idx]) for m in MODEL_KEYS}
    w = weights_from_predicted_errors(errs)
    vals = {m: float(cols_w_val[m][pos]) for m in MODEL_KEYS}
    adapt_w_base[pos] = blend_value(vals, w)

w_base_m = metrics(adapt_w_base, ref_w_val)
w_base_high_rmse = float(np.sqrt(np.mean((adapt_w_base[high_mask_w] - ref_w_val[high_mask_w])**2)))
print(f"Candidate W1 (Standard Abs Err): Overall RMSE={w_base_m['rmse']:.4f}, Bias={w_base_m['bias']:.4f}, High-Wind RMSE={w_base_high_rmse:.4f}")

# Candidate W2: Bias-corrected members or Squared error
# NOAA GFS has +3.88 bias, DWD ICON has -2.08 bias.
# What if we predict signed error (bias) per member and correct it: member_corrected = member - predicted_bias?
models_bias = {}
for m in MODEL_KEYS:
    X_tr = build_feature_frame(train_w, model_key=m)
    y_tr = train_w[f"{m}_err"].astype(float)  # signed error: forecast - ERA5
    xgb = XGBRegressor(n_estimators=100, max_depth=5, learning_rate=0.08, subsample=0.8, colsample_bytree=0.8, random_state=42)
    xgb.fit(X_tr, y_tr)
    models_bias[m] = xgb

pred_bias = {}
for m in MODEL_KEYS:
    X_va = build_feature_frame(val_w, model_key=m)
    pred_bias[m] = models_bias[m].predict(X_va)

# If we correct bias on members:
corrected_val = {}
for m in MODEL_KEYS:
    corrected_val[m] = cols_w_val[m] - pred_bias[m]

# Equal blend of bias-corrected members:
blend_corrected = np.mean(np.vstack([corrected_val[m] for m in MODEL_KEYS]), axis=0)
w_bc_m = metrics(blend_corrected, ref_w_val)
w_bc_high_rmse = float(np.sqrt(np.mean((blend_corrected[high_mask_w] - ref_w_val[high_mask_w])**2)))
print(f"Candidate W2 (Bias Corrected Equal Blend): Overall RMSE={w_bc_m['rmse']:.4f}, Bias={w_bc_m['bias']:.4f}, High-Wind RMSE={w_bc_high_rmse:.4f}")

# Candidate W3: Robust Loss / Huber loss or high-wind sample weighting
sample_weights_w = np.where(train_w["reference_val"] >= np.percentile(train_w["reference_val"], 75), 2.5, 1.0)
models_w_weighted = {}
for m in MODEL_KEYS:
    X_tr = build_feature_frame(train_w, model_key=m)
    y_tr = train_w[f"{m}_abs_err"].astype(float)
    xgb = XGBRegressor(n_estimators=100, max_depth=5, learning_rate=0.08, subsample=0.8, colsample_bytree=0.8, random_state=42)
    xgb.fit(X_tr, y_tr, sample_weight=sample_weights_w)
    models_w_weighted[m] = xgb

pred_w_wt = {}
for m in MODEL_KEYS:
    X_va = build_feature_frame(val_w, model_key=m)
    pred_w_wt[m] = pd.Series(np.maximum(models_w_weighted[m].predict(X_va), WEIGHT_EPSILON), index=val_w.index)

adapt_w_wt = np.empty(len(val_w), dtype=float)
for pos, idx in enumerate(val_w.index):
    errs = {m: float(pred_w_wt[m].loc[idx]) for m in MODEL_KEYS}
    w = weights_from_predicted_errors(errs)
    vals = {m: float(cols_w_val[m][pos]) for m in MODEL_KEYS}
    adapt_w_wt[pos] = blend_value(vals, w)

w_wt_m = metrics(adapt_w_wt, ref_w_val)
w_wt_high_rmse = float(np.sqrt(np.mean((adapt_w_wt[high_mask_w] - ref_w_val[high_mask_w])**2)))
print(f"Candidate W3 (High-Wind Sample Weighted): Overall RMSE={w_wt_m['rmse']:.4f}, Bias={w_wt_m['bias']:.4f}, High-Wind RMSE={w_wt_high_rmse:.4f}")
