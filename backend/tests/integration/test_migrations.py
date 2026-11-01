import asyncio
import json
import os
from decimal import Decimal
from pathlib import Path
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import inspect, text
from sqlalchemy.engine import make_url

from app.core.config import Settings
from app.core.database import Database
from app.modules.company.collection_columns import SCHEMAS

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
        await asyncio.to_thread(command.upgrade, config, "c2658f900076")
        # Start with populated legacy JSONB tables, including multiple source versions.
        financial = dict.fromkeys(SCHEMAS["financial"][1])
        financial.update(
            corp_code="00164478",
            corp_name="typed migration",
            bsns_year="2025",
            fs_div="CFS",
            rcept_no="20260318001395",
            bs_ta="9007199254740993.123456789",
            bs_cash="0",
            nt_rate_wavg="3.123456789",
            is_dep=None,
        )
        event = dict.fromkeys(SCHEMAS["events"][1])
        event.update(
            id="1",
            corp_code="00164478",
            rcept_no="20260318001395",
            event_date="2026-03-18",
            rcept_dt="2026-03-19",
            verified=None,
            is_first_of_type=False,
            detail="first line\nsecond, line",
        )
        coverage = dict.fromkeys(SCHEMAS["coverage"][1])
        coverage.update(
            corp_code="00164478",
            audit_doc_ok=0,
            audit_doc_reports=1,
            first_event_date="2026-03-18",
            major_fetched_at="2026-10-26T12:34:56",
        )
        snapshots = []
        async with database.engine.begin() as db:
            await db.execute(
                text(
                    "INSERT INTO company (corp_code,corp_name,modify_date,ksic11_status,"
                    "search_name,search_eng_name,active) VALUES "
                    "('00164478','typed migration','20261030','unmatched','typed','',true)"
                )
            )
            for version in range(2):
                import_id = uuid4()
                snapshots.append(import_id)
                await db.execute(
                    text(
                        "INSERT INTO company_dataset_import "
                        "(id,signature,parser_version,exported_on,source_as_of,manifest) VALUES "
                        "(:id,:signature,'company-export-v1','2026-10-30','2026-10-26','{}')"
                    ),
                    {"id": import_id, "signature": str(version) * 64},
                )
                for table, row, metadata in (
                    (
                        "collected_financial",
                        financial,
                        "fiscal_year,scope,receipt_no|2025,'CFS','20260318001395'",
                    ),
                    (
                        "collected_risk_event",
                        event,
                        "source_id,receipt_no,event_date,verified|"
                        "1,'20260318001395','2026-03-18',NULL",
                    ),
                    ("collected_event_coverage", coverage, "|"),
                ):
                    columns, values = metadata.split("|")
                    await db.execute(
                        text(
                            f"INSERT INTO {table} (import_id,corp_code,data"
                            + (f",{columns}" if columns else "")
                            + ") VALUES (:id,'00164478',CAST(:data AS jsonb)"
                            + (f",{values}" if values else "")
                            + ")"
                        ),
                        {"id": import_id, "data": json.dumps(row)},
                    )
        await asyncio.to_thread(command.upgrade, config, "head")
        await asyncio.to_thread(command.check, config)
        async with database.engine.connect() as db:
            for table in (
                "collected_financial",
                "collected_risk_event",
                "collected_event_coverage",
            ):
                columns = await db.run_sync(
                    lambda connection, table=table: inspect(connection).get_columns(table)
                )
                assert "data" not in {column["name"] for column in columns}
                assert await db.scalar(text(f"SELECT count(*) FROM {table}")) == 2
            amounts = (
                await db.execute(
                    text("SELECT bs_ta,bs_cash,is_dep,nt_rate_wavg FROM collected_financial")
                )
            ).all()
            assert (
                amounts
                == [
                    (
                        Decimal("9007199254740993.123456789"),
                        Decimal(0),
                        None,
                        Decimal("3.123456789"),
                    )
                ]
                * 2
            )
            names = await db.run_sync(lambda connection: inspect(connection).get_table_names())
            assert {"app_user", "workspace", "analysis_job", "outbox_message", "task_event"} <= set(
                names
            )
        from app.modules.company.exported import read_company_collection

        for import_id in snapshots:
            result = await read_company_collection(
                database, import_id, "00164478", "20260318001395", "CFS"
            )
            assert result["financial"] == [financial]
            assert result["event_candidates"] == [event]
            assert result["coverage"] == coverage
        await asyncio.to_thread(command.downgrade, config, "c2658f900076")
        async with database.engine.connect() as db:
            for table, expected in (
                ("collected_financial", financial),
                ("collected_risk_event", event),
                ("collected_event_coverage", coverage),
            ):
                rows = (await db.execute(text(f"SELECT data FROM {table}"))).scalars().all()
                assert rows == [expected, expected]
        await asyncio.to_thread(command.downgrade, config, "base")
        async with database.engine.connect() as db:
            names = await db.run_sync(lambda connection: inspect(connection).get_table_names())
            assert names == ["alembic_version"]
    finally:
        await database.close()
        async with admin.engine.begin() as db:
            await db.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        await admin.close()
