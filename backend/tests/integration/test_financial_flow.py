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
from app.integrations.agents.runtime import AgentResponse
from app.integrations.messaging.rabbitmq import JobMessage
from app.modules.company.models import CompanyRecord
from app.modules.company.reports import AnnualReport, AnnualReports
from app.modules.evidence.dart_collector import CollectionError
from app.modules.evidence.models import NoteStructure, SourceSegment
from app.modules.financial.models import (
    FinancialFact,
    FinancialNoteCandidate,
    FinancialNoteWorkflow,
    FinancialRun,
)
from app.modules.financial.workflow import advance
from app.modules.tasks.models import Job, Outbox, TaskEvent
from app.worker.main import run_job

INPUT = {"corp_code": "00141529", "receipt_no": "20260318000621", "scope": "OFS"}

NOTE_HTML = """<html><body><p>재무제표 주석</p><p>1. 자본관리</p><p>당기 (단위 : 천원)</p>
<table><tr><td>구분</td><td>금액</td></tr><tr><td>자산총계</td><td>40,000,000</td></tr></table></body></html>""".encode()


class FinancialRuntime:
    mode = "valid"

    async def run(self, prompt, definitions, call, output_schema):
        assert '"missing"' in prompt and len(definitions) == 3
        if self.mode == "timeout":
            raise TimeoutError
        found = await call("search_note_segments", {"terms": ["자산총계"], "kind": "table"})
        sid = found["candidates"][0]["segment_id"]
        context = await call("read_note_context", {"segment_id": sid})
        caption = next(
            s
            for s in context["segments"]
            if "단위" in s["excerpt"]["text"] and s["segment_id"] != sid
        )
        candidate = {
            "key": "assets",
            "period": "current",
            "account_name": "자산총계",
            "raw_amount": "40,000,000",
            "currency": "KRW",
            "unit_multiplier": 1000,
            "row_index": 1,
            "label_column": 0,
            "amount_column": 1,
            "citation": {
                "segment_id": sid,
                "quote": "자산총계" if self.mode != "bad_quote" else "없는 인용",
            },
            "period_citation": {"segment_id": caption["segment_id"], "quote": "당기"},
            "unit_citation": {"segment_id": caption["segment_id"], "quote": "단위 : 천원"},
            "rationale": "자본관리 주석의 자산총계 직접 금액",
        }
        return AgentResponse(
            json.dumps(
                {
                    "candidates": [candidate],
                    "limitations": "테스트 문서의 직접 금액만 확인. 담당자 검수 전.",
                }
            ),
            "test-model",
            "test-thread",
        )


@pytest.fixture
def enrichment_ready(environment, financial, monkeypatch, tmp_path):
    _, settings, _ = environment
    settings.codex_home = tmp_path / "codex"
    settings.note_agent_timeout_seconds = 10
    settings.note_agent_max_tool_calls = 10
    digest = LocalArtifactStore(settings.artifact_root).put(NOTE_HTML)

    async def notes(*args):
        return None, SimpleNamespace(id=None, sha256=digest, encoding="utf-8"), NOTE_HTML

    monkeypatch.setattr("app.modules.financial.service.ensure_source", notes)
    raw = json.loads(financial[0])
    raw["list"].append(
        {
            **raw["list"][0],
            "account_id": "ifrs-full_Equity",
            "account_nm": "자본총계",
            "thstrm_amount": "20000000000",
        }
    )
    monkeypatch.setattr(
        "app.modules.financial.service.download", lambda *args: json.dumps(raw).encode()
    )
    runtime = FinancialRuntime()
    monkeypatch.setattr("app.modules.financial.enrichment.runtime_for", lambda *args: runtime)
    return runtime


