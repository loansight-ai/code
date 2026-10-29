import asyncio
import json
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr
from sqlalchemy import func, select

from app.core.storage import LocalArtifactStore
from app.integrations.messaging.rabbitmq import JobMessage
from app.modules.company.models import CompanyRecord
from app.modules.company.reports import AnnualReport, AnnualReports
from app.modules.evidence.dart_collector import CollectionError
from app.modules.financial.models import FinancialFact, FinancialRun
from app.modules.tasks.models import Outbox, TaskEvent
from app.worker.main import run_job

INPUT = {"corp_code": "00141529", "receipt_no": "20260318000621", "scope": "OFS"}


@pytest.fixture
async def financial(environment, monkeypatch):
    app, settings, database = environment
    settings.open_dart_api_key = SecretStr("private-key")
    async with database.transaction() as db:
        db.add(
            CompanyRecord(
                corp_code=INPUT["corp_code"],
                corp_name="오뚜기",
                modify_date="20261029",
                ksic11_status="matched",
                industry="제조",
                search_name="오뚜기",
                search_eng_name="",
            )
        )

    async def reports(code):
        return AnnualReports(
            corp_code=code,
            items=[
                AnnualReport(
                    receipt_no=INPUT["receipt_no"],
                    report_name="사업보고서 (2025.12)",
                    fiscal_year="2025",
                    period="2025.12",
                    receipt_date="2026-03-18",
                )
            ],
            checked_at=datetime.now(UTC),
            search_start="19990101",
            search_end="20261029",
        )

    monkeypatch.setattr(app.state.company_reports, "get", reports)
    rows = []
    for account, value in [("CurrentAssets", "30000000000"), ("CurrentLiabilities", "20000000000")]:
        rows.append(
            {
                "corp_code": INPUT["corp_code"],
                "rcept_no": INPUT["receipt_no"],
                "bsns_year": "2025",
                "reprt_code": "11011",
                "sj_div": "BS",
                "account_id": "ifrs-full_" + account,
                "account_nm": "actual name",
                "currency": "KRW",
                "thstrm_amount": value,
                "frmtrm_amount": value,
                "bfefrmtrm_amount": "0",
            }
        )
    raw = json.dumps({"status": "000", "list": rows}).encode()
    calls = []

    def download(*args):
        calls.append(args[1]["scope"])
        return raw

    async def failed_notes(*args):
        raise CollectionError("dart_note_scope_missing")

    monkeypatch.setattr("app.modules.financial.service.download", download)
    monkeypatch.setattr("app.modules.financial.service.ensure_source", failed_notes)
    return raw, calls


async def execute(environment, item):
    _, settings, database = environment
    await run_job(
        database,
        settings,
        JobMessage(message_id=uuid4(), job_id=UUID(item["job_id"]), generation=1),
    )


async def test_full_flow_atomic_facts_provenance_and_workspace_isolation(
    client, environment, financial
):
    app, settings, database = environment
    assert (await client.post("/api/v1/me/financial-analyses", json=INPUT)).status_code == 401
    await client.post("/api/v1/users")
    response = await client.post("/api/v1/me/financial-analyses", json=INPUT)
    assert response.status_code == 202, response.text
    item = response.json()
    await execute(environment, item)
    url = "/api/v1/me/financial-analyses/" + item["analysis_run_id"]
    completed = (await client.get(url)).json()
    assert completed["status"] == "SUCCEEDED", completed
    result = completed["result"]
    source = await client.get(url + "/source")
    assert source.status_code == 200 and source.content == financial[0]
    assert result["note_state"] == "FAILED"  # Optional notes do not destroy API facts.
    assert (
        next(m for m in result["metrics"] if m["key"] == "current_ratio")["values"][0]["value"]
        == "150.0000"
    )
    assert (
        LocalArtifactStore(settings.artifact_root / "financial/originals").read(
            result["source_sha256"]
        )
        == financial[0]
    )
    async with database.transaction() as db:
        assert await db.scalar(select(func.count()).select_from(FinancialFact)) == len(
            result["facts"]
        )
        assert (
            await db.scalar(
                select(func.count())
                .select_from(TaskEvent)
                .where(TaskEvent.event_type == "task.completed")
            )
            == 1
        )
    # Duplicate delivery must not insert another set of facts or completion event.
    await execute(environment, item)
    assert financial[1] == ["OFS"]
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test", headers={"Origin": "http://test"}
    ) as other:
        await other.post("/api/v1/users")
        assert (await other.get(url)).status_code == 404
        assert (await other.get(url + "/source")).status_code == 404


