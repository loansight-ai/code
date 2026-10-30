"""Opt-in PostgreSQL checks in an isolated schema of an explicitly named test DB."""

import asyncio
import os
import tempfile
import unittest
from pathlib import Path
from uuid import UUID, uuid4

from test_company_exported import load, write_dataset


@unittest.skipUnless(os.environ.get("LOANSIGHT_TEST_DATABASE_URL"), "test database not configured")
class ExportPostgresTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        from sqlalchemy import text
        from sqlalchemy.engine import make_url

        from app.core.config import Settings
        from app.core.database import Base, Database
        from app.modules.company.models import CompanyRecord

        url = make_url(os.environ["LOANSIGHT_TEST_DATABASE_URL"])
        if not url.database or not url.database.endswith("_test"):
            self.fail("test database name must end with _test")
        self.schema = "export_test_" + uuid4().hex
        # str(URL) masks passwords; render explicitly only for the connection, never logs.
        self.admin = Database(
            Settings(_env_file=None, database_url=url.render_as_string(hide_password=False))
        )
        async with self.admin.engine.begin() as connection:
            await connection.execute(text(f'CREATE SCHEMA "{self.schema}"'))
        scoped = url.update_query_dict({"options": f"-csearch_path={self.schema}"})
        self.database = Database(
            Settings(_env_file=None, database_url=scoped.render_as_string(hide_password=False))
        )
        async with self.database.engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with self.database.transaction() as session:
            session.add(
                CompanyRecord(
                    corp_code="00164478",
                    corp_name="현대건설",
                    modify_date="20261030",
                    ksic11_status="unmatched",
                    search_name="현대건설",
                    search_eng_name="",
                )
            )
        self.temp = tempfile.TemporaryDirectory()
        self.directory = Path(self.temp.name)
        write_dataset(self.directory)

    async def asyncTearDown(self):
        from sqlalchemy import text

        await self.database.close()
        async with self.admin.engine.begin() as connection:
            await connection.execute(text(f'DROP SCHEMA "{self.schema}" CASCADE'))
        await self.admin.close()
        self.temp.cleanup()

    async def test_idempotence_versions_and_exact_report_scope_lookup(self):
        from app.modules.company.exported import import_dataset, read_company_collection

        data = load(self.directory)
        first = await import_dataset(self.database, data)
        second = await import_dataset(self.database, data)
        self.assertFalse(first["reused"])
        self.assertTrue(second["reused"])
        self.assertEqual(first["import_id"], second["import_id"])
        args = (self.database, UUID(first["import_id"]), "00164478", "20260318001395")
        result = await read_company_collection(*args, "CFS")
        self.assertEqual(result["financial"][0]["bs_ta"], "9007199254740993")
        self.assertIsNone(result["event_candidates"][0]["verified"])
        self.assertEqual((await read_company_collection(*args, "OFS"))["financial"], [])
        write_dataset(self.directory, amount="42")
        changed = await import_dataset(self.database, load(self.directory))
        self.assertNotEqual(changed["import_id"], first["import_id"])
        old = await read_company_collection(*args, "CFS")
        self.assertEqual(old["financial"][0]["bs_ta"], "9007199254740993")

    async def test_failure_rolls_back_import_and_all_children(self):
        from sqlalchemy import func, select
        from sqlalchemy.exc import IntegrityError

        from app.modules.company.exported import import_dataset
        from app.modules.company.models import (
            CollectedEventCoverage,
            CollectedFinancial,
            CollectedRiskEvent,
            CompanyDatasetImport,
        )

        data = load(self.directory)
        # A missing event-company FK fails after financial rows have been inserted.
        data.events[0]["corp_code"] = "00000003"
        with self.assertRaises(IntegrityError):
            await import_dataset(self.database, data)
        async with self.database.transaction() as session:
            for model in (
                CompanyDatasetImport,
                CollectedFinancial,
                CollectedRiskEvent,
                CollectedEventCoverage,
            ):
                self.assertEqual(await session.scalar(select(func.count()).select_from(model)), 0)

    async def test_concurrent_imports_reuse_one_snapshot(self):
        from app.modules.company.exported import import_dataset

        data = load(self.directory)
        results = await asyncio.gather(
            import_dataset(self.database, data), import_dataset(self.database, data)
        )
        self.assertEqual({r["import_id"] for r in results}, {results[0]["import_id"]})
        self.assertEqual(sorted(r["reused"] for r in results), [False, True])

    async def test_missing_company_is_reported_without_creating_a_master_row(self):
        from sqlalchemy import func, select

        from app.modules.company.exported import ExportError, import_dataset
        from app.modules.company.models import CompanyDatasetImport, CompanyRecord

        data = load(self.directory)
        for rows in (data.financial, data.events, data.coverage):
            rows[0]["corp_code"] = "00000003"
        with self.assertRaisesRegex(ExportError, "companies missing from master"):
            await import_dataset(self.database, data)
        async with self.database.transaction() as session:
            self.assertIsNone(await session.get(CompanyRecord, "00000003"))
            self.assertEqual(
                await session.scalar(select(func.count()).select_from(CompanyDatasetImport)), 0
            )


if __name__ == "__main__":
    unittest.main()
