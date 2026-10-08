"""VARUNA Baseline ML Pipeline — Command-Line Entry Point.

Provides a convenient top-level CLI for executing the full training pipeline,
running the offline demo, or starting the FastAPI inference service.

Usage:
    python scripts/run_pipeline.py --mode train
    python scripts/run_pipeline.py --mode train --smoke
    python scripts/run_pipeline.py --mode demo
    python scripts/run_pipeline.py --mode api --port 8000
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Ensure ml/ root is on path when run from any working directory
_ML_ROOT = Path(__file__).resolve().parent.parent
if str(_ML_ROOT) not in sys.path:
    sys.path.insert(0, str(_ML_ROOT))


def main() -> None:
    parser = argparse.ArgumentParser(
        description="VARUNA Baseline ML Subsystem CLI",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Modes:
  train     Run the full end-to-end ML pipeline (data → features → train → evaluate → explain).
  demo      Run the offline standalone prediction demo using stored model artifacts.
  api       Start the FastAPI production inference service.
  test      Run the automated pytest test suite and exit with pass/fail code.

Examples:
  python scripts/run_pipeline.py --mode train
  python scripts/run_pipeline.py --mode train --smoke --smoke-fraction 0.05
  python scripts/run_pipeline.py --mode demo
  python scripts/run_pipeline.py --mode api --port 8080
  python scripts/run_pipeline.py --mode test
        """,
    )
    parser.add_argument(
        "--mode",
        choices=["train", "demo", "api", "test"],
        default="train",
        help="Execution mode (default: train)",
    )
    parser.add_argument(
        "--smoke",
        action="store_true",
        help="Run in smoke/fast mode with a small data fraction (use with --mode train)",
    )
    parser.add_argument(
        "--smoke-fraction",
        type=float,
        default=0.05,
        help="Data fraction for smoke test (default: 0.05)",
    )
    parser.add_argument(
        "--force-download",
        action="store_true",
        help="Force re-download of raw dataset shards",
    )
    parser.add_argument(
        "--force-features",
        action="store_true",
        help="Force rebuild of feature matrix even if cached",
    )
    parser.add_argument(
        "--host",
        default="0.0.0.0",
        help="API host (default: 0.0.0.0, use with --mode api)",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=8000,
        help="API port (default: 8000, use with --mode api)",
    )
    args = parser.parse_args()

    if args.mode == "train":
        from src.common import setup_logging
        from src.pipeline.run_all import run_pipeline

        setup_logging()
        smoke_fraction = args.smoke_fraction if args.smoke else None

        result = run_pipeline(
            force_download=args.force_download,
            force_features=args.force_features,
            smoke_fraction=smoke_fraction,
        )

        print("\n" + "=" * 70)
        print("VARUNA BASELINE PIPELINE COMPLETE")
        print(f"Status: {result['status']}")
        print(f"Elapsed: {result['elapsed_seconds']:.1f}s")
        ev = result.get("evaluation", {})
        tt = ev.get("temporal_test", {})
        print(f"Temporal Test PR-AUC:  {tt.get('pr_auc', 0.0):.4f}")
        print(f"Temporal Test ROC-AUC: {tt.get('roc_auc', 0.0):.4f}")
        print(f"Temporal Test F1:      {tt.get('f1', 0.0):.4f}")
        print("=" * 70)

    elif args.mode == "demo":
        from src.inference.demo import run_demo
        run_demo()

    elif args.mode == "api":
        import uvicorn
        print(f"Starting VARUNA FastAPI Inference Service on {args.host}:{args.port}")
        print(f"Swagger docs: http://{args.host if args.host != '0.0.0.0' else 'localhost'}:{args.port}/docs")
        uvicorn.run(
            "src.inference.api:app",
            host=args.host,
            port=args.port,
            reload=False,
        )

    elif args.mode == "test":
        import subprocess
        result = subprocess.run(
            [sys.executable, "-m", "pytest", "tests/", "-v", "--tb=short"],
            cwd=str(_ML_ROOT),
        )
        sys.exit(result.returncode)


if __name__ == "__main__":
    main()
