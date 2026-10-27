import asyncio
from importlib.resources import files
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select, text

from app.core.storage import LocalArtifactStore
from app.integrations.messaging.rabbitmq import JobMessage
from app.modules.evidence import service
from app.modules.evidence.models import NoteStructure, SourceSegment
from app.modules.tasks import service as tasks
from app.modules.tasks.models import Job, Outbox
from app.worker.main import run_job

CONTEXT = {
    "corp_code": "01214248",
    "receipt_no": "20260320001416",
    "scope": "CFS",
    "period": "2025.12",
}
SOURCE = files("note_hierarchy").joinpath("examples/dart_notes.html").read_bytes()


async def submit(client, content=SOURCE, **options):
    response = await client.post(
        "/api/v1/me/note-imports",
        params={**CONTEXT, **options},
        content=content,
        headers={"Content-Type": "text/html"},
    )
    assert response.status_code == 202, response.text
    return response.json()


def message(item):
    return JobMessage(message_id=uuid4(), job_id=UUID(item["job_id"]), generation=1)


async def test_concurrent_distinct_imports_do_not_deadlock(client, environment):
    await client.post("/api/v1/users")
    imports = await asyncio.gather(
        *[submit(client, content=SOURCE + str(index).encode()) for index in range(4)]
    )
    assert len({item["structure_id"] for item in imports}) == 4
    snapshot = (await client.get("/api/v1/me/tasks")).json()
    assert len(snapshot["tasks"]) == 4 and snapshot["event_cursor"].endswith(":4")


async def test_import_idempotence_revisions_and_scoped_reads(client, environment):
    app, settings, database = environment
    await client.post("/api/v1/users")
    items = await asyncio.gather(*[submit(client) for _ in range(4)])
    first = items[0]
    assert len({item["structure_id"] for item in items}) == 1
    assert len({item["task_id"] for item in items}) == 1
    url = "/api/v1/me/note-imports/" + first["structure_id"]
    assert (await client.get(url + "/segments")).status_code == 409
    async with database.transaction() as db:
        assert await db.scalar(select(func.count()).select_from(Outbox)) == 1
    await run_job(database, settings, message(first))
    meta = (await client.get(url)).json()
    assert meta["status"] == "SUCCEEDED" and meta["segment_count"] > 0
    assert meta["hierarchy"]["status"] == "rule_based_draft_not_gold"
    assert meta["evidence_verified"] is False
    assert meta["hierarchy"]["verification"]["structural_checks_passed"] is True
    collected = []
    after = -1
    while True:
        response = await client.get(url + "/segments", params={"after": after, "limit": 2})
        assert response.headers["cache-control"] == "no-store"
        page = response.json()
        collected.extend(page["segments"])
        if page["next_after"] is None:
            break
        after = page["next_after"]
    assert len(collected) == meta["segment_count"] == len({r["id"] for r in collected})
    assert [r["ordinal"] for r in collected] == list(range(meta["segment_count"]))
    for row in collected:
        assert row["source_xpath"] == row["payload"]["source_xpath"]
        assert row["owner_node_id"] == row["payload"]["owner_node_id"]
    assert any(row["table_data"] and row["table_data"]["raw_table_html"] for row in collected)
    detail_url = url + "/segments/" + collected[0]["id"]
    assert (await client.get(detail_url)).json() == collected[0]
    await run_job(database, settings, message(first))  # Redelivery cannot duplicate segments.
    assert (await client.get(url)).json()["segment_count"] == len(collected)
    assert (await submit(client))["structure_id"] == first["structure_id"]
    options_changed = await submit(client, link_periods=False)
    source_changed = await submit(client, content=SOURCE + b"<!--revision-->")
    assert (
        len(
            {first["structure_id"], options_changed["structure_id"], source_changed["structure_id"]}
        )
        == 3
    )
    assert options_changed["source_artifact_id"] == first["source_artifact_id"]
    assert source_changed["source_artifact_id"] != first["source_artifact_id"]
    artifact = LocalArtifactStore(settings.artifact_root)
    assert artifact.read(meta["source_sha256"]) == SOURCE
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test", headers={"Origin": "http://test"}
    ) as other:
        await other.post("/api/v1/users")
        assert (await other.get(url)).status_code == 404
        assert (await other.get(url + "/segments")).status_code == 404
        assert (await other.get(detail_url)).status_code == 404
        personal = await submit(other)
        assert personal["structure_id"] != first["structure_id"]


