"""Data validation & inventory reporting for the VARUNA baseline dataset."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import polars as pl

from src.common import ML_ROOT, VARIABLES, VAR_MODELS, get_config, get_logger, path_for
from src.data.load import column_sets, describe_columns, raw_data_dir, scan_all

logger = get_logger(__name__)


def _coerce_numeric(df: pl.DataFrame) -> pl.DataFrame:
    """Cast numeric columns to float for range checks."""
    lf = df.lazy()
    for c in df.columns:
        if df.schema[c] in (pl.Int8, pl.Int16, pl.Int32, pl.Int64, pl.UInt8,
                            pl.UInt16, pl.UInt32, pl.UInt64):
            lf = lf.with_columns(pl.col(c).cast(pl.Float64))
    return lf.collect()


def validate_dataset() -> dict[str, Any]:
    cfg = get_config("data.yaml")
    report: dict[str, Any] = {
        "status": "PASS",
        "checks": {},
        "warnings": [],
        "ran_at": datetime.now(timezone.utc).isoformat(),
    }

    # --- inventory of raw files ---
    files = list(raw_data_dir().glob("d1_mos/*.parquet"))
    total_size = sum(f.stat().st_size for f in files)
    report["raw_files"] = len(files)
    report["raw_total_size_bytes"] = total_size

    # --- whole corpus description (lazy, cheap) ---
    desc = describe_columns()
    report["row_count"] = desc["row_count"]
    report["column_descriptions"] = {
        k: (v["dtype"], v["nulls"]) for k, v in desc["columns"].items()
    }

    checks: dict[str, Any] = {}
    issues: list[str] = []

    # --- temporal coverage ---
    lf = scan_all()
    t = (
        lf.select(
            pl.col("valid_time").min().alias("vmin"),
            pl.col("valid_time").max().alias("vmax"),
            pl.col("lead_hours").min().alias("lh_min"),
            pl.col("lead_hours").max().alias("lh_max"),
            pl.col("lead_age_days").min().alias("lad_min"),
            pl.col("lead_age_days").max().alias("lad_max"),
            pl.col("loc_id").n_unique().alias("n_locs"),
        ).collect()
    )
    t = t.to_dicts()[0]
    checks["temporal"] = {"ok": True, **t}
    if t["n_locs"] < 100:
        checks["temporal"]["ok"] = False
        issues.append(f"only {t['n_locs']} locations")

    # --- location table ---
    loc = (
        lf.select(["loc_id", "lat", "lon", "elevation_m", "admin1"])
        .unique()
        .collect()
    )
    lat_min, lat_max = loc["lat"].min(), loc["lat"].max()
    lon_min, lon_max = loc["lon"].min(), loc["lon"].max()
    el_min, el_max = loc["elevation_m"].min(), loc["elevation_m"].max()
    admin_count = loc["admin1"].n_unique()
    checks["spatial"] = {
        "ok": True,
        "n_locations": loc.height,
        "lat_range": [lat_min, lat_max],
        "lon_range": [lon_min, lon_max],
        "elevation_m_range": [el_min, el_max],
        "admin1_count": admin_count,
        "admin1_values": sorted(loc["admin1"].unique().to_list()),
    }
    la, lo = cfg["data"]["lat_bounds"], cfg["data"]["lon_bounds"]
    if lat_min < la[0] or lat_max > la[1] or lon_min < lo[0] or lon_max > lo[1]:
        checks["spatial"]["ok"] = False
        issues.append("coordinates outside expected Indian bounds")

    # --- value-range checks (lazy aggregation, no full in-memory load) ---
    agg_exprs: list[Any] = []
    for var in VARIABLES:
        tcol = f"truth_{var}"
        agg_exprs += [
            pl.col(tcol).min().alias(f"{tcol}_min"),
            pl.col(tcol).max().alias(f"{tcol}_max"),
        ]
    vagg = lf.select(agg_exprs).collect()
    vrow = vagg.to_dicts()[0]
    checks["value_ranges"] = {"ok": True, "truth_statistics": {}}
    hum_lo, hum_hi = cfg["data"]["humidity_bounds"]
    for var in VARIABLES:
        tmin = vrow[f"truth_{var}_min"]
        tmax = vrow[f"truth_{var}_max"]
        checks["value_ranges"]["truth_statistics"][var] = [tmin, tmax]
        if var == "precipitation" and tmin < cfg["data"]["precip_min"] - 1e-6:
            checks["value_ranges"]["ok"] = False
            issues.append("negative precipitation found")
        if var == "wind_speed_10m" and tmin < cfg["data"]["wind_min"] - 1e-6:
            checks["value_ranges"]["ok"] = False
            issues.append("negative wind speed found")
        if var == "relative_humidity_2m":
            if tmin < hum_lo - 1e-6 or tmax > hum_hi + 1e-6:
                checks["value_ranges"]["ok"] = False
                issues.append("relative humidity outside [0,100]")

    # --- duplicates on natural key ---
    dup_key = ["loc_id", "valid_time", "lead_hours"]
    n_dup = lf.group_by(dup_key).agg(pl.len().alias("n")).filter(pl.col("n") > 1).collect().height
    checks["duplicates"] = {"ok": n_dup == 0, "duplicate_groups": n_dup}
    if n_dup:
        issues.append(f"{n_dup} duplicate (loc,valid,lead) groups")

    # --- missingness summary (nulls on forecasts/truths) ---
    nullsum = {}
    fc_cols = []
    for var in VARIABLES:
        fc_cols += [f"fc_{var}_{m}" for m in VAR_MODELS]
        fc_cols.append(f"truth_{var}")
    nullagg = lf.select([pl.col(c).is_null().mean().alias(c) for c in fc_cols]).collect()
    nr = nullagg.to_dicts()[0]
    nullsum = {c: float(nr[c]) for c in fc_cols}
    worst = max(nullsum.values())
    checks["missingness"] = {"ok": worst < 0.5, "null_fraction_by_column": nullsum}
    if worst >= 0.5:
        issues.append(f"column missing > 50%: {worst:.2f}")

    report["checks"] = checks
    report["warnings"] = [
        "chunk_misses > 0 may indicate partial API chunks; counted not dropped."
    ]
    if issues:
        report["status"] = "FAIL"
        report["issues"] = issues
    else:
        report["issues"] = []
    return report


def write_inventory(report: dict[str, Any]) -> tuple[Path, Path]:
    """Write data_inventory.json + data_inventory.md, plus source manifest merge."""
    reports_dir = ML_ROOT / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)

    json_path = reports_dir / "data_inventory.json"
    json_path.write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")

    md: list[str] = ["# VARUNA Baseline Data Inventory",
                     "", f"- Generated: {report['ran_at']}",
                     f"- Status: **{report['status']}**",
                     f"- Raw files: {report['raw_files']}",
                     f"- Total rows: {report['row_count']:,}",
                     ""]
    desc = report.get("column_descriptions", {})

    # update source manifest with inventory extras
    manifest_path = ML_ROOT / "data" / "source_manifest.json"
    if manifest_path.exists():
        m = json.loads(manifest_path.read_text(encoding="utf-8"))
    else:
        m = {"hf_repo": "Arko007/weathergpt-d1-mos-dataset",
             "dataset_url": "https://huggingface.co/datasets/Arko007/weathergpt-d1-mos-dataset",
             "local_path": str(raw_data_dir())}
    m["is_synthetic"] = False
    m["row_count"] = report["row_count"]
    m["column_count"] = len(desc)
    t = report.get("checks", {}).get("temporal", {})
    m["time_range"] = {"min": t.get("vmin"), "max": t.get("vmax")}
    s = report.get("checks", {}).get("spatial", {})
    m["spatial_range"] = {
        "lat": s.get("lat_range"), "lon": s.get("lon_range"),
        "elevation_m": s.get("elevation_m_range"),
        "n_locations": s.get("n_locations"),
        "admin1_regions": s.get("admin1_values"),
    }
    m["variables"] = VARIABLES
    m["forecast_models"] = VAR_MODELS
    m["max_lead_hours"] = t.get("lh_max")
    m["min_lead_hours"] = t.get("lh_min")
    m["source_description"] = (
        "Real NWP model forecasts (GFS, ECMWF IFS, ICON, GEM) vs ERA5-Land "
        "truth for 127 Indian locations, 1 row per (location, valid time, lead). "
        "Source: Open-Meteo historical-forecast API, not synthetic."
    )
    manifest_path.write_text(json.dumps(m, indent=2, default=str), encoding="utf-8")

    md += ["## Source", "", m["source_description"], "",
           "| field | value |", "|---|---|"]
    for k in ["hf_repo", "dataset_url", "row_count", "column_count", "is_synthetic"]:
        md += [f"| {k} | {m[k]} |"]
    time_range = m.get("time_range", {})
    md += [f"| time min | {time_range.get('min')} |",
           f"| time max | {time_range.get('max')} |"]
    for k, v in m.get("spatial_range", {}).items():
        md += [f"| spatial.{k} | {v} |"]
    md += [""]
    for name, (dtype, nulls) in desc.items():
        md += [f"- `{name}` `{dtype}` nulls={nulls:,}"]
    md_path = reports_dir / "data_inventory.md"
    md_path.write_text("\n".join(md), encoding="utf-8")
    return json_path, md_path


validate_corpus = validate_dataset

if __name__ == "__main__":
    report = validate_dataset()
    pj, pm = write_inventory(report)
    print(json.dumps(report, indent=2, default=str))
    print(f"\nWrote {pj}\nWrote {pm}")