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

def run_breakdowns():
    df_all = collect_all_rows(BENCHMARK_REGION_IDS, BENCHMARK_WINDOWS, ['temperature', 'rainfall', 'wind_speed', 'pressure'], LEAD_TIMES)
    
    for var in ['temperature', 'rainfall', 'wind_speed', 'pressure']:
        print(f"\n==================== BREAKDOWN FOR {var.upper()} ====================")
        df = df_all[df_all['variable'] == var].reset_index(drop=True)
        train_df, val_df, test_df = split_partitions(df)
        bundle = train_meta_model(train_df, variable=var, validation_df=val_df)
        
        train_rmses = {m: float(np.sqrt(train_df[f'{m}_sq_err'].mean())) for m in MODEL_KEYS}
        static_weights = static_inverse_rmse_weights(train_rmses)
        
        # We evaluate on full df (scoped as full_dataset_all_splits) and test_df (held_out_test)
        predicted_test = predict_errors(bundle, test_df)
        
        # Test by lead
        print("--- Held-out Test Skill by Lead Time ---")
        for lead in LEAD_TIMES:
            sub = test_df[test_df['lead_time_hours'] == lead]
            if len(sub) == 0:
                continue
            ref = sub['reference_val'].to_numpy(dtype=float)
            cols = {m: sub[f'{m}_val'].to_numpy(dtype=float) for m in MODEL_KEYS}
            single_rmses = {m: np.sqrt(np.mean((cols[m] - ref)**2)) for m in MODEL_KEYS}
            best_m = min(MODEL_KEYS, key=lambda m: single_rmses[m])
            eq_m = np.sqrt(np.mean((np.mean(np.vstack([cols[m] for m in MODEL_KEYS]), axis=0) - ref)**2))
            
            adapt_sub = np.empty(len(sub), dtype=float)
            for pos, idx in enumerate(sub.index):
                errs = {m: float(predicted_test[m].loc[idx]) for m in MODEL_KEYS}
                w = weights_from_predicted_errors(errs)
                vals = {m: float(cols[m][pos]) for m in MODEL_KEYS}
                adapt_sub[pos] = blend_value(vals, w)
            adapt_rmse = np.sqrt(np.mean((adapt_sub - ref)**2))
            
            impr_single = ((single_rmses[best_m] - adapt_rmse) / single_rmses[best_m]) * 100.0
            impr_eq = ((eq_m - adapt_rmse) / eq_m) * 100.0
            print(f"  +{lead:3d}h (N={len(sub):4d}) | Best single ({best_m}): {single_rmses[best_m]:.4f} | Equal: {eq_m:.4f} | Adaptive: {adapt_rmse:.4f} | vs Best: {impr_single:+.1f}% | vs Eq: {impr_eq:+.1f}%")

        # Test by region
        print("--- Held-out Test Skill by Region ---")
        for reg in BENCHMARK_REGION_IDS:
            sub = test_df[test_df['region_id'] == reg]
            if len(sub) == 0:
                continue
            ref = sub['reference_val'].to_numpy(dtype=float)
            cols = {m: sub[f'{m}_val'].to_numpy(dtype=float) for m in MODEL_KEYS}
            single_rmses = {m: np.sqrt(np.mean((cols[m] - ref)**2)) for m in MODEL_KEYS}
            best_m = min(MODEL_KEYS, key=lambda m: single_rmses[m])
            eq_m = np.sqrt(np.mean((np.mean(np.vstack([cols[m] for m in MODEL_KEYS]), axis=0) - ref)**2))
            
            adapt_sub = np.empty(len(sub), dtype=float)
            for pos, idx in enumerate(sub.index):
                errs = {m: float(predicted_test[m].loc[idx]) for m in MODEL_KEYS}
                w = weights_from_predicted_errors(errs)
                vals = {m: float(cols[m][pos]) for m in MODEL_KEYS}
                adapt_sub[pos] = blend_value(vals, w)
            adapt_rmse = np.sqrt(np.mean((adapt_sub - ref)**2))
            
            impr_single = ((single_rmses[best_m] - adapt_rmse) / single_rmses[best_m]) * 100.0
            impr_eq = ((eq_m - adapt_rmse) / eq_m) * 100.0
            print(f"  {reg:18s} (N={len(sub):4d}) | Best single ({best_m}): {single_rmses[best_m]:.4f} | Equal: {eq_m:.4f} | Adaptive: {adapt_rmse:.4f} | vs Best: {impr_single:+.1f}% | vs Eq: {impr_eq:+.1f}%")

if __name__ == '__main__':
    run_breakdowns()
