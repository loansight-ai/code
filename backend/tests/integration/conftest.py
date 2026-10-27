import os
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.engine import make_url

from app.core.config import Settings
from app.core.database import Base, Database
from app.main import create_app


@pytest.fixture
async def environment(tmp_path):
    url = os.environ.get("LOANSIGHT_TEST_DATABASE_URL")
    if not url:
        pytest.skip("Set LOANSIGHT_TEST_DATABASE_URL to run PostgreSQL integration tests")
    parsed = make_url(url)
    if not parsed.database or not parsed.database.endswith("_test"):
        pytest.fail("Integration tests require a database name ending in _test")
    schema = "test_" + uuid4().hex
    admin = Database(Settings(_env_file=None, database_url=url))
    async with admin.engine.begin() as connection:
        await connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    scoped_url = parsed.update_query_dict({"options": f"-csearch_path={schema}"})
    settings = Settings(
        _env_file=None,
        database_url=scoped_url.render_as_string(hide_password=False),
        artifact_root=tmp_path / "artifacts",
        session_ttl_seconds=300,
        entry_window_seconds=60,
        entry_ip_limit=1000,
        entry_code_limit=1000,
        entry_global_limit=10000,
        allowed_origins=["http://test"],
        cookie_secure=False,
        task_events_enabled=True,
        sse_heartbeat_seconds=0.05,
        job_max_attempts=3,
        job_lease_seconds=3,
        retry_delay_seconds=1,
        queue_name="loansight.test." + uuid4().hex,
        rabbitmq_url=os.environ.get("LOANSIGHT_TEST_RABBITMQ_URL"),
    )
    app = create_app(settings)
    try:
        async with app.router.lifespan_context(app):
            async with app.state.database.engine.begin() as connection:
                await connection.run_sync(Base.metadata.create_all)
            yield app, settings, app.state.database
    finally:
        # The generated identifier is confined to this explicitly selected test database.
        async with admin.engine.begin() as connection:
            await connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        await admin.close()


@pytest.fixture
async def client(environment):
    app, _, _ = environment
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test", headers={"Origin": "http://test"}
    ) as client:
        yield client
