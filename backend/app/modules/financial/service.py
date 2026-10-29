import asyncio
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select, text

from app.core.storage import LocalArtifactStore
from app.modules.company.models import CompanyRecord
from app.modules.evidence.dart_collector import CollectionError
from app.modules.evidence.dart_models import DartNote
from app.modules.evidence.dart_service import ensure_source
from app.modules.evidence.service import fingerprint
from app.modules.financial.collector import download, parse_response
from app.modules.financial.domain import (
    FORMULA_VERSION,
    MAPPING_VERSION,
    PERIODS,
    TERM_KEYS,
    amount,
    calculate,
    comparisons,
    map_facts,
)
from app.modules.financial.models import FinancialFact, FinancialRun
from app.modules.financial.notes import NOTE_VERSION, extract_note_candidates, supplement
from app.modules.tasks import service as tasks
from app.modules.tasks.models import Job, Outbox, UserTask


async def submit(database, settings, identity, context):
    if settings.job_max_attempts is None:
        raise HTTPException(503, "job_policy_not_configured")
    key = fingerprint(
        {
            "workspace": str(identity.workspace_id),
            **context,
            "mapping": MAPPING_VERSION,
            "formula": FORMULA_VERSION,
            "notes": NOTE_VERSION,
        }
    )
    async with database.transaction() as db:
        await db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": int(key[:15], 16)})
        job = await db.scalar(select(Job).where(Job.fingerprint == key).with_for_update())
        reused = job is not None
        if job is None:
            job = Job(fingerprint=key, task_type="FINANCIAL_ANALYSIS")
            db.add(job)
            await db.flush()
            run = FinancialRun(workspace_id=identity.workspace_id, job_id=job.id, context=context)
            task = UserTask(workspace_id=identity.workspace_id, job_id=job.id)
            db.add_all([run, task, Outbox(job_id=job.id, generation=job.generation)])
            await db.flush()
            await tasks.emit(db, job, "task.created", [task])
        else:
            run = await db.scalar(select(FinancialRun).where(FinancialRun.job_id == job.id))
            task = await db.scalar(
                select(UserTask).where(
                    UserTask.job_id == job.id, UserTask.workspace_id == identity.workspace_id
                )
            )
        return {**tasks.task_payload(task, job), "analysis_run_id": str(run.id), "reused": reused}


@dataclass
class PreparedFinancials:
    result: dict
    source_sha256: str


async def prepare(database, settings, job_id):
    async with database.transaction() as db:
        run = await db.scalar(select(FinancialRun).where(FinancialRun.job_id == job_id))
        if run is None:
            raise CollectionError("financial_request_missing")
        context = run.context
        company = await db.get(CompanyRecord, context["corp_code"])
        name = company.corp_name if company else context["corp_code"]
        industry = company.industry if company else None
        note = await db.scalar(
            select(DartNote).where(
                DartNote.receipt_no == context["receipt_no"], DartNote.scope == context["scope"]
            )
        )
    if not settings.open_dart_api_key:
        raise CollectionError("dart_api_key_missing")
    raw = await asyncio.to_thread(download, settings.open_dart_api_key.get_secret_value(), context)
    store = LocalArtifactStore(settings.artifact_root / "financial/originals")
    digest = await asyncio.to_thread(store.put, raw)
    rows = parse_response(raw, context)
    facts = map_facts(rows)
    candidates = []
    note_state = "NOT_COLLECTED"
    note_error = None
    # Reuse the existing ZIP/XML and scope-specific HTML collector. Note
    # failures must not discard valid financial API data.
    if note is None and rows:
        try:
            _, note, _ = await ensure_source(database, settings, context)
        except CollectionError as exc:
            note_state, note_error = "FAILED", exc.code
        except (OSError, ValueError):
            note_state, note_error = "FAILED", "note_source_unavailable"
    if note is not None:
        try:
            source = await asyncio.to_thread(
                LocalArtifactStore(settings.artifact_root).read, note.sha256
            )
            candidates = await asyncio.to_thread(
                extract_note_candidates, source, note.encoding, note.sha256
            )
            facts = supplement(facts, candidates)
            note_state = "PROCESSED"
        except (OSError, ValueError):
            note_state = "FAILED"
    metrics, totals = calculate(facts, context["lease"])
    changes, bridge = comparisons(facts)
    terms = [
        {"key": p, "label": next((r.get(field) for r in rows if r.get(field)), label)}
        for p, field, label in zip(PERIODS, TERM_KEYS, ("당기", "전기", "전전기"), strict=True)
    ]
    # Persist supplementary candidates separately. Existing keyword matches are
    # not numerical facts and are never silently promoted to calculator inputs.
    result = {
        "analysis_run_id": str(run.id),
        "context": context,
        "company_name": name,
        "industry": industry,
        "source_sha256": digest,
        "source_url": f"https://dart.fss.or.kr/dsaf001/main.do?rcpNo={context['receipt_no']}",
        "collected_at": datetime.now(UTC).isoformat(),
        "mapping_version": MAPPING_VERSION,
        "formula_version": FORMULA_VERSION,
        "periods": terms,
        "facts": facts,
        "metrics": metrics,
        "changes": changes,
        "profit_bridge": bridge,
        "note_state": note_state,
        "note_error": note_error,
        "note_candidates": candidates,
        "borrowing_totals": totals,
        "availability": "AVAILABLE" if rows else "NO_DATA",
        "comparison_basis": (
            "선택한 보고서의 당기·전기·전전기 비교금액. "
            "각 기간 길이와 비교 가능성은 원문 확인 필요."
        ),
    }
    return PreparedFinancials(result, digest)


async def complete(database, job_id, owner, prepared):
    async with database.transaction() as db:
        job = await db.get(Job, job_id, with_for_update=True)
        now = await db.scalar(select(func.clock_timestamp()))
        if not job or job.status != "RUNNING" or job.owner_token != owner or job.lease_until <= now:
            return False
        run = await db.scalar(select(FinancialRun).where(FinancialRun.job_id == job_id))
        run.result = prepared.result
        run.source_sha256 = prepared.source_sha256
        run.completed_at = now
        for fact in prepared.result["facts"]:
            db.add(
                FinancialFact(
                    run_id=run.id,
                    account_key=fact["key"],
                    period=fact["period"],
                    amount=amount(fact["value"]),
                    provenance=fact,
                )
            )
        await tasks.complete_job(
            db,
            job,
            {
                "kind": "FINANCIAL_ANALYSIS",
                "analysis_run_id": str(run.id),
                "financial_analysis_performed": True,
                "availability": prepared.result["availability"],
            },
        )
        return True


async def read(database, identity, run_id: UUID):
    async with database.transaction() as db:
        run = await db.scalar(
            select(FinancialRun).where(
                FinancialRun.id == run_id, FinancialRun.workspace_id == identity.workspace_id
            )
        )
        if run is None:
            raise HTTPException(404, "financial_analysis_not_found")
        job = await db.get(Job, run.job_id)
        task = await db.scalar(
            select(UserTask).where(
                UserTask.job_id == job.id, UserTask.workspace_id == identity.workspace_id
            )
        )
        return {
            **tasks.task_payload(task, job),
            "analysis_run_id": str(run.id),
            "context": run.context,
            "result": run.result,
        }
