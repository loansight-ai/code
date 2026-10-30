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
from app.modules.financial.core_assessments import with_core_assessments
from app.modules.financial.domain import (
    FORMULA_VERSION,
    MAPPING_VERSION,
    PERIODS,
    TERM_KEYS,
    amount,
    calculate,
    comparisons,
    map_facts,
    note_borrowing_summaries,
)
from app.modules.financial.models import FinancialFact, FinancialNoteWorkflow, FinancialRun
from app.modules.financial.notes import NOTE_VERSION, extract_note_candidates, supplement
from app.modules.tasks import service as tasks
from app.modules.tasks.models import Job, Outbox, UserTask


async def submit(database, settings, identity, context):
    from app.modules.financial.workflow import agent_config

    if settings.job_max_attempts is None:
        raise HTTPException(503, "job_policy_not_configured")
    key = fingerprint(
        {
            "workspace": str(identity.workspace_id),
            **context,
            "mapping": MAPPING_VERSION
            + ("+collected-v1" if context.get("source_import_id") else ""),
            "formula": FORMULA_VERSION,
            "notes": NOTE_VERSION,
            "enrichment": agent_config(settings) if context.get("enrich_notes") else None,
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
            if context.get("enrich_notes"):
                db.add(
                    FinancialNoteWorkflow(
                        run_id=run.id, stage="BASE_ANALYSIS", config=agent_config(settings)
                    )
                )
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
    structure_id: UUID | None = None
    structure_error: str | None = None


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
    if context.get("source_import_id"):
        from app.modules.financial.collected import prepare_collected

        return await prepare_collected(database, settings, run.id, context, name, industry)
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
    if note is None and (rows or context.get("enrich_notes")):
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
    structure_id, structure_error = None, None
    if context.get("enrich_notes"):
        from app.modules.evidence.schemas import NoteInput
        from app.modules.evidence.service import submit_for_workspace

        if note is None:
            structure_error = note_error or "note_source_unavailable"
        else:
            try:
                source = await asyncio.to_thread(
                    LocalArtifactStore(settings.artifact_root).read, note.sha256
                )
                item = await submit_for_workspace(
                    database,
                    settings,
                    run.workspace_id,
                    source,
                    NoteInput(
                        corp_code=context["corp_code"],
                        receipt_no=context["receipt_no"],
                        scope=context["scope"],
                        period=context["period"],
                        encoding=note.encoding,
                    ),
                    dart_note_id=note.id,
                )
                structure_id = UUID(item["structure_id"])
            except (OSError, ValueError, HTTPException):
                structure_error = "note_structure_submission_failed"
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
        "note_borrowing_summaries": note_borrowing_summaries(facts, context["lease"]),
        "availability": "AVAILABLE" if rows else "NO_DATA",
        "comparison_basis": (
            "선택한 보고서의 당기·전기·전전기 비교금액. "
            "각 기간 길이와 비교 가능성은 원문 확인 필요."
        ),
    }
    return PreparedFinancials(result, digest, structure_id, structure_error)


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
        workflow = await db.get(FinancialNoteWorkflow, run.id)
        if workflow is not None:
            workflow.structure_id = prepared.structure_id
            workflow.error_code = prepared.structure_error
            workflow.stage = "WAITING_STRUCTURE" if prepared.structure_id else "FAILED"
            if not prepared.structure_id:
                workflow.completed_at = now
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
        from app.modules.financial.workflow import payload

        workflow = await db.get(FinancialNoteWorkflow, run.id)
        enrichment = await payload(db, workflow) if workflow else None
        return {
            **tasks.task_payload(task, job),
            "analysis_run_id": str(run.id),
            "context": run.context,
            "result": with_core_assessments(
                workflow.result if workflow and workflow.result else run.result
            ),
            "note_workflow": enrichment,
        }
