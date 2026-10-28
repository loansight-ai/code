import asyncio
import hashlib
import json
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, insert, select, text

from app.core.config import Settings
from app.core.database import Database
from app.core.storage import LocalArtifactStore
from app.modules.evidence.models import NoteStructure, SourceArtifact, SourceSegment
from app.modules.evidence.parser import (
    ADAPTER_VERSION,
    PreparedNotes,
    parse_notes,
    parser_identity,
)
from app.modules.evidence.schemas import NoteInput
from app.modules.identity.service import Identity
from app.modules.tasks import service as tasks
from app.modules.tasks.models import Job, Outbox, UserTask


def fingerprint(value: dict) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


async def submit(
    database: Database, settings: Settings, identity: Identity, source: bytes, context: NoteInput
) -> dict:
    return await submit_for_workspace(database, settings, identity.workspace_id, source, context)


async def submit_for_workspace(
    database: Database,
    settings: Settings,
    workspace_id: UUID,
    source: bytes,
    context: NoteInput,
    *,
    dart_note_id: UUID | None = None,
) -> dict:
    if settings.job_max_attempts is None:
        raise HTTPException(503, "job_policy_not_configured")
    try:
        source.decode(context.encoding)
    except UnicodeError:
        raise HTTPException(422, "invalid_source_encoding") from None
    if not source.strip() or source.lstrip().startswith(b"<?xml"):
        raise HTTPException(422, "note_html_required")
    digest = await asyncio.to_thread(LocalArtifactStore(settings.artifact_root).put, source)
    source_key = fingerprint(
        {
            "workspace": str(workspace_id),
            "sha256": digest,
            **context.model_dump(exclude={"link_periods"}),
            **({"dart_note_id": str(dart_note_id)} if dart_note_id else {}),
        }
    )
    parser_version, rules_hash, rules = parser_identity()
    key = fingerprint(
        {
            "source_key": source_key,
            "parser": parser_version,
            "rules": rules_hash,
            "link_periods": context.link_periods,
            "adapter": ADAPTER_VERSION,
            "profile": "dart",
        }
    )
    async with database.transaction() as db:
        # Same source, including different parser options, shares one immutable artifact.
        await db.execute(
            text("SELECT pg_advisory_xact_lock(:key)"), {"key": int(source_key[:15], 16)}
        )
        artifact = await db.scalar(
            select(SourceArtifact).where(SourceArtifact.source_key == source_key)
        )
        if artifact is None:
            artifact = SourceArtifact(
                source_key=source_key,
                workspace_id=workspace_id,
                sha256=digest,
                byte_length=len(source),
                dart_note_id=dart_note_id,
                **context.model_dump(exclude={"link_periods"}),
            )
            db.add(artifact)
            await db.flush()
        job = await db.scalar(select(Job).where(Job.fingerprint == key).with_for_update())
        reused = job is not None
        if job is None:
            job = Job(fingerprint=key, task_type="NOTE_STRUCTURE")
            db.add(job)
            await db.flush()
            revision = NoteStructure(
                artifact_id=artifact.id,
                job_id=job.id,
                parser_version=parser_version,
                adapter_version=ADAPTER_VERSION,
                rules_sha256=rules_hash,
                rules=rules,
                link_periods=context.link_periods,
            )
            db.add_all([revision, Outbox(job_id=job.id, generation=job.generation)])
            await db.flush()
            task = UserTask(workspace_id=workspace_id, job_id=job.id)
            db.add(task)
            await db.flush()
            await tasks.emit(db, job, "task.created", [task])
        else:
            revision = await db.scalar(select(NoteStructure).where(NoteStructure.job_id == job.id))
            task = await db.scalar(
                select(UserTask).where(
                    UserTask.job_id == job.id, UserTask.workspace_id == workspace_id
                )
            )
        return {
            **tasks.task_payload(task, job),
            "reused": reused,
            "structure_id": str(revision.id),
            "source_artifact_id": str(artifact.id),
        }


