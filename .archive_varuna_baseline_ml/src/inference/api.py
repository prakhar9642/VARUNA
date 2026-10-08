"""FastAPI ML Inference Service for VARUNA.

Provides production REST API endpoints for:
- Health and model readiness checks
- Single-point forecast reliability prediction with SHAP explainability
- Batch regional grid inference for interactive map rendering
- Historical case studies retrieval
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from src.common import ML_ROOT, get_logger
from src.inference.predictor import VarunaBaselinePredictor, get_predictor

logger = get_logger(__name__)

app = FastAPI(
    title="VARUNA ML Forecast Bust Intelligence API",
    description="AI-Based Forecast Reliability and Bust Detection Subsystem for Medium-Range Weather Forecasts (SIH26081)",
    version="1.0.0",
)

# Enable CORS for frontend web integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Pydantic Schemas
class SinglePredictionRequest(BaseModel):
    loc_id: str = Field(..., description="Location identifier, e.g. LOC_1253405")
    lead_day: int = Field(default=1, ge=1, le=10, description="Forecast lead day (1 to 10)")
    lead_hours: int = Field(default=24, ge=0, le=240, description="Lead hours (0 to 240)")
    forecast_features: dict[str, float] = Field(..., description="Dictionary of computed meteorological/NWP features")


class GridPointForecast(BaseModel):
    loc_id: str
    lat: float
    lon: float
    admin1: str = "Unknown"
    lead_day: int = 1
    forecast_features: dict[str, float]


class GridBatchRequest(BaseModel):
    lead_day: int = Field(default=1, ge=1, le=10)
    points: list[GridPointForecast] = Field(..., description="List of location forecast records")


class PredictionResponse(BaseModel):
    project: str = "VARUNA"
    loc_id: str
    lead_day: int
    lead_hours: int
    bust_probability: float
    confidence: float
    risk_category: str
    status: str
    reasons: list[str]
    stabilizers: list[str]
    variable_bust_probabilities: dict[str, float] = {}
    historical_analogs: dict[str, Any] = {}


class GridPointResponse(BaseModel):
    loc_id: str
    lat: float
    lon: float
    admin1: str
    lead_day: int
    bust_probability: float
    confidence: float
    risk_category: str


class GridBatchResponse(BaseModel):
    project: str = "VARUNA"
    lead_day: int
    total_points: int
    high_risk_count: int
    top_risk_locations: list[GridPointResponse]
    grid_predictions: list[GridPointResponse]


@app.get("/health")
def health_check():
    """Health check and model service status."""
    try:
        predictor = get_predictor()
        ready = predictor.primary_model is not None and predictor.calibrator is not None
    except Exception as e:
        ready = False

    return {
        "status": "HEALTHY" if ready else "DEGRADED",
        "service": "varuna-baseline-inference-api",
        "models_ready": ready,
    }


@app.get("/model-info")
def model_info():
    """Return model architecture, training metadata, and feature schema."""
    metadata_path = ML_ROOT / "models" / "model_metadata.json"
    if not metadata_path.exists():
        raise HTTPException(status_code=404, detail="Model metadata not found. Run training pipeline first.")
    return json.loads(metadata_path.read_text(encoding="utf-8"))


@app.post("/predict", response_model=PredictionResponse)
def predict(request: SinglePredictionRequest):
    """Single location forecast reliability assessment."""
    try:
        predictor = get_predictor()
        res = predictor.predict_from_features(
            features_dict=request.forecast_features,
            loc_id=request.loc_id,
            lead_day=request.lead_day,
            lead_hours=request.lead_hours,
        )
        return res
    except Exception as e:
        logger.exception("Error during single prediction")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/predict/grid", response_model=GridBatchResponse)
def predict_grid(request: GridBatchRequest):
    """Batch prediction across geographic points for map rendering."""
    try:
        predictor = get_predictor()
        results: list[GridPointResponse] = []
        high_risk = 0

        for pt in request.points:
            res = predictor.predict_from_features(
                features_dict=pt.forecast_features,
                loc_id=pt.loc_id,
                lead_day=request.lead_day,
            )
            p_bust = res.get("bust_probability", 0.0)
            conf = res.get("confidence", 100.0)
            risk = res.get("risk_category", "HIGH_CONFIDENCE")
            if p_bust >= 0.5:
                high_risk += 1

            results.append(GridPointResponse(
                loc_id=pt.loc_id,
                lat=pt.lat,
                lon=pt.lon,
                admin1=pt.admin1,
                lead_day=request.lead_day,
                bust_probability=p_bust,
                confidence=conf,
                risk_category=risk,
            ))

        # Rank top risk locations
        top_risk = sorted(results, key=lambda x: x.bust_probability, reverse=True)[:20]

        return GridBatchResponse(
            lead_day=request.lead_day,
            total_points=len(results),
            high_risk_count=high_risk,
            top_risk_locations=top_risk,
            grid_predictions=results,
        )
    except Exception as e:
        logger.exception("Error during grid batch prediction")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/case-study/{case_id}")
def get_case_study(case_id: str):
    """Retrieve pre-computed meteorological case study by ID."""
    cases_path = ML_ROOT / "reports" / "case_studies.json"
    if not cases_path.exists():
        raise HTTPException(status_code=404, detail="Case studies report not generated.")

    cases = json.loads(cases_path.read_text(encoding="utf-8"))
    for key, c_val in cases.items():
        if c_val.get("case_id") == case_id or key == case_id:
            return c_val
    raise HTTPException(status_code=404, detail=f"Case study '{case_id}' not found.")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