@pytest.mark.parametrize(
    "mode,stage", [("valid", "COMPLETED"), ("bad_quote", "PARTIAL"), ("timeout", "PARTIAL")]
)
async def test_optional_structure_then_enrichment_with_snapshot_and_evidence(
    client, environment, financial, enrichment_ready, mode, stage
):
    enrichment_ready.mode = mode
    await client.post("/api/v1/users")
    submitted = await client.post(
        "/api/v1/me/financial-analyses", json={**INPUT, "enrich_notes": True}
    )
    assert submitted.status_code == 202, submitted.text
    item = submitted.json()
    url = "/api/v1/me/financial-analyses/" + item["analysis_run_id"]
    await execute(environment, item)
    baseline = (await client.get(url)).json()
    assert baseline["status"] == "SUCCEEDED", baseline
    assert baseline["note_workflow"]["stage"] == "WAITING_STRUCTURE", baseline
    database = environment[2]
    await advance(database)
    async with database.transaction() as db:
        workflow = await db.get(FinancialNoteWorkflow, UUID(item["analysis_run_id"]))
        assert workflow.job_id is None  # Parsing has not completed yet.
        structure = await db.get(NoteStructure, workflow.structure_id)
        structure_job_id = structure.job_id
    await execute(environment, {"job_id": str(structure_job_id)})
    await asyncio.gather(advance(database), advance(database))
    async with database.transaction() as db:
        workflow = await db.get(FinancialNoteWorkflow, UUID(item["analysis_run_id"]))
        assert workflow.stage == "ENRICHING", workflow.error_code
        agent_job_id = workflow.job_id
        assert (
            await db.scalar(
                select(func.count())
                .select_from(Job)
                .where(Job.task_type == "FINANCIAL_NOTE_ENRICHMENT")
            )
            == 1
        )
    await execute(environment, {"job_id": str(agent_job_id)})
    final = (await client.get(url)).json()
    assert final["note_workflow"]["stage"] == stage, final["note_workflow"]
    asset = next(
        f for f in final["result"]["facts"] if f["key"] == "assets" and f["period"] == "current"
    )
    async with database.transaction() as db:
        original = await db.get(FinancialRun, UUID(item["analysis_run_id"]))
        assert next(f for f in original.result["facts"] if f["key"] == "assets")["value"] is None
        if mode == "valid":
            assert asset["value"] == "40000000000"
            assert asset["mapping_method"] == "codex_verified_note_cell"
            assert (
                next(m for m in final["result"]["metrics"] if m["key"] == "equity_ratio")["values"][
                    0
                ]["value"]
                == "50.0000"
            )
            row = await db.scalar(select(FinancialNoteCandidate))
            assert row.status == "APPLIED" and str(row.amount) == "40000000000.000000"
            assert row.data["period"] == "current"
            assert row.data["review_status"] == "PENDING" and row.data["evidence_verified"] is False
            segment = await db.get(SourceSegment, UUID(row.data["citation"]["segment_id"]))
            assert row.data["citation"]["quote"] in segment.text
        else:
            assert asset["value"] is None
    await execute(environment, {"job_id": str(agent_job_id)})
    assert (await client.get(url)).json()["note_workflow"] == final["note_workflow"]


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
                ksic11_code="10740",
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


async def test_bok_snapshot_persistence_and_legacy_read(client, environment, financial):
    _, _, database = environment
    await client.post("/api/v1/users")
    submitted = (await client.post("/api/v1/me/financial-analyses", json=INPUT)).json()
    await execute(environment, submitted)
    url = "/api/v1/me/financial-analyses/" + submitted["analysis_run_id"]
    actual = (await client.get(url)).json()["result"]["bok_benchmark"]
    assert actual["industry_code"] == "C10"
    current = next(m for m in actual["metrics"] if m["key"] == "current_ratio")["values"][0]
    assert current["value"] == "131.50" and current["gap"] == "18.5000"
    async with database.transaction() as db:
        run = await db.get(FinancialRun, UUID(submitted["analysis_run_id"]))
        assert run.result["bok_benchmark"]["version"] == actual["version"]
        company = await db.get(CompanyRecord, INPUT["corp_code"])
        company.ksic11_code = "68112"
    # A later company-master update must not change the saved comparison scope.
    assert (await client.get(url)).json()["result"]["bok_benchmark"] == actual
    async with database.transaction() as db:
        run = await db.get(FinancialRun, UUID(submitted["analysis_run_id"]))
        legacy = {k: v for k, v in run.result.items() if k != "bok_benchmark"}
        run.result = legacy
    fallback = (await client.get(url)).json()["result"]["bok_benchmark"]
    assert fallback["industry_code"] == "L68"
    async with database.transaction() as db:
        run = await db.get(FinancialRun, UUID(submitted["analysis_run_id"]))
        assert "bok_benchmark" not in run.result


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


async def test_optional_source_failure_keeps_baseline(client, environment, financial):
    await client.post("/api/v1/users")
    item = (
        await client.post("/api/v1/me/financial-analyses", json={**INPUT, "enrich_notes": True})
    ).json()
    await execute(environment, item)
    await advance(environment[2])
    result = (await client.get("/api/v1/me/financial-analyses/" + item["analysis_run_id"])).json()
    assert result["status"] == "SUCCEEDED"
    assert result["result"] is not None
    assert result["note_workflow"]["stage"] == "FAILED"
    assert result["note_workflow"]["error_code"] == "dart_note_scope_missing"


async def test_failed_structure_does_not_schedule_codex(
    client, environment, financial, enrichment_ready, monkeypatch
):
    async def failed(*args):
        raise ValueError("structure_failure")

    monkeypatch.setattr("app.modules.evidence.service.prepare", failed)
    await client.post("/api/v1/users")
    item = (
        await client.post("/api/v1/me/financial-analyses", json={**INPUT, "enrich_notes": True})
    ).json()
    await execute(environment, item)
    async with environment[2].transaction() as db:
        workflow = await db.get(FinancialNoteWorkflow, UUID(item["analysis_run_id"]))
        structure = await db.get(NoteStructure, workflow.structure_id)
        structure_job = structure.job_id
    await execute(environment, {"job_id": str(structure_job)})
    await advance(environment[2])
    result = (await client.get("/api/v1/me/financial-analyses/" + item["analysis_run_id"])).json()
    assert result["status"] == "SUCCEEDED" and result["result"] is not None
    assert result["note_workflow"]["stage"] == "FAILED"
    async with environment[2].transaction() as db:
        assert (
            await db.scalar(
                select(func.count())
                .select_from(Job)
                .where(Job.task_type == "FINANCIAL_NOTE_ENRICHMENT")
            )
            == 0
        )


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