async def prepare(database: Database, settings: Settings, job_id: UUID) -> PreparedNotes:
    async with database.transaction() as db:
        revision = await db.scalar(select(NoteStructure).where(NoteStructure.job_id == job_id))
        if revision is None:
            raise ValueError("note_structure_missing")
        artifact = await db.get(SourceArtifact, revision.artifact_id)
    source = await asyncio.to_thread(
        LocalArtifactStore(settings.artifact_root).read, artifact.sha256
    )
    # CPU work must not block the event loop that maintains the execution lease.
    return await asyncio.to_thread(parse_notes, source, artifact, revision)


async def complete(database: Database, job_id: UUID, owner: UUID, result: PreparedNotes) -> bool:
    async with database.transaction() as db:
        job = await db.get(Job, job_id, with_for_update=True)
        now = await db.scalar(select(func.clock_timestamp()))
        if not job or job.status != "RUNNING" or job.owner_token != owner or job.lease_until <= now:
            return False
        revision = await db.scalar(select(NoteStructure).where(NoteStructure.job_id == job_id))
        if revision.hierarchy is not None:
            raise ValueError("note_structure_already_committed")
        if result.hierarchy.get("document_id") != str(revision.id):
            raise ValueError("note_structure_result_mismatch")
        await db.execute(insert(SourceSegment), result.segments)
        revision.hierarchy = result.hierarchy
        revision.segment_count = len(result.segments)
        revision.completed_at = now
        await tasks.complete_job(
            db,
            job,
            {
                "kind": "NOTE_STRUCTURE",
                "structure_id": str(revision.id),
                "source_artifact_id": str(revision.artifact_id),
                "segment_count": len(result.segments),
                "status": result.hierarchy["status"],
                "financial_analysis_performed": False,
                "evidence_verified": False,
            },
        )
        return True


async def owned_structure(db, identity: Identity, structure_id: UUID):
    row = (
        await db.execute(
            select(NoteStructure, SourceArtifact, Job)
            .join(SourceArtifact, SourceArtifact.id == NoteStructure.artifact_id)
            .join(Job, Job.id == NoteStructure.job_id)
            .where(
                NoteStructure.id == structure_id,
                SourceArtifact.workspace_id == identity.workspace_id,
            )
        )
    ).first()
    if row is None:
        raise HTTPException(404, "note_structure_not_found")
    return row


def structure_payload(revision: NoteStructure, artifact: SourceArtifact, job: Job) -> dict:
    return {
        "structure_id": str(revision.id),
        "source_artifact_id": str(artifact.id),
        "job_id": str(job.id),
        "status": job.status,
        "stage": job.stage,
        "corp_code": artifact.corp_code,
        "receipt_no": artifact.receipt_no,
        "scope": artifact.scope,
        "period": artifact.period,
        "encoding": artifact.encoding,
        "source_sha256": artifact.sha256,
        "source_bytes": artifact.byte_length,
        "dart_note_id": str(artifact.dart_note_id) if artifact.dart_note_id else None,
        "input_origin": "dart_viewer_note_html"
        if artifact.dart_note_id
        else "user_provided_note_html",
        "parser_version": revision.parser_version,
        "adapter_version": revision.adapter_version,
        "rules_sha256": revision.rules_sha256,
        "link_periods": revision.link_periods,
        "segment_count": revision.segment_count,
        "completed_at": revision.completed_at,
        "hierarchy": revision.hierarchy,
        "evidence_verified": False,
    }


def segment_payload(segment: SourceSegment) -> dict:
    return {
        "id": str(segment.id),
        "structure_id": str(segment.structure_id),
        "local_id": segment.local_id,
        "ordinal": segment.ordinal,
        "kind": segment.kind,
        "source_xpath": segment.source_xpath,
        "text": segment.text,
        "owner_node_id": segment.owner_node_id,
        "top_note_ids": segment.top_note_ids,
        "payload": segment.payload,
        "table_data": segment.table_data,
    }
