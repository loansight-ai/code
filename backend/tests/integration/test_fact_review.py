import asyncio
import copy
import json
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.integrations.agents.runtime import AgentResponse
from app.integrations.messaging.rabbitmq import JobMessage
from app.modules.evidence import fact_extraction
from app.modules.evidence.bundle_models import EvidenceSegment
from app.modules.evidence.dump_normalize import segments
from app.modules.evidence.fact_models import EvidenceFact
from app.modules.evidence.models import SourceSegment
from app.modules.tasks.models import Job
from app.worker.main import run_job
from tests.integration.evidence_fixtures import create, decision


async def test_exposure_summary_is_owned_and_does_not_promote_pending_facts(client, fact_corpus):
    bundle, url, data, _ = fact_corpus
    await create(client, url, data)
    response = await client.get(url + "/exposure-summary")
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["bundle_id"] == bundle["bundle_id"]
    assert result["scope"] == "OFS"
    assert result["provided"]["totals"]["loan_balance"] is None
    assert result["maturity"]["debt"]["total"] is None
    assert result["litigation"]["case_count"] is None
    await client.post("/api/v1/users")
    assert (await client.get(url + "/exposure-summary")).status_code == 404


async def test_exposure_summary_revalidates_reviewed_amounts_and_source_changes(
    client, fact_corpus, environment
):
    _, url, _, original = fact_corpus
    _, _, database = environment
    entries = list(
        segments(
            original["report_id"],
            "note_section",
            {
                "id": "exposure-summary",
                "seq": "9",
                "note_title": "PF 대출보증",
                "body": "시험회사 PF 대출보증 제공 내역",
                "tables": json.dumps(
                    [
                        {
                            "caption": (
                                "시험회사는 PF 대출보증을 제공하였습니다. "
                                "사업장 수 7. 만기 2026-12-31."
                            ),
                            "unit": "단위: 백만원",
                            "cells": [
                                ["구분", "당기 대출잔액", "전기 대출잔액"],
                                ["PF 대출보증", "100", "-"],
                            ],
                        }
                    ]
                ),
            },
        )
    )
    async with database.transaction() as db:
        for entry in entries:
            db.add(EvidenceSegment(**entry))
    table = next(e for e in entries if e["kind"] == "table")
    sid = str(table["id"])
    data = {
        "category": "off_balance",
        "kind": "guarantee",
        "statement": "PF 대출보증 제공",
        "subject": "시험회사",
        "direction": "PROVIDED",
        "period": "2025.12",
        "obligation_type": "PF_GUARANTEE",
        "aggregation_level": "DETAIL",
        "project_count": 7,
        "amount_role": "LOAN_BALANCE",
        "maturity": "2026-12-31",
        "amount": {
            "raw_value": "100",
            "currency": "KRW",
            "unit": "백만원",
            "cell": {"segment_id": sid, "row": 1, "column": 1},
        },
        "citations": [
            {"segment_id": sid, "field": f, "quote": table["text"]}
            for f in [
                "statement",
                "subject",
                "direction",
                "period",
                "obligation_type",
                "aggregation_level",
                "project_count",
                "amount_role",
                "amount",
                "unit",
                "maturity",
            ]
        ],
    }
    fact = await create(client, url, data)
    assert fact["validation"]["status"] == "CITATIONS_VALID", fact["validation"]
    pending = (await client.get(url + "/exposure-summary")).json()
    assert pending["provided"]["totals"]["loan_balance"] is None
    opened = (await client.post(url + f"/facts/{fact['id']}/open")).json()
    approved, _ = await decision(client, url, fact, opening=opened["opening_id"])
    assert approved.status_code == 200, approved.text
    summary = (await client.get(url + "/exposure-summary")).json()
    assert summary["provided"]["totals"]["loan_balance"] == "100000000"
    assert summary["provided"]["rows"][0]["project_count"] == 7
    assert summary["maturity"]["obligation"]["values"]["within"] == "100000000"
    assert summary["provided"]["rows"][0]["sources"][0]["segment_id"] == sid
    async with database.transaction() as db:
        row = await db.get(EvidenceSegment, table["id"])
        row.text += "원문 변경"
        row.sha256 = "changed"
    changed = (await client.get(url + "/exposure-summary")).json()
    assert changed["provided"]["totals"]["loan_balance"] is None
    assert changed["excluded_facts"] == 1
    bad = copy.deepcopy(data)
    for cite in bad["citations"]:
        if cite["field"] == "project_count":
            cite["quote"] = "7"
    unsupported_count = await create(client, url, bad)
    assert "project_count_context_required" in [
        issue["code"] for issue in unsupported_count["validation"]["issues"]
    ]


