"""An initial, versioned search dictionary; matches are not verified evidence."""

from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from app.modules.evidence.models import NoteSearchRun
from app.modules.evidence.search import TOOL_VERSION, NoteSearchTools
from app.modules.evidence.search_schemas import SearchQuery

DICTIONARY_VERSION = "common-six-draft-v1"
CATEGORIES = (
    (
        "audit",
        "감사의견·계속기업",
        ["감사의견", "계속기업", "중요한 불확실성", "의견거절", "한정의견"],
        ["외부감사 관련 장", "감사보고서"],
    ),
    (
        "borrowing",
        "차입 만기·재무약정",
        ["차입금", "유동성", "만기", "재무약정", "기한이익"],
        ["유동성·조달 관련 장"],
    ),
    (
        "credit",
        "신용등급",
        ["신용등급", "회사채", "기업어음", "전자단기사채", "등급전망"],
        ["신용평가 관련 장"],
    ),
    ("collateral", "담보", ["담보", "질권", "근저당", "담보제공자산"], []),
    (
        "litigation",
        "소송·제재",
        ["소송", "피소", "제재", "과징금", "충당부채"],
        ["소송·제재 관련 장"],
    ),
    (
        "off_balance",
        "부외·후속사건",
        ["우발채무", "지급보증", "신용보강", "보고기간후사건", "후속사건"],
        ["부외거래·후속사건 관련 장"],
    ),
)


async def saved_run(db, identity, structure_id):
    # Ownership is checked even if there is no saved run.
    tools = await NoteSearchTools.owned(db, identity, structure_id)
    run = await db.scalar(
        select(NoteSearchRun).where(
            NoteSearchRun.workspace_id == identity.workspace_id,
            NoteSearchRun.structure_id == structure_id,
            NoteSearchRun.dictionary_version == DICTIONARY_VERSION,
            NoteSearchRun.tool_version == TOOL_VERSION,
        )
    )
    return tools, run


def payload(run):
    return {"run_id": str(run.id), "created_at": run.created_at.isoformat(), **run.result}


async def run_baseline(db, identity, structure_id):
    tools, existing = await saved_run(db, identity, structure_id)
    if existing:
        return payload(existing)
    items = []
    for key, title, terms, missing in CATEGORIES:
        query = SearchQuery(terms=terms, limit=5)
        found = await tools.search_note_segments(query)
        items.append(
            {
                "key": key,
                "title": title,
                "terms": terms,
                "mode": "ANY",
                "search_status": "COMPLETED",
                "candidate_status": "MATCHED" if found["total"] else "NO_MATCH",
                "total": found["total"],
                "candidates": found["candidates"],
                "truncated": found["truncated"],
                "next_offset": found["next_offset"],
                "unavailable_regions": missing,
                "review_status": "PENDING",
            }
        )
    result = {
        **tools.provenance(),
        "dictionary_version": DICTIONARY_VERSION,
        "dictionary_status": "DRAFT",
        "execution_kind": "BASELINE_KEYWORD",
        "execution_status": "COMPLETED",
        "searchable_region": "financial_statement_notes",
        "report_coverage": "PARTIAL",
        "agent_status": "NOT_RUN",
        "items": items,
    }
    # Concurrent requests publish exactly one snapshot for this version and owner.
    run_id = await db.scalar(
        insert(NoteSearchRun)
        .values(
            id=uuid4(),
            workspace_id=identity.workspace_id,
            structure_id=structure_id,
            dictionary_version=DICTIONARY_VERSION,
            tool_version=TOOL_VERSION,
            result=result,
        )
        .on_conflict_do_nothing()
        .returning(NoteSearchRun.id)
    )
    if run_id:
        return payload(await db.get(NoteSearchRun, run_id))
    _, run = await saved_run(db, identity, structure_id)
    return payload(run)
