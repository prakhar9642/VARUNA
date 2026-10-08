"""Programmatic download of the VARUNA baseline primary dataset.

Uses huggingface_hub.snapshot_download to fetch the publicly available
WeatherGPT D1 multi-model NWP vs. ERA5-Land archive for India.

The download is idempotent: it skips already-present files.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path

from huggingface_hub import snapshot_download

REPO_ID = "Arko007/weathergpt-d1-mos-dataset"
SUBFOLDER = "d1_mos"

DEFAULT_RAW_DIR = Path(__file__).resolve().parents[2] / "data" / "raw" / "weather"


def download_dataset(
    raw_dir: Path | str | None = None,
    repo_id: str = REPO_ID,
    subfolder: str = SUBFOLDER,
    force_download: bool = False,
) -> dict:
    """Download (or reuse) the VARUNA baseline primary dataset.

    Parameters
    ----------
    raw_dir:
        Local directory where the parquet files are stored.
    repo_id:
        Hugging Face dataset repository id.
    subfolder:
        Folder inside the repo containing the data files.
    force_download:
        Re-download files even if they already exist.

    Returns
    -------
    dict
        Manifest information about the downloaded data.
    """
    raw_dir = Path(raw_dir) if raw_dir is not None else DEFAULT_RAW_DIR
    raw_dir.mkdir(parents=True, exist_ok=True)

    snapshot_download(
        repo_id=repo_id,
        repo_type="dataset",
        allow_patterns=[f"{subfolder}/*.parquet", "README.md"],
        local_dir=str(raw_dir),
        force_download=force_download,
    )

    files = sorted((raw_dir / subfolder).glob("*.parquet"))
    total_size = sum(f.stat().st_size for f in files)

    manifest = {
        "dataset_url": f"https://huggingface.co/datasets/{repo_id}",
        "hf_repo": repo_id,
        "download_date": datetime.now(timezone.utc).isoformat(),
        "local_path": str(raw_dir),
        "file_count": len(files),
        "total_size_bytes": total_size,
        "files": [str(f.relative_to(raw_dir)) for f in files],
    }
    return manifest


def write_manifest(manifest: dict, out_path: Path | str | None = None) -> Path:
    """Persist the download manifest to a JSON file."""
    out_path = Path(out_path) if out_path is not None else (
        Path(manifest["local_path"]).parents[1] / "source_manifest.json"
    )
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return out_path


if __name__ == "__main__":
    m = download_dataset()
    p = write_manifest(m)
    print(json.dumps(m, indent=2))
    print(f"Manifest written to {p}")