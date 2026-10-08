from __future__ import annotations

import json
import math
from datetime import datetime, timezone

import pandas as pd

from ..config import (
    ALIGNED_CSV,
    APP_VERSION,
    ATTRIBUTION,
    BLEND_TEST_CSV,
    BLEND_TEST_CSVS,
    FORECAST_HORIZON_CAP_H,
    HORIZON_NOTE,
    LEAD_TIMES,
    OPERATIONAL_LEAD_HOURS,
    META_MODEL_PATH,
    META_MODEL_PATHS,
    MODEL_KEYS,
    PROVENANCE_JSON,
    REGIONS,
    REPLAY_TIMELINES,
    REPORTS_DIR,
    VARIABLES,
    is_variable_validated,
)
from ..providers.open_meteo import ProviderError, get_live_forecast, probe_provider, FORECAST_API, PREVIOUS_RUNS_API, ARCHIVE_API
from ..science.meta_model import (
    feature_importances,
    load_bundle,
    predict_errors_rows,
    predict_errors_single_row,
)
from ..science.regime import classify_regime
from ..science.weighting import blend_value, ensemble_stats, weights_from_predicted_errors

MODE_LIVE = "LIVE"
MODE_CACHED = "CACHED"
MODE_REPLAY = "REPLAY"


class ServiceUnavailable(RuntimeError):

    def __init__(self, message: str, mode_tried: list[str] | None = None,
                 *, provider_http_status: int | None = None,
                 provider_reason: str | None = None):
        super().__init__(message)
        self.mode_tried = mode_tried or []
        self.provider_http_status = provider_http_status
        self.provider_reason = provider_reason


_bundle_cache: dict[str, dict | None] = {}


def _bundle(variable: str = "temperature") -> dict | None:
    global _bundle_cache
    if variable not in _bundle_cache:
        _bundle_cache[variable] = load_bundle(variable=variable)
    return _bundle_cache[variable]


def reset_bundle_cache() -> None:
    global _bundle_cache
    _bundle_cache.clear()


def _now_hour() -> datetime:
    return datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)


def _features(
    region: dict,
    ts: datetime,
    lead: int,
    regime_index: int,
    ens_mean: float | None,
    ens_spread: float | None,
    own: float | None,
    elevation: float | None,
) -> dict[str, float]:
    return {
        "latitude": float(region["lat"]),
        "longitude": float(region["lon"]),
        "elevation_m": float(elevation or 0.0),
        "lead_time_hours": float(lead),
        "day_of_year": float(ts.timetuple().tm_yday),
        "hour_of_day": float(ts.hour),
        "month": float(ts.month),
        "regime_index": float(regime_index),
        "ensemble_mean": float(ens_mean if ens_mean is not None else 0.0),
        "ensemble_spread": float(ens_spread if ens_spread is not None else 0.0),
        "model_own_forecast": float(own if own is not None else 0.0),
    }


def _weights_for(
    feats: dict[str, float],
    variable: str,
    member_values: dict[str, float | None],
    bundle: dict | None,
) -> tuple[dict[str, int], str, dict[str, float] | None, str | None]:
    available = {k: v for k, v in member_values.items() if v is not None}
    if not available:
        return {}, "none", None, "no_model_values_available"

    # Only promote to adaptive XGBoost if variable is validated AND bundle matches variable
    if is_variable_validated(variable) and bundle is not None and bundle.get("variable") == variable:
        own = member_values
        preds: dict[str, float] = {}
        for key in available:
            f = dict(feats)
            f["model_own_forecast"] = float(available[key])
            preds[key] = predict_errors_single_row(bundle, f)[key]
        weights = weights_from_predicted_errors(preds)
        reason = bundle.get("validation", {}).get("reason") or "Adaptive XGBoost weighting enabled after held-out validation."
        return weights, "adaptive_xgboost", preds, reason

    # Otherwise equal weights
    weights = weights_from_predicted_errors({k: 1.0 for k in available})
    if bundle is not None:
        val_meta = bundle.get("validation", {})
        reason = val_meta.get("reason") or (
            "Adaptive model trained but not promoted because held-out performance "
            "did not beat the best single NWP member / baseline."
        )
    else:
        reason = (
            "No meta-model trained for this variable yet; equal weights are used "
            "and skill is unvalidated."
        )
    return weights, "equal_fallback_untrained", None, reason


