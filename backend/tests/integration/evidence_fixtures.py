"""Shared public-evidence fixtures, kept outside collected test modules."""

import json
from uuid import UUID, uuid4

import pytest
from sqlalchemy import delete

from app.integrations.messaging.rabbitmq import JobMessage
from app.modules.evidence.bundle_models import EvidenceDataset, EvidenceReport, EvidenceSegment
from app.modules.evidence.dump_normalize import segments
from app.modules.evidence.models import NoteStructure, SourceSegment
from app.worker.main import run_job

CORP, RECEIPT = "01214248", "20260320001416"


@pytest.fixture
async def corpus(client, environment):
    _, settings, database = environment
    await client.post("/api/v1/users")
    identity = (await client.get("/api/v1/session")).json()
    response = await client.post(
        "/api/v1/me/note-imports",
        params={"corp_code": CORP, "receipt_no": RECEIPT, "scope": "OFS", "period": "2025.12"},
        content="<html><body><p>1. 담보</p><p>담보를 제공하였습니다.</p></body></html>".encode(),
        headers={"Content-Type": "text/html"},
    )
    assert response.status_code == 202, response.text
    item = response.json()
    await run_job(
        database,
        settings,
        JobMessage(message_id=uuid4(), job_id=UUID(item["job_id"]), generation=1),
    )
    structure_id = UUID(item["structure_id"])
    dataset_id, report_id = uuid4(), uuid4()
    async with database.transaction() as db:
        revision = await db.get(NoteStructure, structure_id)
        revision.hierarchy = {"nodes": [{"id": "root", "title": "주석", "parent_id": None}]}
        await db.execute(delete(SourceSegment).where(SourceSegment.structure_id == structure_id))
        for i in range(3):
            db.add(
                SourceSegment(
                    id=uuid4(),
                    structure_id=structure_id,
                    local_id=f"b{i}",
                    ordinal=i,
                    kind="paragraph",
                    source_xpath=f"/html/body/p[{i + 1}]",
                    text=f"담보 제공 HTML {i}",
                    owner_node_id="root",
                    top_note_ids=[],
                    payload={},
                )
            )
        revision.segment_count = 3
        db.add(
            EvidenceDataset(
                id=dataset_id,
                signature=uuid4().hex * 2,
                status="READY",
                manifest={"archive_name": "fixture.dump"},
            )
        )
        await db.flush()
        db.add(
            EvidenceReport(
                id=report_id,
                dataset_id=dataset_id,
                corp_code=CORP,
                receipt_no=RECEIPT,
                period="2025.12",
                data={"corp_name": "시험회사"},
            )
        )
        await db.flush()
        for entry in segments(
            report_id,
            "note_section",
            {
                "id": "100",
                "seq": "1",
                "fs_div": "OFS",
                "note_title": "담보",
                "body": "담보 금액은 100이며 위반은 없습니다.",
                "tables": json.dumps(
                    [
                        {
                            "seq": 1,
                            "unit": "단위: 원",
                            "cells": [["구분", "당기", "전기"], ["담보", "100", "-"]],
                        }
                    ]
                ),
            },
        ):
            db.add(EvidenceSegment(**entry))
        for entry in segments(
            report_id,
            "doc_section",
            {
                "id": "101",
                "seq": "1",
                "title": "감사",
                "body": None,
                "body_skipped": "t",
                "tables": None,
            },
        ):
            db.add(EvidenceSegment(**entry))
    return structure_id, report_id, identity


async def opened(client, structures=None):
    data = {"corp_code": CORP, "receipt_no": RECEIPT, "scope": "OFS"}
    if structures is not None:
        data["structure_ids"] = [str(s) for s in structures]
    response = await client.post("/api/v1/me/evidence-bundles", json=data)
    assert response.status_code == 200, response.text
    return response.json(), "/api/v1/me/evidence-bundles/" + response.json()["bundle_id"]


@pytest.fixture
async def fact_corpus(client, environment, corpus):
    structure, report_id, _ = corpus
    _, _, database = environment
    async with database.transaction() as db:
        for entry in segments(
            report_id,
            "audit_opinion",
            {
                "id": "audit",
                "fs": "OFS",
                "corp_name": "시험회사",
                "opinion": "적정",
                "opinion_evidence": "시험회사의 재무제표는 적정하게 표시하고 있습니다.",
                "gc_evidence": "계속기업에 관한 중요한 불확실성이 존재합니다.",
            },
        ):
            db.add(EvidenceSegment(**entry))
        entries = list(
            segments(
                report_id,
                "note_section",
                {
                    "id": "money",
                    "seq": "2",
                    "note_title": "제공 담보",
                    "body": "시험회사는 담보를 제공하였습니다. 위반은 없습니다.",
                    "tables": json.dumps(
                        [
                            {
                                "caption": "시험회사 제공 담보 잔액",
                                "unit": "단위: 백만원",
                                "cells": [["구분", "당기", "전기"], ["담보 잔액", "100", "-"]],
                            }
                        ]
                    ),
                },
            )
        )
        for entry in entries:
            db.add(EvidenceSegment(**entry))
    bundle, url = await opened(client, [structure])
    table = next(e for e in entries if e["kind"] == "table")
    text = table["text"]
    fact = {
        "category": "collateral",
        "kind": "collateral",
        "statement": "제공 담보 잔액 100백만원",
        "subject": "시험회사",
        "direction": "PROVIDED",
        "period": "2025.12",
        "amount_role": "BALANCE",
        "amount": {
            "raw_value": "100",
            "unit": "백만원",
            "currency": "KRW",
            "cell": {"segment_id": str(table["id"]), "row": 1, "column": 1},
        },
        "citations": [
            {"segment_id": str(table["id"]), "field": field, "quote": text}
            for field in [
                "statement",
                "subject",
                "direction",
                "period",
                "amount_role",
                "unit",
                "amount",
            ]
        ],
    }
    return bundle, url, fact, table


async def create(client, url, data):
    response = await client.post(url + "/facts", json=data)
    assert response.status_code == 200, response.text
    return response.json()


async def decision(client, url, fact, action="APPROVE", opening=None):
    body = {
        "request_id": str(uuid4()),
        "expected_version": fact["version"],
        "decision": action,
        "reason": "원문과 필드 대조",
        "opening_id": opening,
    }
    return await client.post(url + f"/facts/{fact['id']}/reviews", json=body), body
