from __future__ import annotations

from fastapi import APIRouter, Query

from ..services import blend_service as svc

router = APIRouter()


@router.get("/api/skill")
def skill(variable: str = Query("temperature")):
    return svc.skill_payload(variable=variable)
