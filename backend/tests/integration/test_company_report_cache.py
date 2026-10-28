import asyncio
from datetime import UTC, datetime, timedelta

import pytest
from pydantic import SecretStr

from app.modules.company.catalog import CatalogUnavailable
from app.modules.company.models import CompanyRecord, CompanyReportCatalog
from app.modules.company.reports import ReportRepository


@pytest.fixture
async def reports(environment, monkeypatch):
    app, settings, database = environment
    settings.open_dart_api_key = SecretStr("private-key")
    async with database.transaction() as session:
        session.add(
            CompanyRecord(
                corp_code="00126380",
                corp_name="삼성전자",
                modify_date="20261028",
                ksic11_status="matched",
                search_name="삼성전자",
                search_eng_name="",
            )
        )
    items = [
        {
            "receipt_no": "20260320000001",
            "report_name": "사업보고서 (2025.12)",
            "fiscal_year": "2025",
            "period": "2025.12",
            "receipt_date": "2026-03-20",
            "withdrawn": False,
        }
    ]
    calls = []

    def download(key, code, end):
        calls.append(code)
        return items, [b'{"status":"000"}']

    monkeypatch.setattr("app.modules.company.reports.download_reports", download)
    return app.state.company_reports, database, items, calls


async def test_concurrent_first_fetch_cached_in_database_and_reused_on_restart(
    reports, environment
):
    repository, database, items, calls = reports
    results = await asyncio.gather(repository.get("00126380"), repository.get("00126380"))
    assert len(calls) == 1
    assert results[0].items[0].model_dump() == items[0]
    assert results[0].checked_at == results[1].checked_at
    _, settings, _ = environment
    settings.open_dart_api_key = None
    restarted = ReportRepository(database, settings)
    assert (await restarted.get("00126380")).items[0].fiscal_year == "2025"
    assert len(calls) == 1


async def test_endpoint_validation_and_unknown_company(reports, client):
    result = await client.get("/api/v1/companies/00126380/reports")
    assert result.status_code == 200
    assert result.json()["items"][0]["fiscal_year"] == "2025"
    assert (await client.get("/api/v1/companies/99999999/reports")).status_code == 404
    assert (await client.get("/api/v1/companies/invalid/reports")).status_code == 422


async def test_expired_fetch_failure_does_not_replace_cached_data(reports, monkeypatch):
    repository, database, _, _ = reports
    await repository.get("00126380")
    async with database.transaction() as session:
        cached = await session.get(CompanyReportCatalog, "00126380")
        cached.checked_at = datetime.now(UTC) - timedelta(hours=2)

    def failed(*args):
        raise CatalogUnavailable("dart_reports_unavailable")

    monkeypatch.setattr("app.modules.company.reports.download_reports", failed)
    with pytest.raises(CatalogUnavailable):
        await repository.get("00126380")
    async with database.transaction() as session:
        assert len((await session.get(CompanyReportCatalog, "00126380")).items) == 1


async def test_empty_list_is_cached(reports, monkeypatch):
    repository, _, _, calls = reports
    monkeypatch.setattr("app.modules.company.reports.download_reports", lambda *args: ([], [b"{}"]))
    result = await repository.get("00126380")
    assert result.items == []
    assert (await repository.get("00126380")).checked_at == result.checked_at
    assert not calls
