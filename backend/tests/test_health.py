import asyncio
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, Mock

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.exc import OperationalError

from app.core.config import Settings
from app.main import create_app


@pytest.fixture
async def app():
    settings = Settings(
        _env_file=None,
        database_url="postgresql+psycopg://test:private-password@localhost/test",
        database_timeout_seconds=0.01,
    )
    application = create_app(settings)
    async with application.router.lifespan_context(application):
        yield application


@pytest.fixture
async def client(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client


async def test_liveness_does_not_connect_to_database(app, client, monkeypatch):
    engine = Mock()
    engine.connect.side_effect = AssertionError("liveness must not depend on PostgreSQL")
    monkeypatch.setattr(app.state.database, "engine", engine)
    response = await client.get("/api/v1/health/live")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


async def test_readiness_checks_database(app, client, monkeypatch):
    execute = AsyncMock()

    @asynccontextmanager
    async def connect():
        connection = AsyncMock()
        connection.execute = execute
        yield connection

    monkeypatch.setattr(app.state.database, "engine", Mock(connect=connect))
    response = await client.get("/api/v1/health/ready")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert str(execute.await_args.args[0]) == "SELECT 1"


async def test_database_failure_returns_503_without_credentials(app, client, monkeypatch, capsys):
    @asynccontextmanager
    async def connect():
        raise OperationalError("private-password", {}, Exception("private-password"))
        yield  # pragma: no cover

    monkeypatch.setattr(app.state.database, "engine", Mock(connect=connect))
    response = await client.get("/api/v1/health/ready")
    assert response.status_code == 503
    assert response.json() == {"status": "unavailable"}
    output = capsys.readouterr()
    assert "private-password" not in response.text + output.out + output.err


async def test_readiness_timeout_returns_503(app, client, monkeypatch):
    @asynccontextmanager
    async def connect():
        await asyncio.sleep(1)
        yield AsyncMock()

    monkeypatch.setattr(app.state.database, "engine", Mock(connect=connect))
    response = await client.get("/api/v1/health/ready")
    assert response.status_code == 503


async def test_database_is_disposed_on_shutdown(monkeypatch):
    close = AsyncMock()
    monkeypatch.setattr("app.main.Database.close", close)
    settings = Settings(
        _env_file=None, database_url="postgresql+psycopg://test:example@localhost/test"
    )
    app = create_app(settings)
    async with app.router.lifespan_context(app):
        close.assert_not_awaited()
    close.assert_awaited_once()
