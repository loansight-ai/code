import asyncio
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete
from sqlalchemy.exc import SQLAlchemyError

from app.integrations.messaging.rabbitmq import JobMessage
from app.modules.evidence.models import NoteStructure, SourceSegment
from app.modules.evidence.search import NoteSearchTools
from app.modules.evidence.search_schemas import Citation
from app.worker.main import run_job


@pytest.fixture
async def document(client, environment):
    app, settings, database = environment

    async def raise_database_error(request, error):
        raise error

    app.exception_handlers[SQLAlchemyError] = raise_database_error
    await client.post("/api/v1/users")
    content = "<html><body><p>1. 차입금</p><p>재무약정 위반은 없습니다.</p></body></html>".encode()
    response = await client.post(
        "/api/v1/me/note-imports",
        params={
            "corp_code": "01214248",
            "receipt_no": "20260320001416",
            "scope": "OFS",
            "period": "2025.12",
        },
        content=content,
        headers={"Content-Type": "text/html"},
    )
    assert response.status_code == 202
    item = response.json()
    await run_job(
        database,
        settings,
        JobMessage(message_id=uuid4(), job_id=UUID(item["job_id"]), generation=1),
    )
    structure_id = UUID(item["structure_id"])
    async with database.transaction() as db:
        revision = await db.get(NoteStructure, structure_id)
        assert revision.hierarchy is not None
        # A controlled search corpus tests semantics independently of parser heuristics.
        revision.hierarchy = {
            "nodes": [
                {"id": "root", "title": "주석", "parent_id": None},
                {"id": "n1", "title": "차입금과 담보", "parent_id": "root"},
                {"id": "n2", "title": "금융약정", "parent_id": "n1"},
                {"id": "n3", "title": "소송", "parent_id": None, "review_flags": ["unresolved"]},
            ]
        }
        await db.execute(delete(SourceSegment).where(SourceSegment.structure_id == structure_id))
        segments = [
            ("root", "계속기업 관련 중요한 불확실성이 있습니다.", None),
            ("n1", "재무 약정 위반은 없습니다. 담보를 제공받았습니다.", None),
            (
                "n2",
                "당기 100 전기 90",
                {
                    "display_title": "만기 내역",
                    "context_blocks": [
                        {"text": "(단위: 백만원)", "role_inferred": "unit"},
                        {"text": "당기 100 전기 90", "block_id": "b2"},
                    ],
                    "raw_table_html": (
                        "<table><tr><th>구분</th><th>당기</th></tr>"
                        '<tr><td rowspan="2">차입</td><td>100</td></tr>'
                        "<tr><td>90</td></tr></table>"
                    ),
                    "context_status": "heuristic_needs_review",
                },
            ),
            ("n3", "계류 중인 소송이 없습니다. 100%라는 문자열과 _ 문자가 있습니다.", None),
        ]
        ids = []
        for ordinal, (owner, text, table) in enumerate(segments):
            sid = uuid4()
            ids.append(str(sid))
            db.add(
                SourceSegment(
                    id=sid,
                    structure_id=structure_id,
                    local_id=f"b{ordinal}",
                    ordinal=ordinal,
                    kind="table" if table else "paragraph",
                    source_xpath=f"/html/body/p[{ordinal + 1}]",
                    text=text,
                    owner_node_id=owner,
                    top_note_ids=[],
                    payload={},
                    table_data=table,
                )
            )
        revision.segment_count = len(segments)
    return structure_id, ids, "/api/v1/me/note-imports/" + str(structure_id) + "/search"


async def test_search_terms_fields_filters_and_pages(client, document):
    _, ids, url = document
    response = await client.post(
        url + "/segments", json={"terms": ["재무약정", "담보"], "mode": "ALL", "limit": 1}
    )
    assert response.status_code == 200, response.text
    page = response.json()
    assert response.headers["cache-control"] == "no-store"
    assert page["total"] == 1 and page["candidates"][0]["segment_id"] == ids[1]
    assert "위반은 없습니다" in page["candidates"][0]["excerpt"]["text"]
    title = (await client.post(url + "/segments", json={"terms": ["만기"], "kind": "table"})).json()
    assert title["candidates"][0]["matches"] == [{"term": "만기", "fields": ["table_title"]}]
    unit = (await client.post(url + "/segments", json={"terms": ["백만원"]})).json()
    assert unit["candidates"][0]["matches"][0]["fields"] == ["table_context"]
    root = (await client.post(url + "/segments", json={"terms": ["계속기업"]})).json()
    assert root["candidates"][0]["segment_id"] == ids[0]
    # A section title matches direct and descendant contents, including tables.
    first = (
        await client.post(url + "/segments", json={"terms": ["담보"], "node_id": "n1", "limit": 1})
    ).json()
    assert first["total"] == 2 and first["next_offset"] == 1 and first["truncated"]
    second = (
        await client.post(
            url + "/segments", json={"terms": ["담보"], "node_id": "n1", "limit": 1, "offset": 1}
        )
    ).json()
    assert second["candidates"][0]["segment_id"] != first["candidates"][0]["segment_id"]
    assert second["next_offset"] is None
    literal = (await client.post(url + "/segments", json={"terms": ["100%"]})).json()
    assert literal["total"] == 1
    empty = (await client.post(url + "/segments", json={"terms": ["존재하지않는검색어"]})).json()
    assert empty["total"] == 0
    assert (
        await client.post(url + "/segments", json={"terms": ["담보"], "node_id": "bad"})
    ).status_code == 404
    assert (await client.post(url + "/segments", json={"terms": ["  "]})).status_code == 422
    assert (
        await client.post(url + "/segments", json={"terms": ["담보"], "limit": 100})
    ).status_code == 422
    assert (
        await client.post(url + "/segments", json={"terms": ["담보"], "workspace_id": str(uuid4())})
    ).status_code == 422


