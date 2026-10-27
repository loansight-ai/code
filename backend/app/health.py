import asyncio
from typing import Literal

import structlog
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

router = APIRouter(prefix="/api/v1/health", tags=["health"])
logger = structlog.get_logger()


class HealthStatus(BaseModel):
    status: Literal["ok", "unavailable"]


@router.get("/live", response_model=HealthStatus)
async def live() -> HealthStatus:
    return HealthStatus(status="ok")


@router.get("/ready", response_model=HealthStatus, responses={503: {"model": HealthStatus}})
async def ready(request: Request) -> HealthStatus | JSONResponse:
    try:
        async with asyncio.timeout(request.app.state.settings.database_timeout_seconds):
            async with request.app.state.database.engine.connect() as connection:
                await connection.execute(text("SELECT 1"))
    except (SQLAlchemyError, TimeoutError):
        # Do not log exception text: driver errors may contain connection credentials.
        logger.warning("database_readiness_failed")
        return JSONResponse(status_code=503, content={"status": "unavailable"})
    return HealthStatus(status="ok")