async def test_litigation_detail_fields_require_direct_evidence(client, fact_corpus, environment):
    _, url, _, original = fact_corpus
    _, _, database = environment
    note = "보고기간 종료일 현재 소송의 결과는 합리적으로 예측할 수 없습니다."
    entries = list(
        segments(
            original["report_id"],
            "note_section",
            {
                "id": "litigation-detail",
                "seq": "10",
                "note_title": "소송 현황",
                "body": note,
                "tables": json.dumps(
                    [
                        {
                            "caption": (
                                "시험회사는 피고이며 원고는 가나다시. 소제기일 2024.03.11. "
                                "사건번호 2024가합100. 1심 진행 중."
                            ),
                            "unit": "단위: 백만원",
                            "cells": [
                                ["구분", "당기 소송가액", "전기"],
                                ["손해배상 청구", "152", "-"],
                            ],
                        }
                    ]
                ),
            },
        )
    )
    async with database.transaction() as db:
        for entry in entries:
            db.add(EvidenceSegment(**entry))
    table = next(e for e in entries if e["kind"] == "table")
    body = next(e for e in entries if e["kind"] == "text")
    sid = str(table["id"])
    data = {
        "category": "litigation",
        "kind": "litigation",
        "statement": "손해배상 청구",
        "subject": "시험회사",
        "direction": "DEFENDANT",
        "period": "2025.12",
        "aggregation_level": "DETAIL",
        "case_number": "2024가합100",
        "filing_date": "2024-03-11",
        "counterparty": "가나다시",
        "status": "1심 진행 중",
        "case_note": note,
        "amount_role": "CLAIM",
        "amount": {
            "raw_value": "152",
            "currency": "KRW",
            "unit": "백만원",
            "cell": {"segment_id": sid, "row": 1, "column": 1},
        },
        "citations": [
            {"segment_id": sid, "field": f, "quote": table["text"]}
            for f in [
                "statement",
                "subject",
                "direction",
                "period",
                "aggregation_level",
                "case_number",
                "filing_date",
                "counterparty",
                "status",
                "amount_role",
                "amount",
                "unit",
            ]
        ]
        + [{"segment_id": str(body["id"]), "field": "case_note", "quote": note}],
    }
    fact = await create(client, url, data)
    assert fact["validation"]["status"] == "CITATIONS_VALID", fact["validation"]
    opened = (await client.post(url + f"/facts/{fact['id']}/open")).json()
    approved, _ = await decision(client, url, fact, opening=opened["opening_id"])
    assert approved.status_code == 200, approved.text
    summary = (await client.get(url + "/exposure-summary")).json()["litigation"]
    case = summary["top_cases"][0]
    assert (case["filing_date"], case["plaintiff"], case["status"]) == (
        "2024-03-11",
        "가나다시",
        "1심 진행 중",
    )
    assert summary["notes"][0]["quote"] == note
    assert str(body["id"]) in {s["segment_id"] for s in summary["notes"][0]["sources"]}
    bad = copy.deepcopy(data)
    bad["filing_date"] = "2023-03-11"
    assert "filing_date_not_supported" in {
        i["code"] for i in (await create(client, url, bad))["validation"]["issues"]
    }
    bad = copy.deepcopy(data)
    for cite in bad["citations"]:
        if cite["field"] == "filing_date":
            cite["quote"] = "2024.03.11"
    assert "filing_date_context_required" in {
        i["code"] for i in (await create(client, url, bad))["validation"]["issues"]
    }


