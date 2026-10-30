from datetime import UTC, date, datetime
from uuid import UUID, uuid4

import pytest

from app.integrations.messaging.rabbitmq import JobMessage
from app.modules.company.models import (
    CollectedEventCoverage,
    CollectedFinancial,
    CollectedRiskEvent,
    CompanyDatasetImport,
    CompanyRecord,
)
from app.modules.company.reports import AnnualReport, AnnualReports
from app.worker.main import run_job

CORP = "00164478"
RECEIPT = "20260318001395"


@pytest.fixture
async def collected(environment, monkeypatch):
    app, settings, database = environment
    settings.open_dart_api_key = None
    import_id = uuid4()
    async with database.transaction() as session:
        session.add(
            CompanyRecord(
                corp_code=CORP,
                corp_name="현대건설",
                modify_date="20261030",
                ksic11_status="matched",
                industry="건설",
                search_name="현대건설",
                search_eng_name="",
            )
        )
        session.add(
            CompanyDatasetImport(
                id=import_id,
                signature="a" * 64,
                parser_version="test",
                exported_on=date(2026, 10, 30),
                source_as_of=date(2026, 10, 26),
                manifest={},
            )
        )
        await session.flush()
        session.add(
            CollectedFinancial(
                import_id=import_id,
                corp_code=CORP,
                fiscal_year=2025,
                scope="CFS",
                receipt_no=RECEIPT,
                data={
                    "corp_code": CORP,
                    "rcept_no": RECEIPT,
                    "bsns_year": "2025",
                    "fs_div": "CFS",
                    "bs_ca": "30000000000",
                    "bs_cl": "20000000000",
                    "is_rev": "12000000000",
                    "is_int_exp": "0",
                },
            )
        )
        session.add(
            CollectedEventCoverage(
                import_id=import_id,
                corp_code=CORP,
                data={"corp_code": CORP, "audit_doc_ok": 0, "audit_doc_reports": 1},
            )
        )
        session.add(
            CollectedRiskEvent(
                import_id=import_id,
                corp_code=CORP,
                source_id=1,
                receipt_no=RECEIPT,
                event_date=date(2026, 3, 18),
                verified=None,
                data={"corp_code": CORP, "verified": None, "detail": "검수 전"},
            )
        )

    async def reports(code):
        return AnnualReports(
            corp_code=code,
            items=[
                AnnualReport(
                    receipt_no=RECEIPT,
                    report_name="사업보고서 (2025.12)",
                    fiscal_year="2025",
                    period="2025.12",
                    receipt_date="2026-03-18",
                )
            ],
            checked_at=datetime.now(UTC),
            search_start="20150101",
            search_end="20261030",
        )

    def no_download(*args, **kwargs):
        pytest.fail("CSV analysis must not call OpenDART")

    monkeypatch.setattr(app.state.company_reports, "get", reports)
    monkeypatch.setattr("app.modules.financial.service.download", no_download)
    return str(import_id)


async def test_collection_api_and_csv_analysis_share_real_values(client, environment, collected):
    response = await client.get(
        f"/api/v1/companies/{CORP}/collected-data", params={"receipt_no": RECEIPT, "scope": "CFS"}
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["import_id"] == collected
    assert data["financial"][0]["bs_ca"] == "30000000000"
    assert data["event_candidates"][0]["verified"] is None
    ofs = await client.get(
        f"/api/v1/companies/{CORP}/collected-data", params={"receipt_no": RECEIPT, "scope": "OFS"}
    )
    assert ofs.json()["financial"] == []
    assert ofs.json()["available_scopes"] == ["CFS"]
    await client.post("/api/v1/users")
    inputs = {
        "corp_code": CORP,
        "receipt_no": RECEIPT,
        "scope": "CFS",
        "source_import_id": collected,
    }
    rejected = await client.post("/api/v1/me/financial-analyses", json={**inputs, "scope": "OFS"})
    assert rejected.status_code == 422
    rejected = await client.post(
        "/api/v1/me/financial-analyses", json={**inputs, "enrich_notes": True}
    )
    assert rejected.status_code == 422
    # The existing action automatically uses exact stored financials. No separate
    # source selection or source_import_id is required from the browser.
    automatic = {key: value for key, value in inputs.items() if key != "source_import_id"}
    submitted = await client.post("/api/v1/me/financial-analyses", json=automatic)
    assert submitted.status_code == 202, submitted.text
    item = submitted.json()
    await run_job(
        environment[2],
        environment[1],
        JobMessage(message_id=uuid4(), job_id=UUID(item["job_id"]), generation=1),
    )
    url = "/api/v1/me/financial-analyses/" + item["analysis_run_id"]
    completed = (await client.get(url)).json()
    assert completed["status"] == "SUCCEEDED", completed
    assert completed["context"]["source_import_id"] == collected
    result = completed["result"]
    assert result["collection_source"]["import_id"] == collected
    assert (
        next(m for m in result["metrics"] if m["key"] == "current_ratio")["values"][0]["value"]
        == "150.0000"
    )
    assert (await client.get(url + "/source")).json()["import_id"] == collected
    refresh = await client.post(
        "/api/v1/me/financial-analyses",
        json={
            **automatic,
            "refresh_key": str(uuid4()),
        },
    )
    assert refresh.status_code == 202
    refresh_run = (
        await client.get("/api/v1/me/financial-analyses/" + refresh.json()["analysis_run_id"])
    ).json()
    assert "source_import_id" not in refresh_run["context"]
    other_scope = await client.post(
        "/api/v1/me/financial-analyses",
        json={
            **automatic,
            "scope": "OFS",
        },
    )
    assert other_scope.status_code == 202
    scope_run = (
        await client.get("/api/v1/me/financial-analyses/" + other_scope.json()["analysis_run_id"])
    ).json()
    assert "source_import_id" not in scope_run["context"]
