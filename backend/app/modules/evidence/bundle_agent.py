"""Reuse the existing agent runtime with bundle-owned jobs and sources."""

from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import select, text

from app.modules.evidence import agent
from app.modules.evidence.bundle_models import BundleAgentRun
from app.modules.evidence.bundle_tools import BundleTools
from app.modules.evidence.service import fingerprint
from app.modules.tasks import service as tasks
from app.modules.tasks.models import Job, Outbox, UserTask


async def latest(db, identity, bundle_id):
    await BundleTools.owned(db, identity, bundle_id)
    row = (
        await db.execute(
            select(BundleAgentRun, Job)
            .join(Job)
            .where(BundleAgentRun.bundle_id == bundle_id)
            .order_by(BundleAgentRun.created_at.desc(), BundleAgentRun.id.desc())
            .limit(1)
        )
    ).first()
    if row is None:
        return None
    run, job = row
    return {
        "run_id": str(run.id),
        "status": job.status,
        "error_code": job.error_code,
        "result": job.result,
        "created_at": run.created_at.isoformat(),
    }


async def submit(database, settings, identity, bundle_id):
    if not agent.configured(settings) or settings.job_max_attempts is None:
        raise HTTPException(503, "note_agent_not_configured")
    config = {
        "provider": settings.note_agent_provider,
        "model": settings.note_agent_model,
        "prompt_version": agent.PROMPT_VERSION + "+bundle-v1",
        "output_version": agent.OUTPUT_VERSION,
        "timeout_seconds": settings.note_agent_timeout_seconds,
        "max_tool_calls": settings.note_agent_max_tool_calls,
    }
    async with database.transaction() as db:
        tools = await BundleTools.owned(db, identity, bundle_id)
        key = fingerprint({**tools.provenance(), **config})
        await db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": int(key[:15], 16)})
        row = (
            await db.execute(
                select(BundleAgentRun, Job)
                .join(Job)
                .where(BundleAgentRun.config_key == key)
                .order_by(BundleAgentRun.created_at.desc(), BundleAgentRun.id.desc())
                .limit(1)
            )
        ).first()
        if row and row[1].status not in {"FAILED", "PARTIAL_SUCCEEDED"}:
            run, job = row
            task = await db.scalar(
                select(UserTask).where(
                    UserTask.job_id == job.id, UserTask.workspace_id == identity.workspace_id
                )
            )
            reused = True
        else:
            job = Job(
                task_type="BUNDLE_AGENT",
                fingerprint=fingerprint({"key": key, "request": str(uuid4())}),
            )
            db.add(job)
            await db.flush()
            run = BundleAgentRun(bundle_id=bundle_id, job_id=job.id, config_key=key, config=config)
            task = UserTask(workspace_id=identity.workspace_id, job_id=job.id)
            db.add_all([run, task, Outbox(job_id=job.id, generation=job.generation)])
            await db.flush()
            await tasks.emit(db, job, "task.created", [task])
            reused = False
        return {**tasks.task_payload(task, job), "run_id": str(run.id), "reused": reused}
