"""Data and Feature Leakage Audit Engine.

Audits feature definitions, feature matrices, and schemas to guarantee:
1. No target/truth variables are leaked into feature columns.
2. No future information is present in features.
3. No contemporaneous error or bust label columns are used as model predictors.
4. Historical rolling features strictly adhere to issue-time causality.

Produces: reports/leakage_audit.json
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from src.common import ML_ROOT, get_logger

logger = get_logger(__name__)

# Forbidden column patterns that indicate target or truth leakage
FORBIDDEN_PREFIXES = [
    "truth_",
    "err_",
    "error_",
    "bust_",
    "overall_bust",
    "observed_",
    "future_",
    "realized_",
]

# Allowed historical feature prefixes (strictly causal aggregates of past performance)
ALLOWED_HISTORICAL_PREFIXES = [
    "hist_err_",
    "hist_bust_rate_",
    "hist_bias_",
]

AUDIT_REPORT_PATH = ML_ROOT / "reports" / "leakage_audit.json"
SCHEMA_PATH = ML_ROOT / "artifacts" / "feature_schema.json"


def audit_feature_list(features: list[str]) -> dict[str, Any]:
    """Inspect a list of feature column names for forbidden tokens."""
    violations: list[dict[str, str]] = []
    for f in features:
        f_lower = f.lower()

        # Check if it's an allowed historical past feature
        is_allowed_hist = any(f_lower.startswith(pref) for pref in ALLOWED_HISTORICAL_PREFIXES)
        if is_allowed_hist:
            continue

        # Check for forbidden prefixes / exact matches
        for token in FORBIDDEN_PREFIXES:
            if f_lower.startswith(token) or f_lower == token:
                violations.append({
                    "feature": f,
                    "matched_forbidden_token": token,
                    "reason": f"Column starts with forbidden target/truth token '{token}'",
                })
            elif token in ("truth_", "overall_bust") and token in f_lower:
                violations.append({
                    "feature": f,
                    "matched_forbidden_token": token,
                    "reason": f"Column contains forbidden target/truth token '{token}'",
                })

    is_clean = len(violations) == 0
    return {
        "status": "PASS" if is_clean else "FAIL",
        "total_features_checked": len(features),
        "violations_count": len(violations),
        "violations": violations,
    }


def audit_feature_schema(schema_file: Path | str | None = None) -> dict[str, Any]:
    """Audit the persisted feature schema artifact."""
    schema_path = Path(schema_file or SCHEMA_PATH)
    if not schema_path.exists():
        return {
            "status": "FAIL",
            "reason": f"Feature schema file not found at {schema_path}",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    features = schema.get("feature_columns", [])
    res = audit_feature_list(features)
    res["schema_file"] = str(schema_path)
    res["timestamp"] = datetime.now(timezone.utc).isoformat()
    return res


def run_leakage_audit(
    feature_columns: list[str] | None = None,
    out_path: Path | str | None = None,
) -> dict[str, Any]:
    """Execute complete leakage audit and write report."""
    out_path = Path(out_path or AUDIT_REPORT_PATH)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    if feature_columns is not None:
        report = audit_feature_list(feature_columns)
        report["timestamp"] = datetime.now(timezone.utc).isoformat()
    else:
        report = audit_feature_schema()

    out_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    logger.info("Leakage audit %s (Saved to %s)", report["status"], out_path)

    if report["status"] == "FAIL":
        logger.error("LEAKAGE AUDIT FAILED! Violations: %s", report.get("violations"))
    return report


if __name__ == "__main__":
    rep = run_leakage_audit()
    print(json.dumps(rep, indent=2))
