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

def run_experiment():
    print("Collecting/loading all rows for 4 variables...")
    df_all = collect_all_rows(BENCHMARK_REGION_IDS, BENCHMARK_WINDOWS, ['temperature', 'rainfall', 'wind_speed', 'pressure'], LEAD_TIMES)
    print(f"Total dataset shape: {df_all.shape}")

    results = {}
    for var in ['temperature', 'rainfall', 'wind_speed', 'pressure']:
        print(f"\nProcessing {var}...")
        df = df_all[df_all['variable'] == var].reset_index(drop=True)
        train_df, val_df, test_df = split_partitions(df)
        print(f"  Rows - train: {len(train_df)}, val: {len(val_df)}, test: {len(test_df)}")

        # Train XGBoost error models on train_df
        bundle = train_meta_model(train_df, variable=var, validation_df=val_df)

        # Static weights strictly from train_df
        train_rmses = {m: float(np.sqrt(train_df[f'{m}_sq_err'].mean())) for m in MODEL_KEYS}
        static_weights = static_inverse_rmse_weights(train_rmses)

        # Predict errors on test_df
        predicted = predict_errors(bundle, test_df)

        ref = test_df['reference_val'].to_numpy(dtype=float)
        cols = {m: test_df[f'{m}_val'].to_numpy(dtype=float) for m in MODEL_KEYS}

        single_metrics = {}
        for m in MODEL_KEYS:
            single_metrics[m] = metrics(cols[m], ref)

        equal_blend = np.mean(np.vstack([cols[m] for m in MODEL_KEYS]), axis=0)
        equal_m = metrics(equal_blend, ref)

        static_blend = np.sum(np.vstack([static_weights[m] / 100.0 * cols[m] for m in MODEL_KEYS]), axis=0)
        static_m = metrics(static_blend, ref)

        adaptive = np.empty(len(test_df), dtype=float)
        for pos, idx in enumerate(test_df.index):
            errs = {m: float(predicted[m].loc[idx]) for m in MODEL_KEYS}
            w = weights_from_predicted_errors(errs)
            vals = {m: float(cols[m][pos]) for m in MODEL_KEYS}
            adaptive[pos] = blend_value(vals, w)
        adaptive_m = metrics(adaptive, ref)

        best_single = min(MODEL_KEYS, key=lambda m: single_metrics[m]['rmse'])
        best_single_rmse = single_metrics[best_single]['rmse']
        impr_vs_best_single = ((best_single_rmse - adaptive_m['rmse']) / best_single_rmse) * 100.0
        impr_vs_equal = ((equal_m['rmse'] - adaptive_m['rmse']) / equal_m['rmse']) * 100.0
        impr_vs_static = ((static_m['rmse'] - adaptive_m['rmse']) / static_m['rmse']) * 100.0

        results[var] = {
            'best_single': best_single,
            'best_single_rmse': best_single_rmse,
            'single_metrics': single_metrics,
            'equal_m': equal_m,
            'static_m': static_m,
            'adaptive_m': adaptive_m,
            'impr_vs_best_single_pct': impr_vs_best_single,
            'impr_vs_equal_pct': impr_vs_equal,
            'impr_vs_static_pct': impr_vs_static,
            'train_rmses': train_rmses,
            'static_weights': static_weights,
        }

    print("\n" + "="*80)
    print("EXPERIMENTAL EVALUATION SUMMARY (HELD-OUT TEST SET)")
    print("="*80)
    for var, res in results.items():
        print(f"\n--- {var.upper()} ---")
        print(f"Best single NWP model: {res['best_single']} (RMSE: {res['best_single_rmse']:.4f})")
        for m in MODEL_KEYS:
            sm = res['single_metrics'][m]
            print(f"  {m:12s} | RMSE: {sm['rmse']:.4f} | MAE: {sm['mae']:.4f} | Bias: {sm['bias']:+.4f} | r: {sm['pearson_r']:.4f}")
        print(f"Equal blend:          | RMSE: {res['equal_m']['rmse']:.4f} | MAE: {res['equal_m']['mae']:.4f} | Bias: {res['equal_m']['bias']:+.4f} | r: {res['equal_m']['pearson_r']:.4f}")
        print(f"Static inv-RMSE:      | RMSE: {res['static_m']['rmse']:.4f} | MAE: {res['static_m']['mae']:.4f} | Bias: {res['static_m']['bias']:+.4f} | r: {res['static_m']['pearson_r']:.4f}")
        print(f"VARUNA Adaptive:      | RMSE: {res['adaptive_m']['rmse']:.4f} | MAE: {res['adaptive_m']['mae']:.4f} | Bias: {res['adaptive_m']['bias']:+.4f} | r: {res['adaptive_m']['pearson_r']:.4f}")
        print(f"Improvement vs best single NWP: {res['impr_vs_best_single_pct']:+.2f}%")
        print(f"Improvement vs Equal Blend:     {res['impr_vs_equal_pct']:+.2f}%")
        print(f"Improvement vs Static inv-RMSE: {res['impr_vs_static_pct']:+.2f}%")
        
        # Validation decision rule: RMSE < best single NWP AND >= 1% improvement
        gate_passed = (res['impr_vs_best_single_pct'] >= 1.0) and (res['adaptive_m']['mae'] <= res['single_metrics'][res['best_single']]['mae'])
        print(f"Validation gate passed: {gate_passed}")

if __name__ == '__main__':
    run_experiment()
