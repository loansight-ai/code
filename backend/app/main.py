from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI

from app.core.config import Settings
from app.core.database import Database
from app.health import router as health_router


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
        try:
            yield
        finally:
            await app.state.database.close()

    app = FastAPI(title="LoanSight AI API", version="0.1.0", lifespan=lifespan)
    app.include_router(health_router)
    return app


app = create_app()