async def test_sections_context_and_citation_guard(client, document, environment):
    structure_id, ids, url = document
    sections = (await client.get(url + "/sections", params={"parent_id": "n1"})).json()
    assert sections["sections"][0]["id"] == "n2"
    assert sections["sections"][0]["direct_segment_count"] == 1
    response = await client.get(
        url + "/context", params={"segment_id": ids[2], "row_offset": 1, "row_limit": 1}
    )
    assert response.status_code == 200, response.text
    context = response.json()
    assert context["table"]["total_rows"] == 3
    assert context["table"]["rows"][0][0]["rowspan"] == "2"
    assert context["table"]["header_rows"] == [["구분", "당기"]]
    assert context["table"]["next_row_offset"] == 2
    assert context["table"]["context_blocks"][1]["source_segment_id"] == ids[2]
    text_page = await client.get(url + "/context", params={"segment_id": ids[1], "text_offset": 3})
    target_text = next(s for s in text_page.json()["segments"] if s["segment_id"] == ids[1])
    assert target_text["excerpt"]["start"] == 3
    assert any(row["crosses_section_boundary"] for row in context["segments"])
    assert "raw_table_html" not in str(context)
    assert (
        await client.get(url + "/context", params={"segment_id": str(uuid4())})
    ).status_code == 404
    _, _, database = environment
    async with database.transaction() as db:
        from app.modules.evidence.models import SourceArtifact

        revision = await db.get(NoteStructure, structure_id)
        artifact = await db.get(SourceArtifact, revision.artifact_id)
        tools = NoteSearchTools(db, revision, artifact)
        assert len(tools.definitions()) == 3
        assert (await tools.call("list_note_sections", {"limit": 1}))["next_offset"] == 1
        valid = await tools.validate_citations(
            [Citation(segment_id=ids[1], quote="위반은 없습니다")]
        )
        assert valid["citations_valid"] and not valid["semantic_verification"]
        with pytest.raises(HTTPException):
            await tools.validate_citations([Citation(segment_id=ids[1], quote="위반하였습니다")])
        with pytest.raises(HTTPException):
            await tools.validate_citations([Citation(segment_id=uuid4(), quote="위반은 없습니다")])
        with pytest.raises(ValueError):
            await tools.call("execute_sql", {})


async def test_baseline_persists_six_items_and_is_owner_scoped(client, document, environment):
    app, _, _ = environment
    _, _, url = document
    assert (await client.get(url + "/baseline")).json() == {"run": None}
    responses = await asyncio.gather(*[client.post(url + "/baseline") for _ in range(2)])
    assert all(r.status_code == 200 for r in responses), [r.text for r in responses]
    result = responses[0].json()
    assert result["run_id"] == responses[1].json()["run_id"]
    assert len(result["items"]) == 6
    assert all(item["search_status"] == "COMPLETED" for item in result["items"])
    assert result["agent_status"] == "NOT_RUN" and not result["evidence_verified"]
    assert result["report_coverage"] == "PARTIAL"
    assert (
        next(i for i in result["items"] if i["key"] == "credit")["candidate_status"] == "NO_MATCH"
    )
    assert (await client.get(url + "/baseline")).json()["run"] == result
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test", headers={"Origin": "http://test"}
    ) as other:
        await other.post("/api/v1/users")
        for path in ("/sections", "/baseline"):
            assert (await other.get(url + path)).status_code == 404
        assert (
            await other.get(
                url + "/context",
                params={"segment_id": result["items"][0]["candidates"][0]["segment_id"]},
            )
        ).status_code == 404
        assert (await other.post(url + "/segments", json={"terms": ["담보"]})).status_code == 404
        assert (await other.post(url + "/baseline")).status_code == 404
    assert (
        await client.post(url + "/baseline", headers={"Origin": "https://untrusted.invalid"})
    ).status_code == 403
