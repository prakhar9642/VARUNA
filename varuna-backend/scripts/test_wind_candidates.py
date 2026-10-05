"""
Evaluate Wind and Rain candidates on the Held-Out Test Partition (Sep 1-8, 2026, Post-Monsoon)
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np
import pandas as pd
from xgboost import XGBRegressor
from app.config import MODEL_KEYS, WEIGHT_EPSILON
from app.science.alignment import split_partitions
from app.science.meta_model import build_feature_frame
from app.science.verification import metrics
from app.science.weighting import weights_from_predicted_errors, blend_value

df_all = pd.read_csv(Path(__file__).resolve().parents[1] / "data" / "aligned_multi_season_lead_data.csv")

# ----------------- WIND SPEED ON HELD-OUT TEST -----------------
print("="*80)
print("WIND SPEED EVALUATION ON HELD-OUT TEST")
print("="*80)
df_wind = df_all[df_all["variable"] == "wind_speed"].reset_index(drop=True)
train_w, val_w, test_w = split_partitions(df_wind)
ref_test = test_w["reference_val"].to_numpy(dtype=float)
cols_test = {m: test_w[f"{m}_val"].to_numpy(dtype=float) for m in MODEL_KEYS}
equal_test = np.mean(np.vstack([cols_test[m] for m in MODEL_KEYS]), axis=0)

eq_m = metrics(equal_test, ref_test)
p90 = float(np.percentile(ref_test, 90))
high_mask = ref_test >= p90
eq_high_rmse = float(np.sqrt(np.mean((equal_test[high_mask] - ref_test[high_mask])**2)))
eq_high_mae = float(np.mean(np.abs(equal_test[high_mask] - ref_test[high_mask])))
print(f"Equal Blend (Test): Overall RMSE={eq_m['rmse']:.4f}, MAE={eq_m['mae']:.4f}, Bias={eq_m['bias']:.4f}, r={eq_m['pearson_r']:.4f}, High-Wind RMSE={eq_high_rmse:.4f}, High-Wind MAE={eq_high_mae:.4f}")

for m in MODEL_KEYS:
    m_m = metrics(cols_test[m], ref_test)
    h_rmse = float(np.sqrt(np.mean((cols_test[m][high_mask] - ref_test[high_mask])**2)))
    print(f"  Single NWP {m:12s}: Overall RMSE={m_m['rmse']:.4f}, Bias={m_m['bias']:.4f}, High-Wind RMSE={h_rmse:.4f}")

# Train Candidate W1 (Standard Abs Err)
models_w1 = {}
for m in MODEL_KEYS:
    X_tr = build_feature_frame(train_w, model_key=m)
    y_tr = train_w[f"{m}_abs_err"].astype(float)
    xgb = XGBRegressor(n_estimators=100, max_depth=5, learning_rate=0.08, subsample=0.8, colsample_bytree=0.8, random_state=42)
    xgb.fit(X_tr, y_tr)
    models_w1[m] = xgb

pred_w1 = {}
for m in MODEL_KEYS:
    X_te = build_feature_frame(test_w, model_key=m)
    pred_w1[m] = pd.Series(np.maximum(models_w1[m].predict(X_te), WEIGHT_EPSILON), index=test_w.index)

adapt_w1 = np.empty(len(test_w), dtype=float)
for pos, idx in enumerate(test_w.index):
    errs = {m: float(pred_w1[m].loc[idx]) for m in MODEL_KEYS}
    w = weights_from_predicted_errors(errs)
    vals = {m: float(cols_test[m][pos]) for m in MODEL_KEYS}
    adapt_w1[pos] = blend_value(vals, w)

w1_m = metrics(adapt_w1, ref_test)
w1_high_rmse = float(np.sqrt(np.mean((adapt_w1[high_mask] - ref_test[high_mask])**2)))
w1_high_mae = float(np.mean(np.abs(adapt_w1[high_mask] - ref_test[high_mask])))
print(f"Candidate W1 (Standard): Overall RMSE={w1_m['rmse']:.4f}, MAE={w1_m['mae']:.4f}, Bias={w1_m['bias']:.4f}, r={w1_m['pearson_r']:.4f}, High-Wind RMSE={w1_high_rmse:.4f}, High-Wind MAE={w1_high_mae:.4f}")

# Train Candidate W3 (High-Wind Sample Weighted)
sample_weights_w = np.where(train_w["reference_val"] >= np.percentile(train_w["reference_val"], 75), 2.5, 1.0)
models_w3 = {}
for m in MODEL_KEYS:
    X_tr = build_feature_frame(train_w, model_key=m)
    y_tr = train_w[f"{m}_abs_err"].astype(float)
    xgb = XGBRegressor(n_estimators=100, max_depth=5, learning_rate=0.08, subsample=0.8, colsample_bytree=0.8, random_state=42)
    xgb.fit(X_tr, y_tr, sample_weight=sample_weights_w)
    models_w3[m] = xgb

pred_w3 = {}
for m in MODEL_KEYS:
    X_te = build_feature_frame(test_w, model_key=m)
    pred_w3[m] = pd.Series(np.maximum(models_w3[m].predict(X_te), WEIGHT_EPSILON), index=test_w.index)

adapt_w3 = np.empty(len(test_w), dtype=float)
for pos, idx in enumerate(test_w.index):
    errs = {m: float(pred_w3[m].loc[idx]) for m in MODEL_KEYS}
    w = weights_from_predicted_errors(errs)
    vals = {m: float(cols_test[m][pos]) for m in MODEL_KEYS}
    adapt_w3[pos] = blend_value(vals, w)

w3_m = metrics(adapt_w3, ref_test)
w3_high_rmse = float(np.sqrt(np.mean((adapt_w3[high_mask] - ref_test[high_mask])**2)))
w3_high_mae = float(np.mean(np.abs(adapt_w3[high_mask] - ref_test[high_mask])))
print(f"Candidate W3 (Weighted): Overall RMSE={w3_m['rmse']:.4f}, MAE={w3_m['mae']:.4f}, Bias={w3_m['bias']:.4f}, r={w3_m['pearson_r']:.4f}, High-Wind RMSE={w3_high_rmse:.4f}, High-Wind MAE={w3_high_mae:.4f}")

# Candidate W4: Quantile-oriented / Robust Huber Regressor with lead-conditioned weights
models_w4 = {}
for m in MODEL_KEYS:
    X_tr = build_feature_frame(train_w, model_key=m)
    y_tr = train_w[f"{m}_abs_err"].astype(float)
    xgb = XGBRegressor(n_estimators=120, max_depth=4, learning_rate=0.05, objective="reg:pseudohubererror", subsample=0.85, colsample_bytree=0.85, random_state=42)
    xgb.fit(X_tr, y_tr)
    models_w4[m] = xgb

pred_w4 = {}
for m in MODEL_KEYS:
    X_te = build_feature_frame(test_w, model_key=m)
    pred_w4[m] = pd.Series(np.maximum(models_w4[m].predict(X_te), WEIGHT_EPSILON), index=test_w.index)

adapt_w4 = np.empty(len(test_w), dtype=float)
for pos, idx in enumerate(test_w.index):
    errs = {m: float(pred_w4[m].loc[idx]) for m in MODEL_KEYS}
    w = weights_from_predicted_errors(errs)
    vals = {m: float(cols_test[m][pos]) for m in MODEL_KEYS}
    adapt_w4[pos] = blend_value(vals, w)

w4_m = metrics(adapt_w4, ref_test)
w4_high_rmse = float(np.sqrt(np.mean((adapt_w4[high_mask] - ref_test[high_mask])**2)))
w4_high_mae = float(np.mean(np.abs(adapt_w4[high_mask] - ref_test[high_mask])))
print(f"Candidate W4 (Huber):    Overall RMSE={w4_m['rmse']:.4f}, MAE={w4_m['mae']:.4f}, Bias={w4_m['bias']:.4f}, r={w4_m['pearson_r']:.4f}, High-Wind RMSE={w4_high_rmse:.4f}, High-Wind MAE={w4_high_mae:.4f}")
