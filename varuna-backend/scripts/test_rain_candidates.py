"""
Evaluate Rainfall candidates on the Held-Out Test Partition (Sep 1-8, 2026, Post-Monsoon)
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

print("="*80)
print("RAINFALL EVALUATION ON HELD-OUT TEST")
print("="*80)
df_rain = df_all[df_all["variable"] == "rainfall"].reset_index(drop=True)
train_r, val_r, test_r = split_partitions(df_rain)
ref_test = test_r["reference_val"].to_numpy(dtype=float)
cols_test = {m: test_r[f"{m}_val"].to_numpy(dtype=float) for m in MODEL_KEYS}
equal_test = np.mean(np.vstack([cols_test[m] for m in MODEL_KEYS]), axis=0)

thresh = 0.1
ref_ev = ref_test >= thresh
eq_ev = equal_test >= thresh
h_eq = int(np.sum(eq_ev & ref_ev))
mi_eq = int(np.sum((~eq_ev) & ref_ev))
fa_eq = int(np.sum(eq_ev & (~ref_ev)))
pod_eq = h_eq / (h_eq + mi_eq)
csi_eq = h_eq / (h_eq + mi_eq + fa_eq)
eq_m = metrics(equal_test, ref_test)
print(f"Equal Blend (Test): RMSE={eq_m['rmse']:.4f}, MAE={eq_m['mae']:.4f}, Bias={eq_m['bias']:.4f}, POD={pod_eq*100:.1f}%, Misses={mi_eq}, CSI={csi_eq:.3f}")

# Candidate A: Direct Abs Err
models_a = {}
for m in MODEL_KEYS:
    X_tr = build_feature_frame(train_r, model_key=m)
    y_tr = train_r[f"{m}_abs_err"].astype(float)
    xgb = XGBRegressor(n_estimators=100, max_depth=5, learning_rate=0.08, subsample=0.8, colsample_bytree=0.8, random_state=42)
    xgb.fit(X_tr, y_tr)
    models_a[m] = xgb

pred_a = {}
for m in MODEL_KEYS:
    X_te = build_feature_frame(test_r, model_key=m)
    pred_a[m] = pd.Series(np.maximum(models_a[m].predict(X_te), WEIGHT_EPSILON), index=test_r.index)

adapt_a = np.empty(len(test_r), dtype=float)
for pos, idx in enumerate(test_r.index):
    errs = {m: float(pred_a[m].loc[idx]) for m in MODEL_KEYS}
    w = weights_from_predicted_errors(errs)
    vals = {m: float(cols_test[m][pos]) for m in MODEL_KEYS}
    adapt_a[pos] = blend_value(vals, w)

m_a = metrics(adapt_a, ref_test)
ev_a = adapt_a >= thresh
h_a = int(np.sum(ev_a & ref_ev))
mi_a = int(np.sum((~ev_a) & ref_ev))
fa_a = int(np.sum(ev_a & (~ref_ev)))
pod_a = h_a / (h_a + mi_a)
csi_a = h_a / (h_a + mi_a + fa_a)
print(f"Candidate A (Direct Abs): RMSE={m_a['rmse']:.4f}, MAE={m_a['mae']:.4f}, Bias={m_a['bias']:.4f}, POD={pod_a*100:.1f}%, Misses={mi_a}, CSI={csi_a:.3f}")

# Candidate D: Wet Stratified
wet_train = train_r[(train_r["ensemble_mean"] >= 0.1) | (train_r["reference_val"] >= 0.1)]
models_d = {}
for m in MODEL_KEYS:
    X_tr = build_feature_frame(wet_train, model_key=m)
    y_tr = wet_train[f"{m}_abs_err"].astype(float)
    xgb = XGBRegressor(n_estimators=100, max_depth=5, learning_rate=0.08, subsample=0.8, colsample_bytree=0.8, random_state=42)
    xgb.fit(X_tr, y_tr)
    models_d[m] = xgb

pred_d = {}
for m in MODEL_KEYS:
    X_te = build_feature_frame(test_r, model_key=m)
    pred_d[m] = pd.Series(np.maximum(models_d[m].predict(X_te), WEIGHT_EPSILON), index=test_r.index)

adapt_d = np.empty(len(test_r), dtype=float)
for pos, idx in enumerate(test_r.index):
    ens_mean = float(test_r["ensemble_mean"].iloc[pos])
    if ens_mean < 0.1:
        w = {m: 25 for m in MODEL_KEYS}
    else:
        errs = {m: float(pred_d[m].loc[idx]) for m in MODEL_KEYS}
        w = weights_from_predicted_errors(errs)
    vals = {m: float(cols_test[m][pos]) for m in MODEL_KEYS}
    adapt_d[pos] = blend_value(vals, w)

m_d = metrics(adapt_d, ref_test)
ev_d = adapt_d >= thresh
h_d = int(np.sum(ev_d & ref_ev))
mi_d = int(np.sum((~ev_d) & ref_ev))
fa_d = int(np.sum(ev_d & (~ref_ev)))
pod_d = h_d / (h_d + mi_d)
csi_d = h_d / (h_d + mi_d + fa_d)
print(f"Candidate D (Wet Strat): RMSE={m_d['rmse']:.4f}, MAE={m_d['mae']:.4f}, Bias={m_d['bias']:.4f}, POD={pod_d*100:.1f}%, Misses={mi_d}, CSI={csi_d:.3f}")
