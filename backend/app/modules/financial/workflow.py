"""Advance persisted dependencies without occupying a worker while notes parse."""

from datetime import UTC, datetime

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import aliased

from app.modules.evidence.models import NoteStructure
from app.modules.evidence.service import fingerprint
from app.modules.financial.models import FinancialNoteCandidate, FinancialNoteWorkflow, FinancialRun
from app.modules.tasks import service as tasks
from app.modules.tasks.models import Job, Outbox, UserTask

VERSION = "financial-note-enrichment-v1"
ACTIVE = {"BASE_ANALYSIS", "WAITING_STRUCTURE", "ENRICHING"}


def agent_config(settings):
    return {
        "version": VERSION,
        "provider": settings.note_agent_provider,
        "model": settings.note_agent_model,
        "timeout_seconds": settings.note_agent_timeout_seconds,
        "max_tool_calls": settings.note_agent_max_tool_calls,
    }


async def payload(db, workflow):
    job = await db.get(Job, workflow.job_id) if workflow.job_id else None
    rows = (
        await db.scalars(
            select(FinancialNoteCandidate)
            .where(FinancialNoteCandidate.run_id == workflow.run_id)
            .order_by(
                FinancialNoteCandidate.account_key,
                FinancialNoteCandidate.period,
                FinancialNoteCandidate.id,
            )
        )
    ).all()
    return {
        "stage": workflow.stage,
        "structure_id": str(workflow.structure_id) if workflow.structure_id else None,
        "job_status": job.status if job else None,
        "error_code": workflow.error_code,
        "limitations": (job.result or {}).get("limitations") if job else None,
        "candidates": [{"id": str(row.id), "status": row.status, **row.data} for row in rows],
        "completed_at": workflow.completed_at.isoformat() if workflow.completed_at else None,
    }


async def advance(database):
    """Relay reconciles terminal dependencies, including completions before linkage.

    The workflow lock and Outbox insertion commit together. Multiple relays and
    restarts cannot schedule a second enrichment job for the same analysis.
    """
    base, structure_job, agent_job = aliased(Job), aliased(Job), aliased(Job)
    for _ in range(50):
        async with database.transaction() as db:
            workflow = await db.scalar(
                select(FinancialNoteWorkflow)
                .join(FinancialRun, FinancialRun.id == FinancialNoteWorkflow.run_id)
                .join(base, base.id == FinancialRun.job_id)
                .outerjoin(NoteStructure, NoteStructure.id == FinancialNoteWorkflow.structure_id)
                .outerjoin(structure_job, structure_job.id == NoteStructure.job_id)
                .outerjoin(agent_job, agent_job.id == FinancialNoteWorkflow.job_id)
                .where(
                    or_(
                        and_(
                            FinancialNoteWorkflow.stage == "BASE_ANALYSIS", base.status == "FAILED"
                        ),
                        and_(
                            FinancialNoteWorkflow.stage == "WAITING_STRUCTURE",
                            structure_job.status.in_(tasks.TERMINAL),
                        ),
                        and_(
                            FinancialNoteWorkflow.stage == "ENRICHING", agent_job.status == "FAILED"
                        ),
                    )
                )
                .order_by(FinancialNoteWorkflow.created_at)
                .limit(1)
                .with_for_update(of=FinancialNoteWorkflow, skip_locked=True)
            )
            if workflow is None:
                break
            if workflow.stage == "BASE_ANALYSIS":
                workflow.error_code = "financial_base_failed"
            elif workflow.stage == "ENRICHING":
                job = await db.get(Job, workflow.job_id)
                workflow.error_code = job.error_code or "financial_enrichment_failed"
            else:
                structure = await db.get(NoteStructure, workflow.structure_id)
                job = await db.get(Job, structure.job_id)
                if job.status == "SUCCEEDED" and structure.hierarchy is not None:
                    run = await db.get(FinancialRun, workflow.run_id)
                    child = Job(
                        task_type="FINANCIAL_NOTE_ENRICHMENT",
                        fingerprint=fingerprint(
                            {
                                "financial_run": str(run.id),
                                "structure": str(structure.id),
                                **workflow.config,
                            }
                        ),
                    )
                    db.add(child)
                    await db.flush()
                    task = UserTask(workspace_id=run.workspace_id, job_id=child.id)
                    db.add_all([task, Outbox(job_id=child.id, generation=child.generation)])
                    workflow.job_id, workflow.stage = child.id, "ENRICHING"
                    await db.flush()
                    await tasks.emit(db, child, "task.created", [task])
                    continue
                workflow.error_code = job.error_code or "note_structure_failed"
            workflow.stage = "FAILED"
            workflow.completed_at = datetime.now(UTC)