async def test_rejects_bad_requests_and_keeps_failed_import_uncommitted(client, environment):
    _, settings, database = environment
    response = await client.post(
        "/api/v1/me/note-imports",
        params=CONTEXT,
        content=SOURCE,
        headers={"Content-Type": "text/html"},
    )
    assert response.status_code == 401
    await client.post("/api/v1/users")
    assert (
        await client.post("/api/v1/me/note-imports", params=CONTEXT, json={})
    ).status_code == 415
    assert (
        await client.post(
            "/api/v1/me/note-imports",
            params={**CONTEXT, "scope": "OTHER"},
            content=SOURCE,
            headers={"Content-Type": "text/html"},
        )
    ).status_code == 422
    assert (
        await client.post(
            "/api/v1/me/note-imports",
            params=CONTEXT,
            content=b"\xff",
            headers={"Content-Type": "text/html"},
        )
    ).status_code == 422
    settings.note_import_max_bytes = 10
    assert (
        await client.post(
            "/api/v1/me/note-imports",
            params=CONTEXT,
            content=SOURCE,
            headers={"Content-Type": "text/html"},
        )
    ).status_code == 413
    settings.note_import_max_bytes = 20 * 1024 * 1024
    item = await submit(client, content=b"<html><body></body></html>")
    await run_job(database, settings, message(item))
    async with database.transaction() as db:
        job = await db.get(Job, UUID(item["job_id"]))
        revision = await db.get(NoteStructure, UUID(item["structure_id"]))
        assert job.status == "FAILED" and revision.hierarchy is None
        assert await db.scalar(select(func.count()).select_from(SourceSegment)) == 0


async def test_lost_lease_cannot_store_segments(client, environment):
    _, settings, database = environment
    await client.post("/api/v1/users")
    item = await submit(client)
    job_id = UUID(item["job_id"])
    owner = await tasks.claim(database, settings, job_id, 1)
    prepared = await service.prepare(database, settings, job_id)
    async with database.transaction() as db:
        job = await db.get(Job, job_id)
        job.owner_token = uuid4()
    assert await service.complete(database, job_id, owner, prepared) is False
    async with database.transaction() as db:
        job = await db.get(Job, job_id)
        job.owner_token = owner
        job.lease_until = await db.scalar(
            select(func.clock_timestamp() - text("interval '1 second'"))
        )
    assert await service.complete(database, job_id, owner, prepared) is False
    async with database.transaction() as db:
        revision = await db.get(NoteStructure, UUID(item["structure_id"]))
        assert revision.hierarchy is None
        assert await db.scalar(select(func.count()).select_from(SourceSegment)) == 0


async def test_segment_and_completion_transaction_rolls_back_together(
    client, environment, monkeypatch
):
    _, settings, database = environment
    await client.post("/api/v1/users")
    item = await submit(client)
    job_id = UUID(item["job_id"])
    owner = await tasks.claim(database, settings, job_id, 1)
    prepared = await service.prepare(database, settings, job_id)
    original = tasks.complete_job

    async def broken_completion(*args):
        await original(*args)
        raise RuntimeError("simulated_commit_failure")

    monkeypatch.setattr(tasks, "complete_job", broken_completion)
    with pytest.raises(RuntimeError):
        await service.complete(database, job_id, owner, prepared)
    async with database.transaction() as db:
        assert await db.scalar(select(func.count()).select_from(SourceSegment)) == 0
        assert (await db.get(NoteStructure, UUID(item["structure_id"]))).hierarchy is None
        assert (await db.get(Job, job_id)).status == "RUNNING"
