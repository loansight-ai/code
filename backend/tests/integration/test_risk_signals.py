import copy

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.modules.evidence.bundle_models import EvidenceSegment
from app.modules.risk import service as risk
from tests.integration.evidence_fixtures import create, decision
from tests.risk_fixture_rules import definition


async def approve(client, url, fact):
    opening = (await client.post(url + f"/facts/{fact['id']}/open")).json()
    response, _ = await decision(client, url, fact, opening=opening["opening_id"])
    assert response.status_code == 200, response.text
    return response.json()["fact"]


async def test_pending_approved_and_withdrawn_inputs_never_imply_normal(client, fact_corpus):
    _, url, data, _ = fact_corpus
    empty = await client.get(url + "/signals")
    assert empty.status_code == 200, empty.text
    assert empty.headers["cache-control"] == "no-store"
    assert len(empty.json()["categories"]) == 6 and empty.json()["severity_counts"] == {}
    fact = await create(client, url, data)
    pending = (await client.get(url + "/signals")).json()
    assert pending["facts"][0]["gate"] == "REVIEW_PENDING"
    assert pending["ready_inputs"] == 0
    fact = await approve(client, url, fact)
    result = (await client.get(url + "/signals")).json()
    assert result["ready_inputs"] == 1 and result["facts"][0]["gate"] == "READY"
    assert result["evaluation_status"] == "DEFINITION_PENDING" and not result["evaluations"]
    assert result["severity_counts"] == {} and not result["model_eligible"]
    assert pending["input_revision"] != result["input_revision"]
    await decision(client, url, fact, "REOPEN")
    withdrawn = (await client.get(url + "/signals")).json()
    assert withdrawn["ready_inputs"] == 0
    assert withdrawn["input_revision"] != result["input_revision"]


async def test_source_change_invalidates_approved_input_without_mutating_fact(
    client, environment, fact_corpus
):
    _, _, database = environment
    _, url, data, table = fact_corpus
    fact = await approve(client, url, await create(client, url, data))
    before = (await client.get(url + "/signals")).json()
    async with database.transaction() as db:
        row = await db.get(EvidenceSegment, table["id"])
        row.text += "\n원문 변경"
    after = (await client.get(url + "/signals")).json()
    assert after["facts"][0]["gate"] == "SOURCE_CHANGED" and after["ready_inputs"] == 0
    assert after["input_revision"] != before["input_revision"]
    assert (await client.get(url + f"/facts/{fact['id']}")).json()["fact"]["state"] == "APPROVED"


async def test_periodless_audit_and_cross_workspace_are_withheld(client, environment, fact_corpus):
    app, _, _ = environment
    _, url, _, _ = fact_corpus
    await client.post(url + "/fact-audit-candidates")
    fact = (await client.get(url + "/facts")).json()["facts"][0]
    await approve(client, url, fact)
    response = (await client.get(url + "/signals")).json()
    assert response["facts"][0]["gate"] == "PERIOD_UNCONFIRMED"
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test", headers={"Origin": "http://test"}
    ) as other:
        await other.post("/api/v1/users")
        assert (await other.get(url + "/signals")).status_code == 404


async def test_unresolved_conflict_blocks_input_and_no_caller_can_activate_policy(
    client, fact_corpus
):
    _, url, data, _ = fact_corpus
    data.pop("amount")
    fact = await approve(client, url, await create(client, url, data))
    alternative = copy.deepcopy(data)
    alternative["statement"] = "다른 의미의 후보"
    other = await create(client, url, alternative)
    result = (await client.get(url + "/signals")).json()
    assert (
        next(f for f in result["facts"] if f["fact_id"] == fact["id"])["gate"]
        == "CONFLICT_REQUIRES_REVIEW"
    )
    assert result["ready_inputs"] == 0
    await decision(client, url, other, "REJECT")
    assert (await client.get(url + "/signals")).json()["ready_inputs"] == 1
    attempted = await client.post(
        url + "/signals", json={"rules": [definition().model_dump(mode="json")]}
    )
    assert attempted.status_code == 405


async def test_server_definition_uses_reviewed_value_period_and_reproducible_versions(
    client, environment, fact_corpus, monkeypatch
):
    _, _, database = environment
    bundle, url, data, _ = fact_corpus
    await approve(client, url, await create(client, url, data))
    monkeypatch.setattr(risk, "RULES", (definition(),))
    result = (await client.get(url + "/signals")).json()
    assert result["evaluations"][0]["result"] == "TRIGGERED"
    assert result["evaluations"][0]["event_relation"] == "CONDITION_PRESENT"
    assert result["severity_counts"] == {"CAUTION": 1}
    assert result["evaluation_status"] == "PARTIAL" and not result["model_eligible"]
    assert result == (await client.get(url + "/signals")).json()
    monkeypatch.setattr(risk, "RULES", (definition(version="fixture-v2"),))
    changed = (await client.get(url + "/signals")).json()
    assert changed["registry_revision"] != result["registry_revision"]
    assert changed["input_revision"] != result["input_revision"]


@pytest.mark.parametrize("source_period,expected", [("2025.12", "2025.12"), ("2024.12", None)])
async def test_audit_period_comes_only_from_matching_source(
    client, environment, fact_corpus, source_period, expected
):
    _, _, database = environment
    _, url, _, table = fact_corpus
    async with database.transaction() as db:
        row = await db.scalar(
            select(EvidenceSegment).where(
                EvidenceSegment.report_id == table["report_id"], EvidenceSegment.region == "audit"
            )
        )
        data = copy.deepcopy(row.data)
        data["raw"]["period"] = source_period
        row.data = data
        row.text += "\nperiod: " + source_period
    await client.post(url + "/fact-audit-candidates")
    facts = (await client.get(url + "/facts")).json()["facts"]
    assert all(f["data"]["period"] == expected for f in facts)
    assert all(f["validation"]["status"] == "CITATIONS_VALID" for f in facts)
    assert all(
        any(c["field"] == "period" for c in f["data"]["citations"]) == bool(expected) for f in facts
    )
