# VARUNA Baseline Case Studies (Held-Out Test Set)

Representative real meteorological case studies evaluating forecast bust detection performance and failure modes.

## Case: CASE_SUCCESSFUL_BUST_DETECTION_1255364
**Type:** True Positive: Model correctly detected high-risk bust.

- **Location:** Gujarat (`1255364`) at (21.20°N, 72.83°E)
- **Lead Time:** Day 6 (132 hours)
- **Valid UTC:** `2026-08-09 12:00:00+00:00`
- **VARUNA Bust Probability:** **100.0%** (Confidence: 0.0/100, VERY_LOW_CONFIDENCE_HIGH_RISK)
- **Realized Outcome:** BUST DETECTED

### Risk Drivers & Meteorological Rationale
- Elevated multi-model forecast spread across NWP centers.
- High structural disagreement in rain footprint among forecast centers.

### Historical Analogue Evidence
- 9 of 10 similar historical forecasts (90%) experienced a forecast bust under comparable synoptic and multi-model spread conditions.

---

## Case: CASE_SUCCESSFUL_NORMAL_FORECAST_1257629
**Type:** True Negative: Model correctly identified reliable forecast.

- **Location:** Tamil Nadu (`1257629`) at (11.65°N, 78.16°E)
- **Lead Time:** Day 1 (3 hours)
- **Valid UTC:** `2026-07-02 03:00:00+00:00`
- **VARUNA Bust Probability:** **7.1%** (Confidence: 92.9/100, HIGH_CONFIDENCE)
- **Realized Outcome:** NORMAL (NO BUST)

### Risk Drivers & Meteorological Rationale
- Elevated multi-model forecast spread across NWP centers.
- Rapid temporal shifts or run-to-run forecast adjustments.
- Feature `month` is associated with higher risk of forecast bust.

### Historical Analogue Evidence
- 0 of 10 similar historical forecasts (0%) experienced a forecast bust under comparable synoptic and multi-model spread conditions.

---

## Case: CASE_FALSE_ALARM_CASE_1255364
**Type:** False Positive: Model warned of bust, but forecast remained stable.

- **Location:** Gujarat (`1255364`) at (21.20°N, 72.83°E)
- **Lead Time:** Day 2 (46 hours)
- **Valid UTC:** `2026-07-02 22:00:00+00:00`
- **VARUNA Bust Probability:** **96.5%** (Confidence: 3.5/100, VERY_LOW_CONFIDENCE_HIGH_RISK)
- **Realized Outcome:** NORMAL (NO BUST)

### Risk Drivers & Meteorological Rationale
- Elevated multi-model forecast spread across NWP centers.
- High structural disagreement in rain footprint among forecast centers.

### Historical Analogue Evidence
- 10 of 10 similar historical forecasts (100%) experienced a forecast bust under comparable synoptic and multi-model spread conditions.

---
