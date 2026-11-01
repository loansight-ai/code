import json
from datetime import date
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from httpx import ASGITransport, AsyncClient

from app.integrations.agents.runtime import AgentResponse
from app.integrations.messaging.rabbitmq import JobMessage
from app.modules.company.models import CollectedEventCoverage, CompanyDatasetImport, CompanyRecord
from app.modules.evidence.bundle_models import (
    EvidenceDataset,
    EvidenceReport,
)
from app.modules.evidence.bundle_tools import BundleTools
from app.modules.evidence.search_schemas import Citation
from app.modules.identity.service import Identity
from app.worker.main import run_job
from tests.integration.evidence_fixtures import opened

CORP, RECEIPT = "01214248", "20260320001416"


async def test_private_upload_is_explicit_mixed_paging_and_original_context(
    client, environment, corpus
):
    structure, _, identity = corpus
    auto, _ = await opened(client)
    assert [s["origin"] for s in auto["sources"]] == ["dump"]
    bundle, url = await opened(client, [structure])
    assert {s["origin"] for s in bundle["sources"]} == {"html", "dump"}
    assert (await opened(client, [structure]))[0]["bundle_id"] == bundle["bundle_id"]
    all_candidates = []
    for offset in range(5):
        response = await client.post(
            url + "/search", json={"terms": ["담보"], "offset": offset, "limit": 1}
        )
        assert response.status_code == 200, response.text
        all_candidates.extend(response.json()["candidates"])
    assert len({c["segment_id"] for c in all_candidates}) == 5
    assert [c["origin"] for c in all_candidates] == ["html"] * 3 + ["dump"] * 2
    for origin, count in (("html", 3), ("dump", 2)):
        filtered = (
            await client.post(url + "/search", json={"terms": ["담보"], "origin": origin})
        ).json()
        assert filtered["total"] == count
        assert all(c["origin"] == origin for c in filtered["candidates"])
    table = next(c for c in all_candidates if c["kind"] == "table")
    context = (
        await client.get(url + "/context", params={"segment_id": table["segment_id"]})
    ).json()
    assert context["table"]["cells"][-1] == ["담보", "100", "-"]
    assert context["table"]["column_mapping_verified"] is False
    html = (
        await client.get(url + "/context", params={"segment_id": all_candidates[0]["segment_id"]})
    ).json()
    assert html["segments"][0]["origin"] == "html"
    node = f"{structure}:root"
    scoped = (await client.post(url + "/search", json={"terms": ["담보"], "node_id": node})).json()
    assert scoped["total"] == 3
    async with environment[2].transaction() as db:
        owner = Identity(UUID(identity["user_id"]), uuid4(), UUID(identity["workspace_id"]), "")
        tools = await BundleTools.owned(db, owner, UUID(bundle["bundle_id"]))
        await tools.validate_citations([Citation(segment_id=table["segment_id"], quote="담보")])
        with pytest.raises(HTTPException):
            await tools.validate_citations([Citation(segment_id=table["segment_id"], quote="위조")])


async def test_isolation_scope_mismatch_and_incomplete_regions(client, environment, corpus):
    structure, _, _ = corpus
    bundle, url = await opened(client, [structure])
    baseline = (await client.post(url + "/baseline")).json()
    assert len(baseline["items"]) == 6
    assert "business_report" in baseline["items"][0]["unavailable_regions"]
    assert bundle["model_input_status"] == "WITHHELD_UNVERIFIED"
    bad = await client.post(
        "/api/v1/me/evidence-bundles",
        json={
            "corp_code": CORP,
            "receipt_no": RECEIPT,
            "scope": "CFS",
            "structure_ids": [str(structure)],
        },
    )
    assert bad.status_code == 422
    app, _, _ = environment
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test", headers={"Origin": "http://test"}
    ) as other:
        await other.post("/api/v1/users")
        assert (await other.get(url)).status_code == 404
        assert (
            await other.post(
                "/api/v1/me/evidence-bundles",
                json={
                    "corp_code": CORP,
                    "receipt_no": RECEIPT,
                    "scope": "OFS",
                    "structure_ids": [str(structure)],
                },
            )
        ).status_code == 404


