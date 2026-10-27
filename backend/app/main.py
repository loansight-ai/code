from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError

from app.core.config import Settings
from app.core.database import Database
from app.health import router as health_router
from app.messaging.notifications import NotificationHub
from app.modules.evidence.router import router as evidence_router
from app.modules.identity.router import router as identity_router
from app.modules.tasks.router import router as tasks_router


def create_app(settings: Settings | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        structlog.configure(
            processors=[
                structlog.processors.TimeStamper(fmt="iso", utc=True),
                structlog.processors.JSONRenderer(),
            ]
        )
        config = settings if settings is not None else Settings()
        app.state.settings = config
        app.state.database = Database(config)
        app.state.notifications = NotificationHub(config)
        if config.task_events_enabled:
            app.state.notifications.start()
        try:
            yield
        finally:
            await app.state.notifications.close()
            await app.state.database.close()

    app = FastAPI(title="LoanSight AI API", version="0.1.0", lifespan=lifespan)
    app.include_router(health_router)
    app.include_router(identity_router)
    app.include_router(tasks_router)
    app.include_router(evidence_router)

    @app.exception_handler(SQLAlchemyError)
    async def database_error(request, exc):
        structlog.get_logger().warning("database_request_failed")
        return JSONResponse(status_code=503, content={"detail": "database_unavailable"})

    return app


app = create_app()
