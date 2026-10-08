"""ECMWF TIGGE (Global Medium-Range Ensemble Forecasts) Adapter for Days 8-10.

TIGGE contains multi-centre medium-range ensemble forecasts (ECMWF, NCEP, CMA, JMA, UKMO)
extending up to 10-15 days.

This adapter provides:
1. Retrieval schema definition for India spatial bounding box [8°N-38°N, 68°E-98°E].
2. Lead time mapping extending Day 1 to Day 10 (0h to 240h).
3. Data assimilation & alignment schema to match VARUNA baseline's core feature structure.
4. Credential / Access blocker diagnostics and graceful offline handling.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from src.common import ML_ROOT, get_logger

logger = get_logger(__name__)

INDIA_BBOX = {
    "north": 38.0,
    "south": 8.0,
    "west": 68.0,
    "east": 98.0,
}

TIGGE_VARIABLES = {
    "167.128": "temperature_2m",      # 2 metre temperature (K)
    "228.128": "precipitation",       # Total precipitation (m)
    "165.128": "10u",                 # 10 metre U wind component
    "166.128": "10v",                 # 10 metre V wind component
    "168.128": "2d",                  # 2 metre dewpoint temperature
}


@dataclass
class TiggeConfig:
    origin: list[str] = ("ecmf", "kwbc", "cma", "rjtd")  # ECMWF, NCEP, CMA, JMA
    lead_steps_hours: list[int] = tuple(range(0, 241, 6))  # 0 to 240 hours (Day 10)
    target_area: dict[str, float] = tuple(INDIA_BBOX.items())
    grid_resolution: float = 0.5  # 0.5 deg grid


class TiggeAdapter:
    """Interface to ECMWF MARS / TIGGE API."""

    def __init__(self, ecmwf_api_key_path: Path | str | None = None):
        self.api_key_path = Path(ecmwf_api_key_path or Path.home() / ".ecmwfapirc")
        self.config = TiggeConfig()

    def check_access(self) -> dict[str, Any]:
        """Verify whether ECMWF MARS / TIGGE credentials are configured."""
        has_key = self.api_key_path.exists()
        return {
            "service": "ECMWF TIGGE (The THORPEX Interactive Grand Global Ensemble)",
            "url": "https://www.ecmwf.int/en/forecasts/datasets/tigge-global-medium-range-ensemble-forecasts-multiple-nwp-centres-2006",
            "credentials_file": str(self.api_key_path),
            "credentials_present": has_key,
            "status": "AVAILABLE" if has_key else "BLOCKED_CREDENTIALS_REQUIRED",
            "reason": (
                "ECMWF MARS API key (.ecmwfapirc) not found in system. "
                "Registration at ECMWF Data Services is required to fetch real-time "
                "or historical Day 8-10 TIGGE raw GRIB fields."
                if not has_key
                else "ECMWF API credentials found."
            ),
            "fallback_policy": (
                "Core Day 1-7 training system operates on verified WeatherGPT D1 (Open-Meteo NWP + ERA5-Land). "
                "Day 8-10 predictions return 'data_unavailable_for_training' until TIGGE archive is ingested. "
                "No fake or interpolated data will be generated."
            ),
        }

    def get_day8_10_schema(self) -> dict[str, Any]:
        """Return standardized schema for Day 8-10 forecasts once ingested."""
        return {
            "lead_hours_range": [168, 240],
            "lead_days": [8, 9, 10],
            "day_mapping": {
                "Day 8": [168, 191],
                "Day 9": [192, 215],
                "Day 10": [216, 240],
            },
            "required_fields": [
                "loc_id",
                "lat",
                "lon",
                "valid_time",
                "init_time",
                "lead_hours",
                "lead_day",
                "fc_temperature_2m_ensemble_mean",
                "fc_temperature_2m_ensemble_std",
                "fc_precipitation_ensemble_mean",
                "fc_precipitation_ensemble_std",
                "fc_wind_speed_10m_ensemble_mean",
                "fc_wind_speed_10m_ensemble_std",
                "fc_relative_humidity_2m_ensemble_mean",
                "fc_relative_humidity_2m_ensemble_std",
            ],
        }

    def export_status_report(self, out_path: Path | str | None = None) -> Path:
        """Save TIGGE connection status report."""
        out_path = Path(out_path or ML_ROOT / "reports" / "tigge_adapter_status.json")
        out_path.parent.mkdir(parents=True, exist_ok=True)
        status = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "access": self.check_access(),
            "schema_extension": self.get_day8_10_schema(),
        }
        out_path.write_text(json.dumps(status, indent=2), encoding="utf-8")
        logger.info("TIGGE status written to %s", out_path)
        return out_path


if __name__ == "__main__":
    adapter = TiggeAdapter()
    report = adapter.check_access()
    print(json.dumps(report, indent=2))
    p = adapter.export_status_report()
    print(f"Report saved to {p}")