async def test_dataset_revision_pin_and_no_financial_prerequisite(client, environment, corpus):
    _, report, _ = corpus
    first, url = await opened(client, [])
    async with environment[2].transaction() as db:
        old = await db.get(EvidenceReport, report)
        new = EvidenceDataset(
            signature=uuid4().hex * 2, status="READY", manifest={"archive_name": "new.dump"}
        )
        db.add(new)
        await db.flush()
        db.add(
            EvidenceReport(
                id=uuid4(),
                dataset_id=new.id,
                corp_code=CORP,
                receipt_no=RECEIPT,
                period=old.period,
                data=old.data,
            )
        )
    second, _ = await opened(client, [])
    assert second["bundle_id"] != first["bundle_id"]
    assert (await client.get(url)).json()["bundle_revision"] == first["bundle_revision"]
    # No CollectedFinancial or CompanyRecord fixture was needed for report evidence.
    assert (await client.get(f"/api/v1/me/companies/{CORP}/evidence-reports")).status_code == 200


async def test_event_dataset_is_pinned_without_retargeting_old_bundle(client, environment, corpus):
    first, url = await opened(client, [])
    assert first["collection_import_id"] is None
    import_id = uuid4()
    async with environment[2].transaction() as db:
        db.add(
            CompanyRecord(
                corp_code=CORP,
                corp_name="시험회사",
                modify_date="20261101",
                ksic11_status="unmatched",
                search_name="시험회사",
                search_eng_name="",
            )
        )
        db.add(
            CompanyDatasetImport(
                id=import_id,
                signature=uuid4().hex * 2,
                parser_version="test",
                exported_on=date(2026, 11, 1),
                source_as_of=date(2026, 10, 26),
                manifest={},
            )
        )
        await db.flush()
        db.add(CollectedEventCoverage(import_id=import_id, corp_code=CORP))
    second, _ = await opened(client, [])
    assert second["collection_import_id"] == str(import_id)
    assert second["bundle_id"] != first["bundle_id"]
    assert (await client.get(url)).json()["collection_import_id"] is None


@pytest.mark.parametrize("mode", ["valid", "bad_quote", "unread"])
async def test_bundle_agent_reads_and_validates_dump_citations(
    client, environment, corpus, monkeypatch, mode
):
    _, settings, database = environment
    settings.codex_home = settings.artifact_root / "codex"
    settings.note_agent_timeout_seconds = 10
    settings.note_agent_max_tool_calls = 30
    bundle, url = await opened(client, [])

    class Runtime:
        async def run(self, prompt, definitions, call, output_schema):
            from app.modules.evidence.search_baseline import CATEGORIES

            items = []
            for key, _, _, _ in CATEGORIES:
                page = await call("search_note_segments", {"category_key": key, "terms": ["담보"]})
                sid = page["candidates"][0]["segment_id"]
                if mode != "unread":
                    await call("read_note_context", {"category_key": key, "segment_id": sid})
                items.append(
                    {
                        "key": key,
                        "search_status": "COMPLETED",
                        "limitations": "검수 전",
                        "findings": [
                            {
                                "statement": "담보 기재 후보",
                                "citations": [
                                    {
                                        "segment_id": sid,
                                        "quote": "위조" if mode == "bad_quote" else "담보",
                                    }
                                ],
                            }
                        ],
                    }
                )
            return AgentResponse(text=json.dumps({"items": items}), model="test", thread_id="test")

    monkeypatch.setattr("app.modules.evidence.agent.runtime_for", lambda *a: Runtime())
    task = (await client.post(url + "/agent")).json()
    assert "job_id" in task, task
    await run_job(
        database,
        settings,
        JobMessage(message_id=uuid4(), job_id=UUID(task["job_id"]), generation=1),
    )
    result = (await client.get(url + "/agent")).json()["run"]
    assert result["status"] == ("SUCCEEDED" if mode == "valid" else "PARTIAL_SUCCEEDED"), result
    assert result["result"]["bundle_revision"] == bundle["bundle_revision"]
    assert result["result"]["evidence_verified"] is False
