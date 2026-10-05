import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np
import pandas as pd
from app.science.alignment import collect_all_rows, split_partitions
from app.science.meta_model import train_meta_model, predict_errors
from app.science.verification import metrics
from app.science.weighting import weights_from_predicted_errors, blend_value, static_inverse_rmse_weights
from app.config import BENCHMARK_REGION_IDS, BENCHMARK_WINDOWS, LEAD_TIMES, MODEL_KEYS

def run_diagnostics():
    df_all = collect_all_rows(BENCHMARK_REGION_IDS, BENCHMARK_WINDOWS, ['temperature', 'rainfall', 'wind_speed', 'pressure'], LEAD_TIMES)
    
    # ----------------- RAINFALL DIAGNOSTIC -----------------
    print("="*70)
    print("PHASE 6: RAINFALL-SPECIFIC ZERO-INFLATION & DETECTION DIAGNOSTIC")
    print("="*70)
    df_rain = df_all[df_all['variable'] == 'rainfall'].reset_index(drop=True)
    train_r, val_r, test_r = split_partitions(df_rain)
    bundle_r = train_meta_model(train_r, variable='rainfall', validation_df=val_r)
    pred_r = predict_errors(bundle_r, test_r)
    
    ref_r = test_r['reference_val'].to_numpy(dtype=float)
    cols_r = {m: test_r[f'{m}_val'].to_numpy(dtype=float) for m in MODEL_KEYS}
    equal_r = np.mean(np.vstack([cols_r[m] for m in MODEL_KEYS]), axis=0)
    
    adapt_r = np.empty(len(test_r), dtype=float)
    for pos, idx in enumerate(test_r.index):
        errs = {m: float(pred_r[m].loc[idx]) for m in MODEL_KEYS}
        w = weights_from_predicted_errors(errs)
        vals = {m: float(cols_r[m][pos]) for m in MODEL_KEYS}
        adapt_r[pos] = blend_value(vals, w)
        
    n_total = len(ref_r)
    n_dry = np.sum(ref_r == 0.0)
    n_wet = np.sum(ref_r > 0.0)
    print(f"Total test rows: {n_total}")
    print(f"Dry hours (ref == 0.0 mm): {n_dry} ({n_dry/n_total*100:.2f}%)")
    print(f"Wet hours (ref >  0.0 mm): {n_wet} ({n_wet/n_total*100:.2f}%)")
    
    for thresh in [0.1, 1.0]:
        print(f"\n--- Wet Event Contingency Diagnostics (Threshold >= {thresh} mm/h) ---")
        ref_event = ref_r >= thresh
        print(f"Observed event count (ref >= {thresh} mm): {np.sum(ref_event)} ({np.sum(ref_event)/n_total*100:.2f}%)")
        
        candidates = {**cols_r, "equal_blend": equal_r, "varuna_adaptive": adapt_r}
        for name, series in candidates.items():
            pred_event = series >= thresh
            hits = np.sum(pred_event & ref_event)
            misses = np.sum((~pred_event) & ref_event)
            false_alarms = np.sum(pred_event & (~ref_event))
            corr_neg = np.sum((~pred_event) & (~ref_event))
            
            pod = hits / (hits + misses) if (hits + misses) > 0 else 0.0  # Hit rate / detection rate
            far = false_alarms / (hits + false_alarms) if (hits + false_alarms) > 0 else 0.0  # False alarm ratio
            csi = hits / (hits + misses + false_alarms) if (hits + misses + false_alarms) > 0 else 0.0  # Critical success index
            bias_freq = (hits + false_alarms) / (hits + misses) if (hits + misses) > 0 else 0.0
            
            print(f"  {name:16s} | Hits: {hits:3d} | Misses: {misses:3d} | FA: {false_alarms:3d} | POD (Hit Rate): {pod:.3f} | FAR: {far:.3f} | CSI: {csi:.3f} | Frequency Bias: {bias_freq:.3f}")

    # Dry-case RMSE (when ref == 0) and Wet-case RMSE (when ref > 0)
    dry_mask = ref_r == 0.0
    wet_mask = ref_r > 0.0
    print("\n--- Dry vs Wet Partition Verification ---")
    for name, series in candidates.items():
        rmse_dry = np.sqrt(np.mean((series[dry_mask] - ref_r[dry_mask])**2))
        mae_dry = np.mean(np.abs(series[dry_mask] - ref_r[dry_mask]))
        rmse_wet = np.sqrt(np.mean((series[wet_mask] - ref_r[wet_mask])**2)) if np.sum(wet_mask) > 0 else 0.0
        mae_wet = np.mean(np.abs(series[wet_mask] - ref_r[wet_mask])) if np.sum(wet_mask) > 0 else 0.0
        print(f"  {name:16s} | Dry RMSE: {rmse_dry:.4f} | Dry MAE: {mae_dry:.4f} | Wet RMSE: {rmse_wet:.4f} | Wet MAE: {mae_wet:.4f}")

    # ----------------- WIND DIAGNOSTIC -----------------
    print("\n" + "="*70)
    print("PHASE 7: WIND SPEED DIAGNOSTIC & HIGH-WIND BEHAVIOR")
    print("="*70)
    df_wind = df_all[df_all['variable'] == 'wind_speed'].reset_index(drop=True)
    train_w, val_w, test_w = split_partitions(df_wind)
    bundle_w = train_meta_model(train_w, variable='wind_speed', validation_df=val_w)
    pred_w = predict_errors(bundle_w, test_w)
    
    ref_w = test_w['reference_val'].to_numpy(dtype=float)
    cols_w = {m: test_w[f'{m}_val'].to_numpy(dtype=float) for m in MODEL_KEYS}
    equal_w = np.mean(np.vstack([cols_w[m] for m in MODEL_KEYS]), axis=0)
    
    adapt_w = np.empty(len(test_w), dtype=float)
    for pos, idx in enumerate(test_w.index):
        errs = {m: float(pred_w[m].loc[idx]) for m in MODEL_KEYS}
        w = weights_from_predicted_errors(errs)
        vals = {m: float(cols_w[m][pos]) for m in MODEL_KEYS}
        adapt_w[pos] = blend_value(vals, w)

    candidates_w = {**cols_w, "equal_blend": equal_w, "varuna_adaptive": adapt_w}
    
    p75 = np.percentile(ref_w, 75)
    p90 = np.percentile(ref_w, 90)
    print(f"Reference wind 75th percentile: {p75:.1f} km/h, 90th percentile: {p90:.1f} km/h, Max: {np.max(ref_w):.1f} km/h")
    
    for label, mask in [("All Winds", np.ones(len(ref_w), dtype=bool)),
                        (f"Moderate-to-High (>= {p75:.1f} km/h, upper 25%)", ref_w >= p75),
                        (f"High Winds (>= {p90:.1f} km/h, upper 10%)", ref_w >= p90)]:
        print(f"\n--- {label} (N = {np.sum(mask)}) ---")
        for name, series in candidates_w.items():
            sub_s = series[mask]
            sub_r = ref_w[mask]
            rmse = np.sqrt(np.mean((sub_s - sub_r)**2))
            mae = np.mean(np.abs(sub_s - sub_r))
            bias = np.mean(sub_s - sub_r)
            print(f"  {name:16s} | RMSE: {rmse:.4f} | MAE: {mae:.4f} | Bias: {bias:+.4f}")

    # ----------------- PRESSURE DIAGNOSTIC -----------------
    print("\n" + "="*70)
    print("PHASE 8: SURFACE PRESSURE DIAGNOSTIC")
    print("="*70)
    df_press = df_all[df_all['variable'] == 'pressure'].reset_index(drop=True)
    train_p, val_p, test_p = split_partitions(df_press)
    bundle_p = train_meta_model(train_p, variable='pressure', validation_df=val_p)
    pred_p = predict_errors(bundle_p, test_p)
    
    ref_p = test_p['reference_val'].to_numpy(dtype=float)
    cols_p = {m: test_p[f'{m}_val'].to_numpy(dtype=float) for m in MODEL_KEYS}
    equal_p = np.mean(np.vstack([cols_p[m] for m in MODEL_KEYS]), axis=0)
    
    adapt_p = np.empty(len(test_p), dtype=float)
    weights_p = []
    for pos, idx in enumerate(test_p.index):
        errs = {m: float(pred_p[m].loc[idx]) for m in MODEL_KEYS}
        w = weights_from_predicted_errors(errs)
        weights_p.append(w)
        vals = {m: float(cols_p[m][pos]) for m in MODEL_KEYS}
        adapt_p[pos] = blend_value(vals, w)
    
    # Check weight distribution across members to verify no collapse toward single member
    avg_weights = {m: np.mean([w[m] for w in weights_p]) for m in MODEL_KEYS}
    print("Average weight allocation across test partition for pressure:")
    for m, avg_w in avg_weights.items():
        print(f"  {m:12s}: {avg_w:.1f}%")

if __name__ == '__main__':
    run_diagnostics()