def _load_replay() -> dict:
    if not REPLAY_TIMELINES.exists():
        return {"timelines": {}}
    try:
        return json.loads(REPLAY_TIMELINES.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {"timelines": {}}


def _acquire_live(region_id: str) -> tuple[dict, str]:
    region = REGIONS[region_id]
    tried: list[str] = []
    provider_status: int | None = None
    provider_reason: str | None = None
    try:
        series, mode = get_live_forecast(region["lat"], region["lon"])
        return series, mode
    except ProviderError as exc:
        tried.append(f"live:{exc}")
        provider_status = getattr(exc, "http_status", None)
        provider_reason = getattr(exc, "provider_reason", None)
    replay = _load_replay()
    if region_id in replay.get("timelines", {}):
        return {
            "__replay__": replay,
            "__provider_status__": provider_status,
            "__provider_reason__": provider_reason,
        }, MODE_REPLAY
    raise ServiceUnavailable(
        "Forecast data unavailable: live provider unreachable, no cached copy, "
        "no replay archive for this region.",
        tried,
        provider_http_status=provider_status,
        provider_reason=provider_reason,
    )


def _replay_timeline(
    region_id: str,
    lead: int,
    *,
    provider_http_status: int | None = None,
    provider_reason: str | None = None,
) -> tuple[dict, str]:
    replay = _load_replay()
    tl = replay.get("timelines", {}).get(region_id, {}).get(str(lead))
    if tl is None:
        raise ServiceUnavailable(
            "Forecast data unavailable: live provider unreachable and the "
            "replay archive has no timeline for this region/lead. Run the "
            "pipeline to build data/replay/timelines.json.",
            [MODE_REPLAY],
            provider_http_status=provider_http_status,
            provider_reason=provider_reason,
        )
    return {"__replay_timeline__": tl, "__replay_meta__": replay}, MODE_REPLAY


class ClientSeriesValidationError(ValueError):
    """Raised when client-supplied forecast series fails validation."""
    pass


def validate_client_series(region_id: str, variable: str, series: dict) -> None:
    """Validate client-supplied Open-Meteo forecast series with strict security and physics bounds."""
    if region_id not in REGIONS:
        raise ClientSeriesValidationError(f"Unknown region '{region_id}'")
    if variable not in VARIABLES:
        raise ClientSeriesValidationError(f"Unknown variable '{variable}'")
    if not isinstance(series, dict):
        raise ClientSeriesValidationError("Payload 'series' must be a dictionary")

    canon_reg = REGIONS[region_id]
    req_coords = series.get("requested_coordinates") or {}
    if not isinstance(req_coords, dict):
        raise ClientSeriesValidationError("series.requested_coordinates must be a dictionary")

    req_lat = req_coords.get("lat")
    req_lon = req_coords.get("lon")
    if req_lat is None or req_lon is None:
        raise ClientSeriesValidationError("series.requested_coordinates must contain 'lat' and 'lon'")

    try:
        f_lat = float(req_lat)
        f_lon = float(req_lon)
    except (ValueError, TypeError):
        raise ClientSeriesValidationError("Coordinates must be numeric floats")

    if abs(f_lat - canon_reg["lat"]) > 0.25 or abs(f_lon - canon_reg["lon"]) > 0.25:
        raise ClientSeriesValidationError(
            f"Coordinates ({f_lat:.4f}, {f_lon:.4f}) deviate from canonical region "
            f"'{region_id}' coordinates ({canon_reg['lat']:.4f}, {canon_reg['lon']:.4f}) by >0.25 deg"
        )

    times = series.get("time")
    if not isinstance(times, list) or len(times) < 24:
        raise ClientSeriesValidationError("series.time must be a list with at least 24 timestamps")

    n_times = len(times)
    for i, t in enumerate(times):
        if not isinstance(t, str):
            raise ClientSeriesValidationError(f"Timestamp at index {i} is not a string: {t}")
        try:
            datetime.fromisoformat(t.replace("Z", "+00:00"))
        except Exception:
            raise ClientSeriesValidationError(f"Invalid timestamp format at index {i}: {t}")

    models = series.get("models")
    if not isinstance(models, dict):
        raise ClientSeriesValidationError("series.models must be a dictionary")

    from ..config import VARIABLE_KEYS
    for mkey in MODEL_KEYS:
        if mkey not in models:
            raise ClientSeriesValidationError(f"Missing required model '{mkey}' in series.models")
        m_dict = models[mkey]
        if not isinstance(m_dict, dict):
            raise ClientSeriesValidationError(f"Model '{mkey}' must be a dictionary of variable series")

        for vkey in VARIABLE_KEYS:
            if vkey not in m_dict:
                raise ClientSeriesValidationError(f"Model '{mkey}' is missing required variable '{vkey}'")
            vals = m_dict[vkey]
            if not isinstance(vals, list) or len(vals) != n_times:
                raise ClientSeriesValidationError(
                    f"Model '{mkey}' variable '{vkey}' series length does not match time length ({n_times})"
                )

            for idx, val in enumerate(vals):
                if val is None:
                    continue
                if not isinstance(val, (int, float)) or math.isnan(val) or math.isinf(val):
                    raise ClientSeriesValidationError(
                        f"Model '{mkey}' variable '{vkey}' contains invalid number at index {idx}: {val}"
                    )

                if vkey == "rainfall" and (val < 0.0 or val > 2000.0):
                    raise ClientSeriesValidationError(f"Rainfall out of physical bounds [0, 2000] mm at index {idx}: {val}")
                elif vkey == "wind_speed" and (val < 0.0 or val > 400.0):
                    raise ClientSeriesValidationError(f"Wind speed out of physical bounds [0, 400] km/h at index {idx}: {val}")
                elif vkey == "temperature" and (val < -80.0 or val > 70.0):
                    raise ClientSeriesValidationError(f"Temperature out of physical bounds [-80, 70] C at index {idx}: {val}")
                elif vkey == "pressure" and (val < 800.0 or val > 1100.0):
                    raise ClientSeriesValidationError(f"Pressure out of physical bounds [800, 1100] hPa at index {idx}: {val}")


def process_series_forecast(
    region_id: str,
    variable: str,
    series: dict,
    data_mode: str = MODE_LIVE,
    lead: int = 48,
) -> dict:
    """Execute the full VARUNA scientific forecasting pipeline on an in-memory NWP series."""
    region = REGIONS[region_id]
    now = _now_hour()
    times = series["time"]
    elevation = series.get("elevation_m")
    bundle = _bundle(variable)

    rows: list[dict] = []
    last_regime = {"index": None, "name": None}

    start = 0
    for i, t in enumerate(times):
        dt = datetime.fromisoformat(t.replace("Z", "+00:00")).replace(tzinfo=timezone.utc)
        if dt >= now:
            start = i
            break

    for t in times[start:]:
        dt = datetime.fromisoformat(t.replace("Z", "+00:00")).replace(tzinfo=timezone.utc)
        lead_h = int((dt - now).total_seconds() // 3600)
        if lead_h > FORECAST_HORIZON_CAP_H:
            break
        idx = times.index(t)

        member_values: dict[str, float | None] = {}
        ctx_vals: dict[str, list[float]] = {"temperature": [], "rainfall": [], "wind_speed": [], "pressure": []}
        for key in MODEL_KEYS:
            model_vars = series["models"].get(key, {})
            member_values[key] = _num(model_vars.get(variable, [None] * len(times))[idx])
            for v in ctx_vals:
                val = _num(model_vars.get(v, [None] * len(times))[idx])
                if val is not None:
                    ctx_vals[v].append(val)

        ens_mean, ens_spread = ensemble_stats(member_values)

        def _ctx(v: str) -> float | None:
            return (sum(ctx_vals[v]) / len(ctx_vals[v])) if ctx_vals[v] else None

        regime_index, regime_name = classify_regime(
            month=dt.month, lat=region["lat"], lon=region["lon"],
            temperature_c=_ctx("temperature"), pressure_hpa=_ctx("pressure"),
            wind_kmh=_ctx("wind_speed"), precip_mm=_ctx("rainfall"),
        )
        last_regime = {"index": regime_index, "name": regime_name}
        rows.append({
            "time": t, "dt": dt, "lead": lead_h, "member_values": member_values,
            "ens_mean": ens_mean, "ens_spread": ens_spread,
            "regime_index": regime_index, "regime_name": regime_name,
        })

    if not rows:
        raise ServiceUnavailable("Live forecast returned no usable future hours.", ["live"])

    shared_rows: list[dict[str, float]] = []
    own: dict[str, list[float]] = {k: [] for k in MODEL_KEYS}
    for r in rows:
        dt = r["dt"]
        shared = _features(
            region, dt, r["lead"], r["regime_index"], r["ens_mean"],
            r["ens_spread"], 0.0, elevation,
        )
        shared.pop("model_own_forecast", None)
        shared_rows.append(shared)
        for key in MODEL_KEYS:
            v = r["member_values"][key]
            own[key].append(float(v if v is not None else (r["ens_mean"] or 0.0)))

    preds_rows: list[dict[str, float]] | None = None
    use_adaptive = (
        is_variable_validated(variable)
        and bundle is not None
        and bundle.get("variable") == variable
    )
    if use_adaptive:
        preds_rows = predict_errors_rows(bundle, shared_rows, own)

    entries = []
    worst_models_used = 4
    any_degraded = False
    schemes: set[str] = set()
    reasons: set[str] = set()

    for i, r in enumerate(rows):
        member_values = r["member_values"]
        ens_mean, ens_spread = r["ens_mean"], r["ens_spread"]
        models_used = sum(1 for v in member_values.values() if v is not None)
        degraded = models_used < 2
        worst_models_used = min(worst_models_used, models_used)
        any_degraded = any_degraded or degraded

        available = {k: v for k, v in member_values.items() if v is not None}
        if not available:
            weights, scheme, preds, reason = {}, "none", None, "no_model_values_available"
        elif preds_rows is not None:
            preds = {k: v for k, v in preds_rows[i].items() if k in available}
            weights = weights_from_predicted_errors(preds)
            scheme = "adaptive_xgboost"
            reason = bundle.get("validation", {}).get("reason") or "Adaptive XGBoost weighting enabled after held-out validation."
        else:
            weights = weights_from_predicted_errors({k: 1.0 for k in available})
            scheme = "equal_fallback_untrained"
            preds = None
            if bundle is not None:
                reason = bundle.get("validation", {}).get("reason") or (
                    "Adaptive model trained but not promoted because held-out performance "
                    "did not beat the best single NWP member / baseline."
                )
            else:
                reason = (
                    "No meta-model trained for this variable yet; equal weights are "
                    "used and skill is unvalidated."
                )
        schemes.add(scheme)
        if reason:
            reasons.add(reason)
        blend = blend_value(member_values, weights) if weights else None

        entries.append({
            "time": r["time"],
            "lead_time_hours": r["lead"],
            "models": {k: member_values[k] for k in MODEL_KEYS},
            "weights": weights,
            "blend": round(blend, 3) if blend is not None else None,
            "models_used": models_used,
            "degraded": degraded,
            "regime_index": r["regime_index"],
            "predicted_errors": preds,
        })

    if not entries:
        raise ServiceUnavailable("Live forecast returned no usable future hours.", ["live"])

    return {
        "region_id": region_id,
        "variable": variable,
        "unit": VARIABLES[variable]["unit"],
        "data_mode": data_mode,
        "validated": (
            is_variable_validated(variable)
            and "adaptive_xgboost" in schemes
            and region.get("validated", False)
        ),
        "weighting_scheme": sorted(schemes)[0] if len(schemes) == 1 else "mixed",
        "weighting_reason": sorted(reasons)[0] if reasons else None,
        "regime": last_regime,
        "models_used": worst_models_used,
        "degraded": any_degraded,
        "timeline": entries,
        "horizon_note": HORIZON_NOTE,
        "attribution": ATTRIBUTION,
        "issued_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


def process_client_forecast(
    region_id: str,
    variable: str,
    series: dict,
    lead_time_hours: int | None = None,
) -> dict:
    """Validate client-supplied live NWP series and run the VARUNA scientific pipeline."""
    validate_client_series(region_id, variable, series)
    lead = lead_time_hours if (lead_time_hours is not None and lead_time_hours in OPERATIONAL_LEAD_HOURS) else 48
    payload = process_series_forecast(region_id, variable, series, data_mode=MODE_LIVE, lead=lead)
    if lead_time_hours is not None:
        payload["requested_lead_time_hours"] = lead_time_hours

    # Warm server-side SQLite cache with verified series so legacy server callers benefit
    try:
        from ..config import VARIABLE_KEYS
        from ..providers.cache import CACHE
        lat = REGIONS[region_id]["lat"]
        lon = REGIONS[region_id]["lon"]
        hourly = ",".join(VARIABLES[v]["openmeteo"] for v in VARIABLE_KEYS)
        cache_key = f"live|{lat:.4f}|{lon:.4f}|{hourly}|8"
        CACHE.put(cache_key, series, kind="live")
    except Exception as exc:
        pass

    return payload


def _live_timeline(region_id: str, variable: str, lead: int = 48) -> dict:
    region = REGIONS[region_id]
    series, data_mode = _acquire_live(region_id)
    if data_mode == MODE_REPLAY:
        provider_status = series.get("__provider_status__")
        provider_reason = series.get("__provider_reason__")
        replay_lead = lead if lead in LEAD_TIMES else 48
        payload, mode = _replay_timeline(
            region_id, replay_lead,
            provider_http_status=provider_status,
            provider_reason=provider_reason,
        )
        return _replay_timeline_entries(
            region_id, variable, replay_lead, payload, mode,
            provider_http_status=provider_status,
            provider_reason=provider_reason,
        )

    return process_series_forecast(region_id, variable, series, data_mode=data_mode, lead=lead)


def _replay_timeline_entries(region_id: str, variable: str, lead: int,
                             payload: dict, data_mode: str,
                             *, provider_http_status: int | None = None,
                             provider_reason: str | None = None) -> dict:
    region = REGIONS[region_id]
    tl = payload["__replay_timeline__"]
    meta = payload.get("__replay_meta__", {})
    if tl.get("variable") != variable:
        raise ServiceUnavailable(
            f"Replay archive only contains variable='temperature'; "
            f"'{variable}' is not available while the provider is offline.",
            [MODE_REPLAY],
            provider_http_status=provider_http_status,
            provider_reason=provider_reason,
        )
    bundle = _bundle(variable)
    entries = []
    worst = 4
    any_degraded = False
    for i, t in enumerate(tl["times"]):
        member_values = {k: tl["members"][k][i] for k in MODEL_KEYS}
        models_used = sum(1 for v in member_values.values() if v is not None)
        degraded = models_used < 2
        worst = min(worst, models_used)
        any_degraded = any_degraded or degraded
        w = tl["weights"][i]
        entries.append({
            "time": t,
            "lead_time_hours": lead,
            "models": member_values,
            "weights": {k: int(w[k]) for k in MODEL_KEYS if k in w},
            "blend": tl["blend"][i],
            "models_used": models_used,
            "degraded": degraded,
            "regime_index": tl["regime_index"][i],
        })
    regime_name = tl["regime"][-1] if tl["regime"] else None
    regime_index = tl["regime_index"][-1] if tl["regime_index"] else None
    return {
        "region_id": region_id,
        "variable": variable,
        "unit": VARIABLES[variable]["unit"],
        "data_mode": data_mode,
        "validated": (
            is_variable_validated(variable)
            and region.get("validated", False)
        ),
        "weighting_scheme": "adaptive_xgboost" if (is_variable_validated(variable) and bundle) else "equal_fallback_untrained",
        "weighting_reason": (
            "Adaptive XGBoost weighting enabled after held-out validation."
            if (is_variable_validated(variable) and bundle)
            else "Replay timeline uses equal-weight consensus."
        ),
        "regime": {"index": regime_index, "name": regime_name},
        "models_used": worst,
        "degraded": any_degraded,
        "timeline": entries,
        "horizon_note": (
            f"REPLAY: archived forecast cycle from window "
            f"{meta.get('window')} (season {meta.get('season')}), fixed "
            f"{lead} h lead. Not a current forecast."
        ),
        "attribution": ATTRIBUTION,
        "issued_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


def _num(v):
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if math.isnan(f):
        return None
    return f


def forecast_payload(region_id: str, variable: str, lead_time_hours: int | None) -> dict:
    if region_id not in REGIONS:
        raise ServiceUnavailable(f"Unknown region '{region_id}'.")
    if variable not in VARIABLES:
        raise ServiceUnavailable(f"Unknown variable '{variable}'.")
    lead = lead_time_hours if (lead_time_hours is not None and lead_time_hours in OPERATIONAL_LEAD_HOURS) else 48
    if lead_time_hours is not None and lead_time_hours > FORECAST_HORIZON_CAP_H:
        payload = _live_timeline(region_id, variable, lead=lead)
        payload["horizon_note"] = (
            f"Requested lead {lead_time_hours} h exceeds the {FORECAST_HORIZON_CAP_H} h "
            f"cap. {HORIZON_NOTE}"
        )
        payload["requested_lead_time_hours"] = lead_time_hours
        return payload

    # _live_timeline handles the full live → cache → replay fallback chain.
    # No separate probe needed — _acquire_live inside _live_timeline will
    # attempt get_live_forecast and fall back to replay if the provider is down.
    payload = _live_timeline(region_id, variable, lead=lead)
    if lead_time_hours is not None:
        payload["requested_lead_time_hours"] = lead_time_hours
    return payload


def weights_payload(region_id: str, variable: str, lead_time_hours: int) -> dict:
    if region_id not in REGIONS:
        raise ServiceUnavailable(f"Unknown region '{region_id}'.")
    if variable not in VARIABLES:
        raise ServiceUnavailable(f"Unknown variable '{variable}'.")
    region = REGIONS[region_id]
    bundle = _bundle(variable)

    target = _now_hour()
    member_values: dict[str, float | None] = {}
    ctx_vals: dict[str, list[float]] = {"temperature": [], "rainfall": [], "wind_speed": [], "pressure": []}
    ts = target
    data_mode = MODE_LIVE
    try:
        series, data_mode = get_live_forecast(region["lat"], region["lon"])
        times = series["time"]
        target = _now_hour()
        idx = None
        for i, t in enumerate(times):
            dt = datetime.fromisoformat(t.replace("Z", "+00:00")).replace(tzinfo=timezone.utc)
            if dt >= target:
                idx = i + lead_time_hours if i + lead_time_hours < len(times) else None
                ts = target
                break
        if idx is None:
            raise ProviderError("lead beyond available forecast hours")
        for key in MODEL_KEYS:
            model_vars = series["models"].get(key, {})
            member_values[key] = _num(model_vars.get(variable, [None] * len(times))[idx])
            for v in ctx_vals:
                val = _num(model_vars.get(v, [None] * len(times))[idx])
                if val is not None:
                    ctx_vals[v].append(val)
        elevation = series.get("elevation_m")
        ts = datetime.fromisoformat(times[idx].replace("Z", "+00:00")).replace(tzinfo=timezone.utc)
    except ProviderError as exc:
        p_status = getattr(exc, "http_status", None)
        p_reason = getattr(exc, "provider_reason", None)
        if variable != "temperature":
            raise ServiceUnavailable(
                f"Replay archive only contains variable='temperature'; "
                f"'{variable}' is not available while the provider is offline.",
                [MODE_REPLAY],
                provider_http_status=p_status,
                provider_reason=p_reason,
            )
        payload, data_mode = _replay_timeline(
            region_id, lead_time_hours,
            provider_http_status=p_status,
            provider_reason=p_reason,
        )
        tl = payload["__replay_timeline__"]
        i = len(tl["times"]) // 2
        member_values = {k: tl["members"][k][i] for k in MODEL_KEYS}
        ts = datetime.fromisoformat(tl["times"][i].replace("Z", "+00:00")).replace(tzinfo=timezone.utc)
        elevation = tl.get("elevation_m")
        regime_index = tl["regime_index"][i]
        regime_name = tl["regime"][i]
        def _ctx(v: str) -> float | None:
            return None
        ens_mean, ens_spread = ensemble_stats(member_values)
        feats = _features(region, ts, lead_time_hours, regime_index, ens_mean, ens_spread,
                          ens_mean, elevation)
        weights, scheme, preds, reason = _weights_for(feats, variable, member_values, bundle)
        return {
            "region_id": region_id,
            "variable": variable,
            "unit": VARIABLES[variable]["unit"],
            "lead_time_hours": lead_time_hours,
            "data_mode": data_mode,
            "validated": (
                is_variable_validated(variable)
                and scheme == "adaptive_xgboost"
                and region.get("validated", False)
            ),
            "regime": {"index": regime_index, "name": regime_name},
            "member_values": member_values,
            "predicted_errors": {k: round(v, 4) for k, v in preds.items()} if preds else None,
            "weights": weights,
            "weights_sum": sum(weights.values()),
            "weighting_scheme": scheme,
            "reason": reason,
            "attribution": ATTRIBUTION,
        }

    def _ctx(v: str) -> float | None:
        return (sum(ctx_vals[v]) / len(ctx_vals[v])) if ctx_vals[v] else None

    regime_index, regime_name = classify_regime(
        month=ts.month, lat=region["lat"], lon=region["lon"],
        temperature_c=_ctx("temperature"), pressure_hpa=_ctx("pressure"),
        wind_kmh=_ctx("wind_speed"), precip_mm=_ctx("rainfall"),
    )
    ens_mean, ens_spread = ensemble_stats(member_values)
    feats = _features(region, ts, lead_time_hours, regime_index, ens_mean, ens_spread,
                      ens_mean, elevation)
    weights, scheme, preds, reason = _weights_for(feats, variable, member_values, bundle)
    del target
    return {
        "region_id": region_id,
        "variable": variable,
        "unit": VARIABLES[variable]["unit"],
        "lead_time_hours": lead_time_hours,
        "data_mode": data_mode,
        "validated": (
            is_variable_validated(variable)
            and scheme == "adaptive_xgboost"
            and region.get("validated", False)
        ),
        "regime": {"index": regime_index, "name": regime_name},
        "member_values": member_values,
        "predicted_errors": {k: round(v, 4) for k, v in preds.items()} if preds else None,
        "weights": weights,
        "weights_sum": sum(weights.values()),
        "weighting_scheme": scheme,
        "reason": reason,
        "attribution": ATTRIBUTION,
    }


def extremes_payload(region_id: str, lead_time_hours: int, simulate: bool = False) -> dict:
    from ..config import EXTREME_THRESHOLDS as TH

    if region_id not in REGIONS:
        raise ServiceUnavailable(f"Unknown region '{region_id}'.")

    temps = _live_timeline(region_id, "temperature")
    winds = _live_timeline(region_id, "wind_speed")
    rains = _live_timeline(region_id, "rainfall")

    def _window(payloads: list[dict], lead: int) -> tuple[int, dict[str, list]]:
        idx = None
        for i, e in enumerate(temps["timeline"]):
            if e["lead_time_hours"] >= lead:
                idx = i
                break
        if idx is None:
            idx = len(temps["timeline"]) - 1
        lo = max(0, idx - 23)
        return idx, {"temperature": [temps["timeline"][j]["blend"] for j in range(lo, idx + 1)],
                     "wind_speed": [winds["timeline"][j]["blend"] for j in range(lo, idx + 1)],
                     "rainfall": [rains["timeline"][j]["blend"] for j in range(lo, idx + 1)]}

    idx, win = _window([temps, winds, rains], lead_time_hours)
    valid = lambda vals: [v for v in vals if v is not None]

    rain24 = sum(valid(win["rainfall"]))
    temp_max = max(valid(win["temperature"])) if valid(win["temperature"]) else None
    wind_max = max(valid(win["wind_speed"])) if valid(win["wind_speed"]) else None

    checks: list[dict] = []
    alerts: list[dict] = []

    def _add(hazard: str, label: str, value, unit: str, threshold: float,
             threshold_label: str, severity: str, validated: bool, crossed: bool):
        check = {
            "hazard": hazard, "label": label, "value": value, "unit": unit,
            "threshold": threshold, "threshold_label": threshold_label,
            "crossed": crossed, "severity": severity, "validated": validated,
        }
        checks.append(check)
        if crossed:
            alerts.append(dict(check))

    very_heavy = rain24 >= TH["very_heavy_rain_mm_24h"]
    gale = wind_max is not None and wind_max >= TH["wind_gale_kmh"]

    _add("heavy_rain", "Heavy Rainfall", round(rain24, 1), "mm/24h",
         TH["very_heavy_rain_mm_24h"] if very_heavy else TH["heavy_rain_mm_24h"],
         ("IMD Very Heavy Rain >= 115.6 mm/24h" if very_heavy
          else "IMD Heavy Rain >= 64.5 mm/24h"),
         "very_heavy" if very_heavy else "heavy", is_variable_validated("rainfall"),
         rain24 >= TH["heavy_rain_mm_24h"])
    _add("heatwave", "Heatwave", round(temp_max, 1) if temp_max is not None else None,
         "\u00b0C", TH["heatwave_c"], "IMD Heatwave daily max >= 45.0 \u00b0C",
         "heatwave", is_variable_validated("temperature"),
         temp_max is not None and temp_max >= TH["heatwave_c"])
    _add("wind_squall", "Squally Winds", round(wind_max, 1) if wind_max is not None else None,
         "km/h", TH["wind_gale_kmh"] if gale else TH["wind_squall_kmh"],
         ("IMD Gale >= 62 km/h" if gale else "IMD Squally weather >= 55 km/h"),
         "gale" if gale else "squall", is_variable_validated("wind_speed"),
         wind_max is not None and wind_max >= TH["wind_squall_kmh"])

    data_mode = temps["data_mode"]
    return {
        "region_id": region_id,
        "lead_time_hours": lead_time_hours,
        "data_mode": data_mode,
        "status": "alerts" if alerts else "no_alerts",
        "alerts": alerts,
        "checks": checks,
        "window_hours": min(24, idx + 1),
        "evaluated_blend_time": temps["timeline"][idx]["time"],
        "validated": {var: is_variable_validated(var) for var in ["temperature", "rainfall", "wind_speed", "pressure"]},
        "simulated": bool(simulate),
        "simulate_note": (
            "simulate=true: values are illustrative recombinations, not a "
            "live alert decision." if simulate else None
        ),
        "note": (
            "Thresholds: rainfall 64.5 mm heavy / 115.6 mm very heavy (24 h "
            "accumulation), heatwave 45.0 C, wind squall 55 km/h / gale 62 "
            "km/h. Alerts fire only when the blended forecast crosses a "
            "threshold. Temperature and surface pressure are benchmarked and validated; "
            "rainfall and wind speed operate on equal-weight NWP consensus."
        ),
        "attribution": ATTRIBUTION,
    }


def explain_payload(region_id: str, variable: str, lead_time_hours: int) -> dict:
    w = weights_payload(region_id, variable, lead_time_hours)
    bundle = _bundle(variable)
    validated = is_variable_validated(variable)
    if not validated:
        reason = (
            bundle.get("validation", {}).get("reason")
            if bundle and bundle.get("validation", {}).get("reason")
            else f"Adaptive meta-model unavailable or unvalidated for {variable}; operational forecast uses equal-weight NWP consensus."
        )
        return {
            **w,
            "feature_importances": [],
            "model_available": bundle is not None,
            "model_note": reason,
        }
    if bundle is None:
        return {
            **w,
            "feature_importances": [],
            "model_available": False,
            "model_note": f"Meta-model for {variable} not trained yet. Run scripts/run_pipeline.py.",
        }
    imps = feature_importances(bundle)
    return {
        **w,
        "model_available": True,
        "feature_importances": [
            {"feature": d["feature"], "importance": round(d["importance"], 5),
             "share": round(d["share"], 5)}
            for d in imps
        ],
        "model_metadata": {
            "variable": bundle.get("variable"),
            "trained_at": bundle.get("metadata", {}).get("trained_at"),
            "n_train_rows": bundle.get("metadata", {}).get("n_train_rows"),
            "xgb_params": bundle.get("metadata", {}).get("xgb_params"),
            "feature_names": bundle.get("feature_names"),
        },
    }


def skill_payload(variable: str = "temperature") -> dict:
    if variable not in VARIABLES:
        return {
            "available": False,
            "variable": variable,
            "reason": "unknown_variable",
            "message": f"Unknown variable '{variable}'. Supported: {', '.join(VARIABLES.keys())}",
        }

    csv_path = BLEND_TEST_CSVS.get(variable)
    if csv_path is None or not csv_path.exists():
        if variable == "temperature" and BLEND_TEST_CSV.exists():
            csv_path = BLEND_TEST_CSV
        else:
            return {
                "available": False,
                "variable": variable,
                "reason": "pipeline_not_run",
                "message": f"Validation not available for {variable}. Run: python scripts/run_pipeline.py --variables {variable}",
            }

    headline = pd.read_csv(csv_path)

    def _read(name: str) -> list[dict]:
        p_var = REPORTS_DIR / f"{name}_{variable}.csv"
        if p_var.exists():
            df = pd.read_csv(p_var)
            return json.loads(df.to_json(orient="records"))
        if variable == "temperature":
            p_gen = REPORTS_DIR / f"{name}.csv"
            if p_gen.exists():
                df = pd.read_csv(p_gen)
                return json.loads(df.to_json(orient="records"))
        return []

    return {
        "available": True,
        "variable": variable,
        "unit": VARIABLES[variable]["unit"],
        "headline": {
            "scope": "held_out_test",
            "rows": json.loads(headline.to_json(orient="records")),
        },
        "by_lead": {"scope": "full_dataset_all_splits", "rows": _read("skill_by_lead")},
        "by_season": {"scope": "full_dataset_all_splits", "rows": _read("skill_by_season")},
        "by_region": {"scope": "full_dataset_all_splits", "rows": _read("skill_by_region")},
        "reference": "ERA5 reanalysis (not station observations, not ground truth)",
        "caveat": (
            "Held-out test covers only the chronologically last season "
            "(Post-Monsoon). Full-dataset tables are clearly scoped and are "
            "not headline skill."
        ),
        "attribution": ATTRIBUTION,
    }


def providers_status_payload() -> dict:
    probes = {
        "open_meteo_forecast": probe_provider(FORECAST_API),
        "open_meteo_previous_runs": probe_provider(PREVIOUS_RUNS_API),
        "open_meteo_archive_era5": probe_provider(ARCHIVE_API),
    }
    provenance = None
    if PROVENANCE_JSON.exists():
        try:
            provenance = json.loads(PROVENANCE_JSON.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            provenance = {"error": "provenance.json unreadable"}
    artifacts = {
        "provenance_json": PROVENANCE_JSON.exists(),
        "blend_test_results_csv": BLEND_TEST_CSV.exists(),
        "aligned_csv": ALIGNED_CSV.exists(),
        "meta_model_joblib": META_MODEL_PATH.exists(),
        "replay_timelines_json": REPLAY_TIMELINES.exists(),
        "feature_importance_png": (REPORTS_DIR / "feature_importance.png").exists(),
        "adaptive_weights_csv": (REPORTS_DIR / "adaptive_weights.csv").exists(),
        "validation_summary_csv": (REPORTS_DIR / "variable_validation_summary.csv").exists(),
        "meta_models": {v: p.exists() for v, p in META_MODEL_PATHS.items()},
    }
    return {
        "providers": probes,
        "artifacts": artifacts,
        "provenance": provenance,
        "checked_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "attribution": ATTRIBUTION,
    }


def regions_payload() -> list[dict]:
    return [
        {
            "id": rid,
            "name": r["name"],
            "state": r["state"],
            "zone": r["zone"],
            "lat": r["lat"],
            "lon": r["lon"],
            "validated": r["validated"],
            "benchmarked": r["benchmarked"],
        }
        for rid, r in REGIONS.items()
    ]


def health_payload() -> dict:
    return {
        "status": "ok",
        "version": APP_VERSION,
        "time": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "model_bundle_loaded": _bundle("temperature") is not None,
    }


def analyze_payload(region_id: str, variable: str, lead_time_hours: int) -> dict:
    if region_id not in REGIONS:
        raise ServiceUnavailable(f"Unknown region '{region_id}'.")
    if variable not in VARIABLES:
        raise ServiceUnavailable(f"Unknown variable '{variable}'.")

    fc = forecast_payload(region_id, variable, lead_time_hours)
    timeline = fc.get("timeline", [])
    if not timeline:
        raise ServiceUnavailable("No forecast timeline available for analysis.")

    target = min(timeline, key=lambda p: abs(p.get("lead_time_hours", 0) - lead_time_hours))

    valid_time = target.get("time")
    models = target.get("models", {})
    weights = target.get("weights", {})
    blend = target.get("blend")
    predicted_errors = target.get("predicted_errors")

    vals = [v for v in models.values() if v is not None]
    spread = round(max(vals) - min(vals), 3) if vals else 0.0

    unit = VARIABLES[variable]["unit"]
    region_name = REGIONS[region_id]["name"]
    var_labels = {
        "temperature": "Temperature",
        "rainfall": "Rainfall",
        "wind_speed": "Wind Speed",
        "pressure": "Surface Pressure",
    }
    var_label = var_labels.get(variable, variable.replace("_", " ").title())

    scheme = fc.get("weighting_scheme", "equal_fallback_untrained")
    is_adaptive = (is_variable_validated(variable) and scheme == "adaptive_xgboost" and predicted_errors is not None)

    best_name = None
    best_weight = 25
    best_err = "N/A"
    if is_adaptive and weights:
        best_key = max(weights, key=lambda k: weights.get(k, 0))
        model_display = {
            "ecmwf_ifs": "ECMWF IFS",
            "ecmwf_aifs": "ECMWF AIFS",
            "ncep_gfs": "NOAA GFS",
            "dwd_icon": "DWD ICON",
        }
        best_name = model_display.get(best_key, best_key)
        best_weight = weights[best_key]
        best_err = f"{predicted_errors[best_key]:.2f} {unit}" if (predicted_errors and best_key in predicted_errors) else "lowest predicted error"
        summary = (
            f"VARUNA adaptive ensemble allocated highest weight to {best_name} ({best_weight}%) "
            f"based on XGBoost predicted member error ({best_err}) over {region_name} at +{lead_time_hours}h lead. "
            f"Ensemble spread across 4 NWP centers is {spread:.1f} {unit}. "
            f"Resulting adaptive blend: {blend:.1f} {unit}."
        )
    else:
        summary = (
            f"Operational equal-weight consensus (25% per member) applied across all 4 NWP centers. "
            f"Adaptive XGBoost meta-model is not validated for {var_label.lower()}; equal-weight fallback used. "
            f"Ensemble spread is {spread:.1f} {unit}. "
            f"Resulting consensus blend: {blend:.1f} {unit}."
        )

    # -------------------------------------------------------------------------
    # Rigorous Meteorological Reliability, Bust Probability & Risk Score
    # -------------------------------------------------------------------------
    tau_bust = {
        "temperature": 2.5,
        "rainfall": 15.0,
        "wind_speed": 12.0,
        "pressure": 2.5,
    }.get(variable, 2.0)

    baseline_rmse = {
        "temperature": 0.78,
        "rainfall": 0.28,
        "wind_speed": 2.14,
        "pressure": 0.67,
    }.get(variable, 1.0)

    err_component = min(predicted_errors.values()) if (is_adaptive and predicted_errors) else baseline_rmse
    total_uncertainty = max(0.05, math.sqrt(err_component**2 + (0.5 * spread)**2))
    z = tau_bust / total_uncertainty
    p_bust = 2.0 * (1.0 - 0.5 * (1.0 + math.erf(z / math.sqrt(2.0))))
    bust_prob_pct = round(max(5.0, min(95.0, p_bust * 100.0)), 1)
    confidence_pct = round(max(10.0, min(98.0, 100.0 - bust_prob_pct)), 1)

    from ..config import EXTREME_THRESHOLDS as TH
    hazard_proximity = 0.0
    rain_24h = 0.0

    if variable == "temperature":
        th_val = TH.get("heatwave_c", 45.0)
        if blend is not None:
            hazard_proximity = max(0.0, min(100.0, ((blend - 30.0) / max(1.0, th_val - 30.0)) * 100.0))
    elif variable == "rainfall":
        th_val = TH.get("heavy_rain_mm_24h", 64.5)
        idx = timeline.index(target) if target in timeline else len(timeline) - 1
        lo = max(0, idx - 23)
        rain_24h = round(sum(
            float(timeline[j]["blend"])
            for j in range(lo, idx + 1)
            if timeline[j].get("blend") is not None
        ), 1)
        hazard_proximity = max(0.0, min(100.0, (rain_24h / th_val) * 100.0))
    elif variable == "wind_speed":
        th_val = TH.get("wind_squall_kmh", 55.0)
        if blend is not None:
            hazard_proximity = max(0.0, min(100.0, (blend / th_val) * 100.0))
    elif variable == "pressure":
        if blend is not None:
            hazard_proximity = max(0.0, min(100.0, (abs(1013.25 - blend) / 20.0) * 100.0))

    risk_score = round(min(100.0, hazard_proximity * 0.5 + bust_prob_pct * 0.5))
    if risk_score < 35:
        severity = "LOW"
    elif risk_score < 65:
        severity = "MODERATE"
    elif risk_score < 85:
        severity = "HIGH"
    else:
        severity = "CRITICAL"

    # Variable-specific structured reasoning
    reasons: list[str] = []
    if spread <= baseline_rmse * 0.8:
        reasons.append(
            f"Multi-model {var_label.lower()} spread is narrow ({spread:.1f} {unit} across 4 NWP centers), demonstrating high inter-model consensus."
        )
    elif spread <= baseline_rmse * 2.0:
        reasons.append(
            f"Multi-model {var_label.lower()} spread is moderate ({spread:.1f} {unit} across 4 NWP centers), reflecting normal atmospheric lead-time dispersion."
        )
    else:
        reasons.append(
            f"Multi-model {var_label.lower()} spread is elevated ({spread:.1f} {unit} across 4 NWP centers), indicating divergent synoptic solutions among NWP members."
        )

    if variable == "temperature":
        if blend is not None and blend >= TH.get("heatwave_c", 45.0):
            reasons.append(f"Current forecast temperature ({blend:.1f} °C) crosses the IMD Heatwave threshold (45.0 °C).")
        else:
            reasons.append(f"Current forecast ({blend:.1f} °C) remains well within the configured heatwave threshold (45.0 °C).")
    elif variable == "rainfall":
        if rain_24h >= TH.get("heavy_rain_mm_24h", 64.5):
            reasons.append(f"24h accumulated rainfall ({rain_24h:.1f} mm) crosses the IMD Heavy Rain threshold (64.5 mm).")
        else:
            reasons.append(f"24h accumulated precipitation ({rain_24h:.1f} mm) is well below the configured heavy rain threshold (64.5 mm).")
    elif variable == "wind_speed":
        if blend is not None and blend >= TH.get("wind_squall_kmh", 55.0):
            reasons.append(f"Forecast wind speed ({blend:.1f} km/h) exceeds the IMD Squally weather threshold (55.0 km/h).")
        else:
            reasons.append(f"Forecast sustained wind ({blend:.1f} km/h) is safely below the configured squall threshold (55.0 km/h).")
    elif variable == "pressure":
        reasons.append(f"Barometric pressure ({blend:.1f} hPa) indicates a stable regional synoptic pressure pattern.")

    if is_adaptive and best_name:
        reasons.append(
            f"XGBoost adaptive meta-model active: lowest predicted error allocated to {best_name} ({best_weight}% weight)."
        )
    else:
        reasons.append(
            f"Operational equal-weight consensus (25% per member) maintained; adaptive ML candidate was not promoted for {var_label.lower()}."
        )

    # Variable-specific diagnostics
    if variable == "temperature":
        variable_features = {
            "ensemble_spread": f"{spread:.2f} °C",
            "predicted_error": best_err if is_adaptive else "N/A",
            "heatwave_headroom": f"{max(0.0, 45.0 - (blend or 0.0)):.1f} °C margin",
            "synoptic_regime": target.get("regime_index", "Standard"),
        }
    elif variable == "rainfall":
        variable_features = {
            "precipitation_spread": f"{spread:.2f} mm",
            "accumulation_24h": f"{rain_24h:.1f} mm",
            "heavy_rain_headroom": f"{max(0.0, 64.5 - rain_24h):.1f} mm margin",
            "convective_regime": target.get("regime_index", "Standard"),
        }
    elif variable == "wind_speed":
        variable_features = {
            "wind_spread": f"{spread:.2f} km/h",
            "max_member_wind": f"{max(vals):.1f} km/h" if vals else "N/A",
            "squall_headroom": f"{max(0.0, 55.0 - (blend or 0.0)):.1f} km/h margin",
            "surface_regime": target.get("regime_index", "Standard"),
        }
    elif variable == "pressure":
        variable_features = {
            "pressure_spread": f"{spread:.2f} hPa",
            "departure_from_standard": f"{(blend - 1013.25) if blend is not None else 0.0:+.1f} hPa",
            "predicted_error": best_err if is_adaptive else "N/A",
            "synoptic_gradient": target.get("regime_index", "Standard"),
        }
    else:
        variable_features = {"ensemble_spread": f"{spread:.2f} {unit}"}

    # Formatted timeseries for Recharts
    time_series = []
    for pt in timeline:
        m = pt.get("models", {})
        time_series.append({
            "time": pt.get("time"),
            "lead_time_hours": pt.get("lead_time_hours"),
            "IFS": m.get("ecmwf_ifs"),
            "AIFS": m.get("ecmwf_aifs"),
            "GFS": m.get("ncep_gfs"),
            "ICON": m.get("dwd_icon"),
            "VARUNA": pt.get("blend"),
        })

    # Horizon Trend across 5 standard leads
    horizon_trend = []
    for h in [24, 48, 72, 120, 168]:
        h_target = min(timeline, key=lambda p: abs(p.get("lead_time_hours", 0) - h))
        h_vals = [v for v in h_target.get("models", {}).values() if v is not None]
        h_spread = round(max(h_vals) - min(h_vals), 2) if h_vals else 0.0
        h_unc = max(0.05, math.sqrt(baseline_rmse**2 + (0.5 * h_spread)**2))
        h_pbust = round(max(5.0, min(95.0, 200.0 * (1.0 - 0.5 * (1.0 + math.erf((tau_bust / h_unc) / math.sqrt(2.0)))))), 1)
        h_conf = round(100.0 - h_pbust, 1)
        horizon_trend.append({
            "lead_time_hours": h,
            "valid_time": h_target.get("time"),
            "blend": h_target.get("blend"),
            "spread": h_spread,
            "confidence": h_conf,
            "bust_probability": h_pbust,
        })

    return {
        "region": region_id,
        "region_name": region_name,
        "variable": variable,
        "variable_label": var_label,
        "unit": unit,
        "lead_time_hours": lead_time_hours,
        "valid_time": valid_time,
        "data_mode": fc.get("data_mode", MODE_LIVE),
        "models": models,
        "weights": weights,
        "predicted_errors": predicted_errors,
        "blend": blend,
        "ensemble_spread": spread,
        "risk_score": risk_score,
        "confidence": confidence_pct,
        "bust_probability": bust_prob_pct,
        "severity": severity,
        "reasons": reasons,
        "variable_features": variable_features,
        "time_series": time_series,
        "horizon_trend": horizon_trend,
        "weighting_scheme": scheme,
        "weighting_reason": fc.get("weighting_reason"),
        "validated": fc.get("validated", False),
        "summary": summary,
        "attribution": ATTRIBUTION,
    }

