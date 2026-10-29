import hashlib
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.database import Database
from app.modules.identity.models import Workspace
from app.modules.identity.service import Identity
from app.modules.tasks.models import Job, Outbox, TaskEvent, UserTask

TERMINAL = {"SUCCEEDED", "PARTIAL_SUCCEEDED", "FAILED"}


def cursor(workspace: Workspace, sequence: int | None = None) -> str:
    return f"{workspace.stream_id}:{workspace.event_seq if sequence is None else sequence}"


def parse_cursor(value: str, workspace: Workspace) -> int | None:
    try:
        stream, seq = value.split(":")
        sequence = int(seq)
        if UUID(stream) != workspace.stream_id or not 0 <= sequence <= workspace.event_seq:
            return None
        return sequence
    except (ValueError, TypeError):
        return None


def task_payload(task: UserTask, job: Job) -> dict:
    return {
        "task_id": str(task.id),
        "task_type": job.task_type,
        "job_id": str(job.id),
        "analysis_run_id": None,
        "status": job.status,
        "stage": job.stage,
        "state_version": job.state_version,
        "attempt": job.attempt,
        "error_code": job.error_code,
        "occurred_at": job.updated_at.isoformat(),
        "acknowledged": task.acknowledged_version == job.state_version,
    }


async def emit(
    db: AsyncSession, job: Job, event_type: str, tasks: list[UserTask] | None = None
) -> None:
    if tasks is None:
        tasks = list((await db.scalars(select(UserTask).where(UserTask.job_id == job.id))).all())
    # Every path locks Job -> Workspace, and multiple Workspaces in UUID order.
    for task in sorted(tasks, key=lambda item: str(item.workspace_id)):
        # Serialize cursor updates without conflicting with concurrent foreign
        # key inserts that hold KEY SHARE on this same Workspace row.
        workspace = await db.get(Workspace, task.workspace_id, with_for_update={"key_share": True})
        workspace.event_seq += 1
        payload = task_payload(task, job)
        payload["occurred_at"] = datetime.now(UTC).isoformat()
        db.add(
            TaskEvent(
                workspace_id=workspace.id,
                sequence=workspace.event_seq,
                event_type=event_type,
                payload=payload,
            )
        )
        await db.flush()
        await db.execute(
            text("SELECT pg_notify('task_events', :scope)"), {"scope": str(workspace.id)}
        )


async def create_check(
    database: Database, settings: Settings, identity: Identity, check_key: UUID, shared: bool
) -> dict:
    if settings.job_max_attempts is None:
        raise HTTPException(503, "job_policy_not_configured")
    scope = "shared" if shared else str(identity.workspace_id)
    fingerprint = hashlib.sha256(f"pipeline-check:v1:{scope}:{check_key}".encode()).hexdigest()
    async with database.transaction() as db:
        await db.execute(
            text("SELECT pg_advisory_xact_lock(:key)"), {"key": int(fingerprint[:15], 16)}
        )
        job = await db.scalar(select(Job).where(Job.fingerprint == fingerprint).with_for_update())
        reused = job is not None
        if job is None:
            job = Job(fingerprint=fingerprint, task_type="PIPELINE_CHECK")
            db.add(job)
            await db.flush()
            db.add(Outbox(job_id=job.id, generation=job.generation))
        task = await db.scalar(
            select(UserTask).where(
                UserTask.workspace_id == identity.workspace_id,
                UserTask.job_id == job.id,
            )
        )
        if task is None:
            task = UserTask(workspace_id=identity.workspace_id, job_id=job.id)
            db.add(task)
            await db.flush()
            await emit(db, job, "task.created", [task])
        return {**task_payload(task, job), "reused": reused}


async def snapshot(database: Database, identity: Identity) -> dict:
    async with database.transaction() as db:
        # Locks serialize cursor and snapshot against every event commit.
        workspace = await db.get(Workspace, identity.workspace_id, with_for_update=True)
        rows = (
            await db.execute(
                select(UserTask, Job)
                .join(Job)
                .where(
                    UserTask.workspace_id == identity.workspace_id,
                    or_(
                        Job.status.not_in(TERMINAL),
                        UserTask.acknowledged_version.is_(None),
                        UserTask.acknowledged_version != Job.state_version,
                    ),
                )
                .order_by(Job.created_at, UserTask.id)
            )
        ).all()
        return {
            "tasks": [task_payload(task, job) for task, job in rows],
            "event_cursor": cursor(workspace),
        }


async def owned_task(db: AsyncSession, identity: Identity, task_id: UUID) -> tuple[UserTask, Job]:
    task = await db.scalar(
        select(UserTask).where(
            UserTask.id == task_id,
            UserTask.workspace_id == identity.workspace_id,
        )
    )
    if task is None:
        raise HTTPException(404, "task_not_found")
    job = await db.get(Job, task.job_id, with_for_update=True)
    # A concurrent acknowledgement may have committed while this request waited for Job.
    await db.refresh(task)
    return task, job


async def acknowledge(database: Database, identity: Identity, task_id: UUID, version: int) -> dict:
    async with database.transaction() as db:
        task, job = await owned_task(db, identity, task_id)
        if job.status not in TERMINAL or job.state_version != version:
            raise HTTPException(409, "terminal_version_conflict")
        if task.acknowledged_version != version:
            task.acknowledged_version = version
            await emit(db, job, "task.acknowledged", [task])
        return task_payload(task, job)


