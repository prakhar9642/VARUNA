"""Human-Readable Reason Engine.

Maps quantitative model inputs and SHAP feature attributions into calibrated,
meteorologically grounded, safe explanations suitable for decision makers and forecasters.
"""

from __future__ import annotations

from typing import Any

FEATURE_EXPLANATION_TEMPLATES = {
    # Multi-model spread
    "mm_std_temp": {
        "positive": "Significant disagreement among NWP models (GFS, ECMWF, ICON, GEM) on temperature evolution.",
        "negative": "Tight agreement across all four global NWP models regarding temperature.",
    },
    "mm_std_precip": {
        "positive": "Substantial inter-model divergence in predicted precipitation volume and timing.",
        "negative": "Consistent consensus across models regarding precipitation amounts.",
    },
    "mm_std_wind": {
        "positive": "High variance among model wind speed predictions across the regional domain.",
        "negative": "Low multi-model variance in surface wind velocity forecast.",
    },
    "mm_std_humidity": {
        "positive": "Marked divergence across models for 2-metre relative humidity fields.",
        "negative": "Consistent multi-model estimates of boundary layer humidity.",
    },
    "mm_disagreement_temp": {
        "positive": "NWP centres exhibit contrasting thermal profiles.",
        "negative": "NWP centres indicate coherent thermal conditions.",
    },
    "mm_disagreement_precip": {
        "positive": "High structural disagreement in rain footprint among forecast centers.",
        "negative": "Forecast centers show aligned spatial rain forecasts.",
    },

    # Historical Performance
    "hist_bust_rate_temp_w30": {
        "positive": "Historical forecasts for this location and season have exhibited elevated 30-day error rates.",
        "negative": "Recent 30-day historical forecast verification shows high stability and low bust frequency.",
    },
    "hist_bust_rate_precip_w30": {
        "positive": "Location historically prone to localized precipitation forecast busts during this regime.",
        "negative": "Recent precipitation forecasts in this region have tracked ERA5-Land truth closely.",
    },
    "hist_err_mean_temp_w30": {
        "positive": "Elevated 30-day baseline mean absolute error in temperature predictions at this station.",
        "negative": "Low historical baseline error regime for regional temperature.",
    },
    "hist_bias_temp_w30": {
        "positive": "Persistent thermal model bias observed over recent 30-day initialization cycles.",
        "negative": "Unbiased thermal model calibration observed over recent initialization cycles.",
    },

    # Lead Time
    "lead_hours": {
        "positive": "Extended forecast lead time increases cumulative dynamical error growth.",
        "negative": "Short forecast lead time provides higher atmospheric predictability.",
    },
    "lead_age_days": {
        "positive": "Medium-range horizon introduces inherent dynamical atmospheric uncertainty.",
        "negative": "Near-term initialization horizon limits error amplification.",
    },

    # Temporal Changes / Rapid Transitions
    "chg_temp_24h": {
        "positive": "Rapid predicted 24-hour temperature swing signals sharp front or convective transition.",
        "negative": "Steady synoptic temperature progression without rapid shifts.",
    },
    "chg_precip_24h": {
        "positive": "Abrupt predicted change in 24-hour rain accumulation indicates volatile moisture flux.",
        "negative": "Smooth precipitation trend across subsequent forecast horizons.",
    },
    "run2run_temp_24h": {
        "positive": "Notable run-to-run forecast flip between consecutive model cycles.",
        "negative": "High run-to-run forecast consistency between consecutive cycles.",
    },

    # Geography / Elevation
    "elevation_km": {
        "positive": "Complex orographic elevation profile amplifies NWP sub-grid parameterization uncertainties.",
        "negative": "Lowland topography reduces terrain-induced microclimate forecast errors.",
    },
    "lat": {
        "positive": "Regional synoptic dynamics at this latitude exhibit seasonal variability.",
        "negative": "Latitudinal regime currently under stable synoptic forcing.",
    },
}


def explain_prediction_factors(
    top_pos_factors: list[dict[str, Any]],
    top_neg_factors: list[dict[str, Any]],
    max_reasons: int = 3,
) -> tuple[list[str], list[str]]:
    """Convert raw SHAP positive and negative factors into human-readable bullet points."""
    reasons: list[str] = []
    stabilizers: list[str] = []

    for f in top_pos_factors:
        fname = f["feature"]
        text = None
        for key, templ in FEATURE_EXPLANATION_TEMPLATES.items():
            if key in fname:
                text = templ["positive"]
                break
        if not text:
            if "mm_" in fname:
                text = "Elevated multi-model forecast spread across NWP centers."
            elif "hist_" in fname:
                text = "Elevated historical forecast error regime for similar conditions."
            elif "lead_" in fname:
                text = "Extended forecast horizon increases dynamical uncertainty."
            elif "chg_" in fname or "run2run" in fname:
                text = "Rapid temporal shifts or run-to-run forecast adjustments."
            else:
                text = f"Feature `{fname}` is associated with higher risk of forecast bust."
        if text and text not in reasons:
            reasons.append(text)
        if len(reasons) >= max_reasons:
            break

    for f in top_neg_factors:
        fname = f["feature"]
        text = None
        for key, templ in FEATURE_EXPLANATION_TEMPLATES.items():
            if key in fname:
                text = templ["negative"]
                break
        if not text:
            if "mm_" in fname:
                text = "Strong agreement between multi-model forecast centers."
            elif "hist_" in fname:
                text = "Consistent historical forecast reliability in this region."
            elif "lead_" in fname:
                text = "Shorter lead time minimizes numerical error accumulation."
            else:
                text = f"Feature `{fname}` indicates stable forecast conditions."
        if text and text not in stabilizers:
            stabilizers.append(text)
        if len(stabilizers) >= max_reasons:
            break

    if not reasons:
        reasons = ["Forecast parameters operate within normal variance envelopes."]
    if not stabilizers:
        stabilizers = ["Forecast initialized under moderate atmospheric stability."]

    return reasons, stabilizers
