from importlib.resources import files
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr
from sqlalchemy import func, select

from app.core.storage import LocalArtifactStore
from app.integrations.messaging.rabbitmq import JobMessage
from app.modules.company.models import CompanyRecord
from app.modules.company.reports import AnnualReport, AnnualReports
from app.modules.evidence.dart_models import DartDocument, DartNote
from app.modules.evidence.models import NoteStructure
from app.worker.main import run_job

CONTEXT = {"corp_code": "01214248", "receipt_no": "20260320001416", "scope": "OFS"}
SOURCE = files("note_hierarchy").joinpath("examples/dart_notes.html").read_bytes()


@pytest.fixture
async def collection(environment, monkeypatch):
    app, settings, database = environment
    settings.open_dart_api_key = SecretStr("private-key")
    async with database.transaction() as db:
        db.add(
            CompanyRecord(
                corp_code=CONTEXT["corp_code"],
                corp_name="뉴트리",
                modify_date="20260320",
                ksic11_status="matched",
                search_name="뉴트리",
                search_eng_name="",
            )
        )

    async def reports(code):
        from datetime import UTC, datetime

        return AnnualReports(
            corp_code=code,
            items=[
                AnnualReport(
                    receipt_no=CONTEXT["receipt_no"],
                    report_name="사업보고서 (2025.12)",
                    fiscal_year="2025",
                    period="2025.12",
                    receipt_date="2026-03-20",
                )
            ],
            checked_at=datetime.now(UTC),
            search_start="19990101",
            search_end="20261028",
        )

    monkeypatch.setattr(app.state.company_reports, "get", reports)
    calls = []

    def document(store, key, receipt, maximum):
        calls.append("zip")
        return {
            "archive_sha256": store.put(b"original zip"),
            "archive_bytes": 12,
            "xml_files": [
                {"name": "original.xml", "sha256": store.put(b"<DOCUMENT/>"), "byte_length": 11}
            ],
            "toc_sha256": store.put(b"original toc"),
            "locators": {"OFS": {"scope": "OFS"}, "CFS": {"scope": "CFS"}},
        }

    def note(store, locator, maximum):
        calls.append(locator["scope"])
        return {
            "sha256": store.put(SOURCE),
            "byte_length": len(SOURCE),
            "encoding": "utf-8",
            "locator": locator,
            "collector_version": "dart-viewer-v1",
        }

    monkeypatch.setattr("app.modules.evidence.dart_service.collect_document", document)
    monkeypatch.setattr("app.modules.evidence.dart_service.collect_note", note)
    return calls


async def execute(database, settings, item):
    await run_job(
        database,
        settings,
        JobMessage(message_id=uuid4(), job_id=UUID(item["job_id"]), generation=1),
    )


async def test_collection_enqueues_existing_parser_preserves_provenance_and_reuses_sources(
    client, environment, collection
):
    app, settings, database = environment
    assert (await client.post("/api/v1/me/disclosure-collections", json=CONTEXT)).status_code == 401
    await client.post("/api/v1/users")
    response = await client.post("/api/v1/me/disclosure-collections", json=CONTEXT)
    assert response.status_code == 202, response.text
    parent = response.json()
    await execute(database, settings, parent)
    detail = (await client.get("/api/v1/me/tasks/" + parent["task_id"])).json()
    assert detail["status"] == "SUCCEEDED", detail
    result = detail["result"]
    note_task = (await client.get("/api/v1/me/tasks/" + result["note_task_id"])).json()
    await execute(database, settings, note_task)
    meta = (await client.get("/api/v1/me/note-imports/" + result["structure_id"])).json()
    assert meta["status"] == "SUCCEEDED" and meta["segment_count"] > 0
    assert meta["input_origin"] == "dart_viewer_note_html"
    assert meta["dart_note_id"] is not None
    assert meta["evidence_verified"] is False
    store = LocalArtifactStore(settings.artifact_root)
    assert store.read(meta["source_sha256"]) == SOURCE
    again = (await client.post("/api/v1/me/disclosure-collections", json=CONTEXT)).json()
    assert again["task_id"] == parent["task_id"] and again["reused"]
    connected = (
        await client.post("/api/v1/me/disclosure-collections", json={**CONTEXT, "scope": "CFS"})
    ).json()
    await execute(database, settings, connected)
    assert collection == ["zip", "OFS", "CFS"]
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test", headers={"Origin": "http://test"}
    ) as other:
        await other.post("/api/v1/users")
        assert (await other.get("/api/v1/me/tasks/" + parent["task_id"])).status_code == 404
        assert (
            await other.get("/api/v1/me/note-imports/" + result["structure_id"])
        ).status_code == 404
        own = (await other.post("/api/v1/me/disclosure-collections", json=CONTEXT)).json()
        await execute(database, settings, own)
        own_result = (await other.get("/api/v1/me/tasks/" + own["task_id"])).json()["result"]
        own_meta = (await other.get("/api/v1/me/note-imports/" + own_result["structure_id"])).json()
        assert own_meta["source_sha256"] == meta["source_sha256"]
        assert own_meta["source_artifact_id"] != meta["source_artifact_id"]
        assert own_meta["dart_note_id"] == meta["dart_note_id"]
        assert collection == ["zip", "OFS", "CFS"]
    async with database.transaction() as db:
        assert await db.scalar(select(func.count()).select_from(DartDocument)) == 1
        assert await db.scalar(select(func.count()).select_from(DartNote)) == 2


async def test_scope_missing_does_not_submit_wrong_scope_or_partial_structure(
    client, environment, collection, monkeypatch
):
    from app.modules.evidence.dart_collector import CollectionError

    _, settings, database = environment

    def missing(*args):
        raise CollectionError("dart_note_scope_missing")

    monkeypatch.setattr("app.modules.evidence.dart_service.collect_note", missing)
    await client.post("/api/v1/users")
    parent = (await client.post("/api/v1/me/disclosure-collections", json=CONTEXT)).json()
    await execute(database, settings, parent)
    detail = (await client.get("/api/v1/me/tasks/" + parent["task_id"])).json()
    assert detail["status"] == "FAILED" and detail["error_code"] == "dart_note_scope_missing"
    async with database.transaction() as db:
        assert await db.scalar(select(func.count()).select_from(NoteStructure)) == 0
        assert await db.scalar(select(func.count()).select_from(DartNote)) == 0


async def test_rejects_forged_receipt_and_scope(client, collection):
    await client.post("/api/v1/users")
    for values in ({"receipt_no": "20260320000001"}, {"scope": "invalid"}):
        assert (
            await client.post("/api/v1/me/disclosure-collections", json={**CONTEXT, **values})
        ).status_code == 422