async def read_events(
    database: Database, identity: Identity, after: str, limit: int
) -> list | None:
    async with database.transaction() as db:
        workspace = await db.get(Workspace, identity.workspace_id)
        sequence = parse_cursor(after, workspace)
        if sequence is None:
            return None
        events = (
            await db.scalars(
                select(TaskEvent)
                .where(
                    TaskEvent.workspace_id == identity.workspace_id,
                    TaskEvent.sequence > sequence,
                )
                .order_by(TaskEvent.sequence)
                .limit(limit + 1)
            )
        ).all()
        # Bounded replay and slow-client resynchronization, without a growing in-memory queue.
        if len(events) > limit:
            return None
        return [
            {
                "id": cursor(workspace, event.sequence),
                "event": event.event_type,
                "data": event.payload,
            }
            for event in events
        ]


async def claim(
    database: Database, settings: Settings, job_id: UUID, generation: int
) -> UUID | None:
    async with database.transaction() as db:
        job = await db.get(Job, job_id, with_for_update=True)
        if not job or job.generation != generation or job.status not in {"QUEUED", "RETRY_WAIT"}:
            return None
        now = await db.scalar(select(func.now()))
        job.owner_token = uuid4()
        job.attempt += 1
        job.status = "RUNNING"
        job.stage = (
            job.task_type
            if job.task_type
            in {
                "NOTE_STRUCTURE",
                "DART_COLLECT",
                "NOTE_AGENT",
                "FINANCIAL_ANALYSIS",
                "FINANCIAL_NOTE_ENRICHMENT",
            }
            else "DISPATCH"
        )
        job.state_version += 1
        job.updated_at, job.heartbeat_at = now, now
        job.lease_until = now + timedelta(seconds=settings.job_lease_seconds)
        await emit(db, job, "task.updated")
        return job.owner_token


async def heartbeat(database: Database, settings: Settings, job_id: UUID, owner: UUID) -> bool:
    async with database.transaction() as db:
        job = await db.get(Job, job_id, with_for_update=True)
        now = await db.scalar(select(func.now()))
        if not job or job.status != "RUNNING" or job.owner_token != owner or job.lease_until <= now:
            return False
        job.heartbeat_at = now
        job.lease_until = now + timedelta(seconds=settings.job_lease_seconds)
        return True


async def finish(database: Database, job_id: UUID, owner: UUID, result: dict) -> bool:
    async with database.transaction() as db:
        job = await db.get(Job, job_id, with_for_update=True)
        now = await db.scalar(select(func.now()))
        if not job or job.owner_token != owner or job.status != "RUNNING" or job.lease_until <= now:
            return False
        await complete_job(db, job, result)
        return True


async def complete_job(db: AsyncSession, job: Job, result: dict) -> None:
    """Caller must hold the Job lock and validate the active execution lease."""
    partial = (
        result.get("kind") in {"NOTE_AGENT", "FINANCIAL_NOTE_ENRICHMENT"}
        and result.get("execution_status") != "COMPLETED"
    )
    partial = partial or (
        result.get("kind") == "FINANCIAL_ANALYSIS" and result.get("availability") == "NO_DATA"
    )
    job.status, job.stage = "PARTIAL_SUCCEEDED" if partial else "SUCCEEDED", "COMPLETED"
    job.result, job.error_code = result, None
    job.owner_token, job.lease_until = None, None
    job.state_version += 1
    job.updated_at = await db.scalar(select(func.now()))
    await emit(db, job, "task.completed")


async def retry_or_fail(
    db: AsyncSession, settings: Settings, job: Job, error: str, retryable: bool
) -> None:
    if settings.job_max_attempts is None:
        raise RuntimeError("job_max_attempts must be configured")
    job.owner_token, job.lease_until = None, None
    job.error_code = error
    job.state_version += 1
    job.updated_at = datetime.now(UTC)
    if retryable and job.attempt < settings.job_max_attempts:
        job.status, job.stage = "RETRY_WAIT", "RETRY_WAIT"
        job.generation += 1
        delay = settings.retry_delay_seconds * (2 ** min(job.attempt - 1, 8))
        db.add(
            Outbox(
                job_id=job.id,
                generation=job.generation,
                available_at=datetime.now(UTC) + timedelta(seconds=delay),
            )
        )
        await emit(db, job, "task.updated")
    else:
        job.status, job.stage = "FAILED", "FAILED"
        await emit(db, job, "task.failed")


async def fail(
    database: Database, settings: Settings, job_id: UUID, owner: UUID, error: str, retryable: bool
) -> bool:
    async with database.transaction() as db:
        job = await db.get(Job, job_id, with_for_update=True)
        now = await db.scalar(select(func.now()))
        if not job or job.owner_token != owner or job.status != "RUNNING" or job.lease_until <= now:
            return False
        await retry_or_fail(db, settings, job, error, retryable)
        return True


async def recover_expired(database: Database, settings: Settings) -> int:
    recovered = 0
    for _ in range(50):
        # Commit one job at a time so workspace locks never span different job lock orders.
        async with database.transaction() as db:
            job = await db.scalar(
                select(Job)
                .where(
                    Job.status == "RUNNING",
                    Job.lease_until <= func.now(),
                )
                .order_by(Job.id)
                .limit(1)
                .with_for_update(skip_locked=True)
            )
            if job is None:
                break
            await retry_or_fail(db, settings, job, "lease_expired", True)
            recovered += 1
    return recovered
