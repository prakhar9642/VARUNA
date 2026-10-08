"""Smoke-run the feature matrix build on a small location subset."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import polars as pl

from src.features.build import build_feature_matrix, model_feature_columns

m = build_feature_matrix({"smoke_fraction": 0.02})
print("rows", m.height, "cols", m.width)
print(m.group_by("group").agg(pl.len()).sort("group"))
print("feature count:", len(model_feature_columns()))
print("any nulls in features:",
      int(m.select(pl.exclude(["valid_time", "init_time", "loc_id"]))
          .null_count().sum_horizontal().sum()))