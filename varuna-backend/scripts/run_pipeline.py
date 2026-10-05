import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import argparse
from app.config import VARIABLE_KEYS
from app.science.run_pipeline import run_pipeline

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="VARUNA Scientific Training and Validation Pipeline")
    parser.add_argument(
        "--variables",
        type=str,
        default="temperature",
        help="Comma-separated variables to train/evaluate (e.g. 'temperature,rainfall,wind_speed,pressure' or 'all')",
    )
    args = parser.parse_args()
    if args.variables.strip().lower() == "all":
        selected_vars = list(VARIABLE_KEYS)
    else:
        selected_vars = [v.strip() for v in args.variables.split(",") if v.strip()]

    run_pipeline(variables=selected_vars)
