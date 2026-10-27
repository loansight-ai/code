import asyncio
import os
from pathlib import Path
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import inspect, text
from sqlalchemy.engine import make_url

from app.core.config import Settings
from app.core.database import Database

ALEMBIC_CONFIG = str(Path(__file__).resolve().parents[2] / "alembic.ini")


async def test_initial_migration_upgrade_model_match_and_downgrade(monkeypatch):
    url = os.environ.get("LOANSIGHT_TEST_DATABASE_URL")
    if not url:
        pytest.skip("Set LOANSIGHT_TEST_DATABASE_URL to validate migrations")
    parsed = make_url(url)
    assert parsed.database.endswith("_test")
    schema = "test_migration_" + uuid4().hex
    admin = Database(Settings(_env_file=None, database_url=url))
    async with admin.engine.begin() as db:
        await db.execute(text(f'CREATE SCHEMA "{schema}"'))
    scoped = parsed.update_query_dict({"options": f"-csearch_path={schema}"})
    monkeypatch.setenv("LOANSIGHT_DATABASE_URL", scoped.render_as_string(hide_password=False))
    config = Config(ALEMBIC_CONFIG)
    database = Database(
        Settings(_env_file=None, database_url=scoped.render_as_string(hide_password=False))
    )
    try:
        await asyncio.to_thread(command.upgrade, config, "head")
        await asyncio.to_thread(command.check, config)
        async with database.engine.connect() as db:
            names = await db.run_sync(lambda connection: inspect(connection).get_table_names())
            assert {"app_user", "workspace", "analysis_job", "outbox_message", "task_event"} <= set(
                names
            )
        await asyncio.to_thread(command.downgrade, config, "base")
        async with database.engine.connect() as db:
            names = await db.run_sync(lambda connection: inspect(connection).get_table_names())
            assert names == ["alembic_version"]
    finally:
        await database.close()
        async with admin.engine.begin() as db:
            await db.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        await admin.close()