async def test_concurrent_deduplication_option_revision_and_refresh(client, environment, financial):
    await client.post("/api/v1/users")
    a, b = await asyncio.gather(
        client.post("/api/v1/me/financial-analyses", json=INPUT),
        client.post("/api/v1/me/financial-analyses", json=INPUT),
    )
    assert a.status_code == b.status_code == 202
    assert a.json()["analysis_run_id"] == b.json()["analysis_run_id"]
    changed = (
        await client.post("/api/v1/me/financial-analyses", json={**INPUT, "lease": "exclude"})
    ).json()
    refreshed = (
        await client.post(
            "/api/v1/me/financial-analyses", json={**INPUT, "refresh_key": str(uuid4())}
        )
    ).json()
    assert (
        len({a.json()["analysis_run_id"], changed["analysis_run_id"], refreshed["analysis_run_id"]})
        == 3
    )
    async with environment[2].transaction() as db:
        assert await db.scalar(select(func.count()).select_from(FinancialRun)) == 3
        assert await db.scalar(select(func.count()).select_from(Outbox)) == 3


async def test_response_correction_fails_without_saving_wrong_facts(
    client, environment, financial, monkeypatch
):
    raw = json.loads(financial[0])
    raw["list"][0]["rcept_no"] = "20260319000001"
    monkeypatch.setattr(
        "app.modules.financial.service.download", lambda *args: json.dumps(raw).encode()
    )
    await client.post("/api/v1/users")
    item = (await client.post("/api/v1/me/financial-analyses", json=INPUT)).json()
    await execute(environment, item)
    result = (await client.get("/api/v1/me/financial-analyses/" + item["analysis_run_id"])).json()
    assert result["status"] == "FAILED" and result["error_code"] == "financial_receipt_mismatch"
    assert result["result"] is None
    async with environment[2].transaction() as db:
        assert await db.scalar(select(func.count()).select_from(FinancialFact)) == 0


async def test_reconciled_note_borrowings_are_persisted_with_scope_and_provenance(
    client, environment, financial, monkeypatch
):
    source = (Path(__file__).parents[1] / "fixtures/ottogi-capital-notes.html").read_bytes()
    store = LocalArtifactStore(environment[1].artifact_root)
    digest = store.put(source)

    async def notes(*args):
        return None, SimpleNamespace(sha256=digest, encoding="utf-8"), source

    monkeypatch.setattr("app.modules.financial.service.ensure_source", notes)
    await client.post("/api/v1/users")
    item = (await client.post("/api/v1/me/financial-analyses", json=INPUT)).json()
    await execute(environment, item)
    detail = (await client.get("/api/v1/me/financial-analyses/" + item["analysis_run_id"])).json()
    assert detail["status"] == "SUCCEEDED", detail
    summary = detail["result"]["note_borrowing_summaries"]["current"]
    assert summary["base_subtotal"] == "419636531000"
    assert summary["source_sha256"] == digest
    assert summary["state"] == "RECONCILED_SUBTOTAL"
    assert summary["adjusted_subtotal"] is None  # Lease inputs were not supplied.
    assert detail["result"]["borrowing_totals"]["current"] is None
    async with environment[2].transaction() as db:
        saved = await db.scalar(
            select(FinancialFact).where(
                FinancialFact.run_id == UUID(item["analysis_run_id"]),
                FinancialFact.account_key == "note_borrowing_subtotal",
                FinancialFact.period == "current",
            )
        )
        assert str(saved.amount) == "419636531000.000000"
        assert (
            saved.provenance["sources"][0]["scope"]
            == "issuer_disclosed_borrowing_components_excluding_lease"
        )