async def test_reviewed_maturity_bands_loan_period_and_explicit_absence(
    client, fact_corpus, environment
):
    _, url, _, original = fact_corpus
    _, _, database = environment
    absence_text = "당기 시험회사가 제공한 지급보증은 해당사항 없음."
    entries = list(
        segments(
            original["report_id"],
            "note_section",
            {
                "id": "maturity-ladder",
                "seq": "11",
                "note_title": "보증 만기",
                "body": absence_text,
                "tables": json.dumps(
                    [
                        {
                            "caption": "시험회사 제공 보증·조건부 의무 만기 구간 및 대출기간",
                            "unit": "단위: 백만원",
                            "cells": [
                                ["유형", "당기 대출잔액", "만기 구간", "대출기간"],
                                ["PF 대출보증", "100", "3개월 이내", "-"],
                                ["자금보충", "50", "-", "25.04~28.02"],
                            ],
                        }
                    ]
                ),
            },
        )
    )
    async with database.transaction() as db:
        for entry in entries:
            db.add(EvidenceSegment(**entry))
    body = next(e for e in entries if e["kind"] == "text")
    table = next(e for e in entries if e["kind"] == "table")
    negative = await create(
        client,
        url,
        {
            "category": "off_balance",
            "kind": "guarantee",
            "statement": "제공 지급보증 없음",
            "subject": "시험회사",
            "direction": "PROVIDED",
            "period": "2025.12",
            "detection": "EXPLICITLY_NONE",
            "citations": [
                {"segment_id": str(body["id"]), "field": f, "quote": absence_text}
                for f in ["statement", "subject", "direction", "period", "absence"]
            ],
        },
    )
    opening = (await client.post(url + f"/facts/{negative['id']}/open")).json()
    approved, _ = await decision(client, url, negative, opening=opening["opening_id"])
    assert approved.status_code == 200, approved.text
    negative = approved.json()["fact"]
    absence = (await client.get(url + "/exposure-summary")).json()["maturity_ladder"]
    assert absence["state"] == "EXPLICIT_NONE" and absence["total"] is None
    assert absence["absence_quotes"][0]["quote"] == absence_text
    for row, value, kind, extra in [
        (1, "100", "PF_GUARANTEE", {"maturity_bucket": "M3"}),
        (2, "50", "FUNDING_SUPPORT", {"loan_period": "25.04~28.02"}),
    ]:
        fields = [
            "statement",
            "subject",
            "direction",
            "period",
            "obligation_type",
            "aggregation_level",
            "amount_role",
            "amount",
            "unit",
            *extra,
        ]
        candidate = await create(
            client,
            url,
            {
                "category": "off_balance",
                "kind": "guarantee",
                "statement": table["data"]["table"]["cells"][row][0],
                "subject": "시험회사",
                "direction": "PROVIDED",
                "period": "2025.12",
                "obligation_type": kind,
                "aggregation_level": "DETAIL",
                "amount_role": "LOAN_BALANCE",
                **extra,
                "amount": {
                    "raw_value": value,
                    "currency": "KRW",
                    "unit": "백만원",
                    "cell": {"segment_id": str(table["id"]), "row": row, "column": 1},
                },
                "citations": [
                    {"segment_id": str(table["id"]), "field": f, "quote": table["text"]}
                    for f in fields
                ],
            },
        )
        assert candidate["validation"]["status"] == "CITATIONS_VALID", candidate["validation"]
        opened = (await client.post(url + f"/facts/{candidate['id']}/open")).json()
        response, _ = await decision(client, url, candidate, opening=opened["opening_id"])
        assert response.status_code == 200, response.text
    conflict = (await client.get(url + "/exposure-summary")).json()["maturity_ladder"]
    assert conflict["state"] == "CONFLICT" and conflict["within_percent"] is None
    rejected, _ = await decision(client, url, negative, "REJECT")
    assert rejected.status_code == 200, rejected.text
    summary = (await client.get(url + "/exposure-summary")).json()
    ladder = summary["maturity_ladder"]
    assert ladder["state"] == "RECALCULATED"
    assert ladder["total"] == summary["provided"]["totals"]["loan_balance"] == "150000000"
    assert (
        ladder["within_amount"]
        == summary["maturity"]["obligation"]["values"]["within"]
        == "100000000"
    )
    assert ladder["bins"][4]["amount"] == "50000000"


async def test_review_open_required_audited_idempotent_and_revision(client, fact_corpus):
    _, url, data, _ = fact_corpus
    fact = await create(client, url, data)
    assert fact["state"] == "PENDING" and not fact["model_eligible"]
    assert fact["validation"]["normalized_amount"] == "100000000"
    assert fact["validation"]["status"] == "CITATIONS_VALID"
    assert (await decision(client, url, fact))[0].status_code == 409
    opened = (await client.post(url + f"/facts/{fact['id']}/open")).json()
    assert opened["contexts"][0]["citations"][0]["quote"] == data["citations"][0]["quote"]
    approved, body = await decision(client, url, fact, opening=opened["opening_id"])
    assert approved.status_code == 200, approved.text
    assert approved.json()["fact"]["state"] == "APPROVED"
    assert not approved.json()["fact"]["model_eligible"]
    retry = await client.post(url + f"/facts/{fact['id']}/reviews", json=body)
    assert retry.status_code == 200 and retry.json()["reused"]
    assert (await decision(client, url, fact, "REJECT"))[0].status_code == 409
    old = approved.json()["fact"]
    edited = copy.deepcopy(old["data"])
    edited["statement"] = "원문 확인한 담보 잔액"
    revision = await client.post(
        url + f"/facts/{fact['id']}/revisions",
        json={"expected_version": old["version"], "reason": "표현 수정", "fact": edited},
    )
    assert revision.status_code == 200, revision.text
    new = revision.json()
    assert new["state"] == "PENDING" and new["revision"] == 2 and new["supersedes_id"] == old["id"]
    history = (await client.get(url + f"/facts/{old['id']}")).json()
    assert history["fact"]["state"] == "SUPERSEDED"
    assert history["fact"]["data"] == old["data"]
    assert [r["decision"] for r in history["reviews"]] == ["APPROVE", "SUPERSEDE"]
    assert [r["id"] for r in history["revisions"]] == [old["id"], new["id"]]
    assert (await decision(client, url, new, opening=opened["opening_id"]))[0].status_code == 409
    rejected = (await decision(client, url, new, "REJECT"))[0]
    assert rejected.status_code == 200
    reopened = (await decision(client, url, rejected.json()["fact"], "REOPEN"))[0]
    assert reopened.status_code == 200 and reopened.json()["fact"]["state"] == "PENDING"


