# Limitations — read before quoting any number

This file exists so that no result in this system is overstated. Every item
below is a *structural* limitation of the current build, not a tuning issue.

## 1. The held-out test is one season only

Chronological split by unique timestamp, no shuffle:

| partition | timestamps | rows | range |
|-----------|-----------|------|-------|
| train 65% | 608 | 13,170 | 2026-01-10 → 2026-07-10 |
| validation 15% | 140 | 3,360 | 2026-07-10 → 2026-09-01 |
| test 20% | 188 | 4,512 | 2026-09-01 → 2026-09-08 |

Because the data is chronological, the test partition falls **entirely inside
the Post-Monsoon window (Sep 1–8, 2026)**. The headline table
(`reports/blend_test_results.csv`, `scope: held_out_test`) therefore describes
**one season, one lead-mix, one synoptic situation**. It must not be quoted as
"verified across all seasons". The full-dataset tables carry
`scope: full_dataset_all_splits` precisely because they include the training
rows and are *not* held-out evidence.

## 2. Multi-variable validation status: temperature & pressure validated; wind & rainfall on consensus

Following rigorous held-out test evaluation ($N = 4,512$ chronological post-monsoon records):
- **Temperature (`temperature`):** Validated and promoted to Adaptive XGBoost (held-out RMSE 0.780 °C, +29.4% improvement over best single NWP center, +18.7% over equal blend).
- **Surface Pressure (`pressure`):** Validated and promoted to Adaptive XGBoost (held-out RMSE 0.674 hPa, +9.9% improvement over best single NWP center DWD ICON, +19.5% over equal blend, Pearson $r = 1.000$).
- **Wind Speed (`wind_speed`):** Held-out gate **NOT passed**; served live with `validated: false` and `weighting_scheme: equal_fallback_untrained` (25% each). The adaptive model underperforms equal-weight consensus (-4.06% worse RMSE across all leads: 2.224 km/h vs 2.137 km/h) and degrades significantly on the top 10% high-wind decile (RMSE 3.09 vs 2.49 km/h).
- **Precipitation (`rainfall`):** Held-out gate **NOT passed**; served live with `validated: false` and `weighting_scheme: equal_fallback_untrained` (25% each). Heavy zero-inflation (57.5% dry hours) causes the adaptive model to suppress wet-event detection: hit rate (POD) drops from 89.2% to 75.2% (missing 475 wet events vs 206 for equal blend), and at +24h lead adaptive RMSE is 0.257 vs 0.237 for equal blend (-8.3% worse).

Any UI element or endpoint that claims adaptive weighting for wind or rain would violate scientific integrity; VARUNA strictly serves equal consensus for them.

## 3. Verification is against ERA5, not observations

See `DATA_PROVENANCE.md`. All RMSE/MAE/bias/r values are *model vs ERA5
reanalysis at a grid point*. They do not capture station-scale truth, and
systematic ERA5 biases propagate into both the targets and the reported skill.

## 4. Sample size and independence

4,512 held-out rows are ~188 hourly timestamps × 6 regions × 4 leads. Rows
sharing a timestamp are **not** independent (same synoptic situation), so the
effective sample size is closer to 188 situations. Confidence intervals are
deliberately not printed rather than printed with false precision.

## 5. GFS is a persistent weak member

On every reported table `ncep_gfs` (`gfs_seamless`) is the worst member
(held-out RMSE 2.32 °C vs 1.10–1.20 °C for the others) with a large positive
bias (+0.67 °C). The 1/E² weighting correctly down-weights it — across the
154 region×season×lead×regime groups in `reports/adaptive_weights.csv` its
weight has median 10%, range 1–32% (mean 11.7%) — but it also means the
ensemble's spread, and therefore the `ensemble_spread` feature, is dominated by
one outlier model.

## 6. Replay mode is not a forecast

`data_mode: "REPLAY"` serves an archived post-monsoon cycle at a fixed lead.
It exists so the UI stays truthful when the provider is offline. It is clearly
labelled, its `horizon_note` names the archived window, and it is rejected for
non-temperature variables (503 with an explanation) rather than silently
served.

## 7. Regime classifier is hand-written, not learned

6 deterministic rules (`docs/REGIME_RULES.md`). They are total and
reproducible, but they were written from synoptic meteorology intuition, not
fitted. A misclassified hour shifts the `regime_index` feature and hence the
predicted errors.

## 8. Extreme alerts are threshold crossings, not impact forecasts

`/api/extremes` compares the *blended* value against IMD thresholds
(64.5 / 115.6 mm/24 h, 45.0 °C, 55 / 62 km/h). Rainfall and wind checks run on
unvalidated blends (`validated: false` in the payload). A "no_alerts" response
means *the blended forecast did not cross a threshold* — not "no extreme
weather will occur".

## 9. Regional coverage

6 of 12 regions have no benchmark window and therefore no skill table at all
(`validated: false` in `/api/regions`). Weights there come from a model
trained on other regions' coordinates.

## 10. No persistence of forecast cycles

Live forecasts are cached for 30 minutes. There is no long-running archive of
issued forecasts, so verification cannot be extended to *today's* cycle — only
to the 2026 benchmark windows already collected.
