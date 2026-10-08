"""Tests for data validation and geographical integrity."""

import pytest
from src.data.load import describe_columns, raw_glob, scan_all
from src.data.validate import validate_corpus

HAS_RAW_SHARDS = bool(raw_glob("d1_mos/*.parquet"))


@pytest.mark.skipif(not HAS_RAW_SHARDS, reason="Raw dataset shards (d1_mos/*.parquet) not present on disk")
def test_dataset_shards_exist():
    lf = scan_all()
    n = lf.select("loc_id").unique().collect().height
    assert n == 127, f"Expected 127 location shards, found {n}"


@pytest.mark.skipif(not HAS_RAW_SHARDS, reason="Raw dataset shards (d1_mos/*.parquet) not present on disk")
def test_validation_passes():
    report = validate_corpus()
    assert report["status"] == "PASS", f"Data validation failed: {report}"
    assert report["row_count"] == 9582912
    assert report["raw_files"] == 127
    assert len(report.get("issues", [])) == 0