@pytest.mark.parametrize(
    "change,code",
    [
        ({"amount.raw_value": "1000"}, "amount_cell_mismatch"),
        ({"amount.raw_value": "-"}, "numeric_value_required"),
        ({"amount.unit": "원"}, "unit_not_verified"),
        ({"amount.currency": "USD"}, "currency_not_verified"),
        ({"period": "2024.12"}, "amount_column_period_unverified"),
        ({"direction": "RECEIVED"}, "direction_not_supported"),
        ({"detection": "EXPLICITLY_NONE"}, "explicit_negative_required"),
    ],
)
async def test_money_and_absence_fail_closed(client, fact_corpus, change, code):
    _, url, data, _ = fact_corpus
    for key, value in change.items():
        if "." in key:
            a, b = key.split(".")
            data[a][b] = value
        else:
            data[key] = value
    fact = await create(client, url, data)
    assert fact["validation"]["status"] == "BLOCKED"
    assert code in [i["code"] for i in fact["validation"]["issues"]]
    opened = (await client.post(url + f"/facts/{fact['id']}/open")).json()
    assert (await decision(client, url, fact, opening=opened["opening_id"]))[0].status_code == 422


async def test_source_mutation_and_workspace_receipts_cannot_approve(
    client, environment, fact_corpus
):
    app, _, database = environment
    _, url, data, table = fact_corpus
    fact = await create(client, url, data)
    opening = (await client.post(url + f"/facts/{fact['id']}/open")).json()
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test", headers={"Origin": "http://test"}
    ) as other:
        await other.post("/api/v1/users")
        assert (await other.get(url + "/facts")).status_code == 404
        assert (await other.post(url + f"/facts/{fact['id']}/open")).status_code == 404
    async with database.transaction() as db:
        row = await db.get(EvidenceSegment, table["id"])
        row.text += "\n추가 공시"
    assert (await decision(client, url, fact, opening=opening["opening_id"]))[0].json()[
        "detail"
    ] == "fact_source_changed"
    newer = (await client.post(url + f"/facts/{fact['id']}/open")).json()
    assert (await decision(client, url, fact, opening=newer["opening_id"]))[0].status_code == 409


async def test_audit_seed_is_pending_idempotent_and_html_fact_combines(
    client, environment, fact_corpus
):
    _, url, _, _ = fact_corpus
    first = await client.post(url + "/fact-audit-candidates")
    assert first.status_code == 200 and first.json()["candidate_count"] == 2
    assert (await client.post(url + "/fact-audit-candidates")).json() == first.json()
    rows = (await client.get(url + "/facts")).json()["facts"]
    assert len(rows) == 2 and all(f["state"] == "PENDING" for f in rows)
    assert all(f["validation"]["status"] == "CITATIONS_VALID" for f in rows)
    _, _, database = environment
    async with database.transaction() as db:
        segment = await db.scalar(select(SourceSegment).limit(1))
        sid, text = str(segment.id), segment.text
    data = {
        "category": "collateral",
        "kind": "collateral",
        "statement": "담보 HTML 기재",
        "subject": "담보",
        "citations": [
            {"segment_id": sid, "quote": text, "field": k} for k in ["statement", "subject"]
        ],
    }
    html_fact = await create(client, url, data)
    assert html_fact["validation"]["status"] == "CITATIONS_VALID"
    context = await client.get(url + "/fact-sources", params={"segment_id": sid})
    assert context.status_code == 200, context.text
    assert context.json()["origin"] == "html" and context.json()["source_url"]
    assert len((await client.get(url + "/facts")).json()["facts"]) == 3


