"""Common utilities: path resolution, config loading, logging, constants."""

from __future__ import annotations

import logging
import sys
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

ML_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = Path(__file__).resolve().parents[0]
CONFIGS_DIR = ML_ROOT / "configs"

VAR_MODELS = ["gfs_seamless", "ecmwf_ifs025", "icon_seamless", "gem_seamless"]

VARIABLES = [
    "temperature_2m",
    "precipitation",
    "wind_speed_10m",
    "relative_humidity_2m",
]

# Short label for each variable (used in generated feature/target names).
VARIABLE_LABELS = {
    "temperature_2m": "temp",
    "precipitation": "precip",
    "wind_speed_10m": "wind",
    "relative_humidity_2m": "humidity",
}

MODEL_LABELS = {
    "gfs_seamless": "gfs",
    "ecmwf_ifs025": "ecmwf",
    "icon_seamless": "icon",
    "gem_seamless": "gem",
}

DIRECTORIES = [
    "artifacts",
    "reports",
    "plots",
    "models",
    "data/interim",
    "data/processed",
]


def setup_logging(level: int = logging.INFO) -> logging.Logger:
    """Configure logging once and return the ml logger."""
    logger = logging.getLogger("varuna_baseline")
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(
            logging.Formatter("%(asctime)s | %(levelname)-7s | %(name)s | %(message)s")
        )
        logger.addHandler(handler)
    logger.setLevel(level)
    return logger


def get_logger(name: str | None = None) -> logging.Logger:
    logger = logging.getLogger(name or "varuna_baseline")
    if not logger.handlers:
        setup_logging()
    return logger


def ensure_dirs() -> None:
    for d in DIRECTORIES:
        (ML_ROOT / d).mkdir(parents=True, exist_ok=True)


def load_yaml(name: str) -> dict[str, Any]:
    """Load a config file from the ml/configs directory."""
    path = CONFIGS_DIR / name
    if not path.exists():
        raise FileNotFoundError(f"Config not found: {path}")
    with open(path, "r", encoding="utf-8") as fh:
        return yaml.safe_load(fh) or {}


@lru_cache(maxsize=8)
def get_config(name: str) -> dict[str, Any]:
    """Cached config loader."""
    return load_yaml(name)


def path_for(kind: str, *parts: str) -> Path:
    """Resolve a path inside the ml/ directory tree."""
    ensure_dirs()
    return ML_ROOT.joinpath(kind, *parts)


def secs_to_hours(x: int) -> float:
    return x / 3600.0