async def test_conflicting_approvals_are_serialized(client, fact_corpus):
    _, url, data, _ = fact_corpus
    data.pop("amount")
    data["citations"] = [c for c in data["citations"] if c["field"] in ["statement", "subject"]]
    data["direction"], data["period"], data["amount_role"] = "UNKNOWN", None, "UNKNOWN"
    first = await create(client, url, data)
    data["statement"] = "다른 의미의 후보"
    second = await create(client, url, data)
    a, b = [
        (await client.post(url + f"/facts/{f['id']}/open")).json()["opening_id"]
        for f in [first, second]
    ]
    results = await asyncio.gather(
        decision(client, url, first, opening=a), decision(client, url, second, opening=b)
    )
    assert sorted(r[0].status_code for r in results) == [200, 409]
    blocked = next(r[0] for r in results if r[0].status_code == 409)
    assert blocked.json()["detail"] == "approved_fact_conflict"


@pytest.mark.parametrize(
    "read_source,expected", [(True, "SUCCEEDED"), (False, "PARTIAL_SUCCEEDED")]
)
async def test_worker_extracts_only_read_candidates_and_never_approves(
    client, environment, fact_corpus, monkeypatch, read_source, expected
):
    _, settings, database = environment
    _, url, data, table = fact_corpus
    settings.note_agent_provider = "codex"
    settings.codex_home = settings.artifact_root
    settings.note_agent_timeout_seconds = 10
    settings.note_agent_max_tool_calls = 20

    class Runtime:
        async def run(self, prompt, definitions, call, output_schema):
            for category in [
                "audit",
                "borrowing",
                "credit",
                "collateral",
                "litigation",
                "off_balance",
            ]:
                await call("search_note_segments", {"terms": ["담보"], "category_key": category})
            if read_source:
                await call("read_fact_source", {"segment_id": str(table["id"])})
            return AgentResponse(
                json.dumps(
                    {
                        "facts": [data],
                        "searched_categories": [
                            "audit",
                            "borrowing",
                            "credit",
                            "collateral",
                            "litigation",
                            "off_balance",
                        ],
                        "limitations": "명시된 표만 추출",
                    }
                ),
                "fake-model",
                "test-thread",
            )

    monkeypatch.setattr(fact_extraction, "runtime_for", lambda *_: Runtime())
    start = await client.post(url + "/fact-extraction")
    assert start.status_code == 202, start.text
    assert (await client.post(url + "/fact-extraction")).json()["reused"]
    job_id = UUID(start.json()["job_id"])
    await run_job(database, settings, JobMessage(message_id=uuid4(), job_id=job_id, generation=1))
    async with database.transaction() as db:
        job = await db.get(Job, job_id)
        assert job.status == expected, job.error_code
        assert job.result["candidate_count"] == int(read_source)
        rows = list((await db.scalars(select(EvidenceFact))).all())
        assert all(r.state == "PENDING" for r in rows)
        if not read_source:
            assert job.result["stop_reason"] == "fact_extraction_unread_citation"


async def test_interrupted_extraction_does_not_rebill_and_stale_owner_cannot_write(
    client, environment, fact_corpus, monkeypatch
):
    _, settings, database = environment
    _, url, _, _ = fact_corpus
    settings.note_agent_provider = "codex"
    settings.codex_home = settings.artifact_root
    settings.note_agent_timeout_seconds = 10
    settings.note_agent_max_tool_calls = 20
    start = await client.post(url + "/fact-extraction")
    job_id = UUID(start.json()["job_id"])
    async with database.transaction() as db:
        job = await db.get(Job, job_id)
        job.attempt = 2

    def unexpected(*_):
        raise AssertionError("interrupted extraction must not invoke the runtime")

    monkeypatch.setattr(fact_extraction, "runtime_for", unexpected)
    prepared = await fact_extraction.prepare(database, settings, job_id)
    assert prepared.result["stop_reason"] == "fact_extraction_interrupted_no_auto_retry"
    assert not prepared.candidates
    assert not await fact_extraction.complete(database, job_id, uuid4(), prepared)
    async with database.transaction() as db:
        assert await db.scalar(select(EvidenceFact.id).limit(1)) is None


async def test_hidden_amount_column_cannot_be_approved(client, environment, fact_corpus):
    _, _, database = environment
    _, url, data, table = fact_corpus
    async with database.transaction() as db:
        row = await db.get(EvidenceSegment, table["id"])
        value = copy.deepcopy(row.data)
        value["table"]["cells"] = [["당기"] * 42, ["100"] * 42]
        row.data = value
    data["amount"]["cell"]["column"] = 41
    fact = await create(client, url, data)
    assert [i["code"] for i in fact["validation"]["issues"]] == ["cell_not_reviewable"]
