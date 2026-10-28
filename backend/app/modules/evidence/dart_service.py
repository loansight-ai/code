import asyncio

from fastapi import HTTPException
from sqlalchemy import func, select, text

from app.core.storage import LocalArtifactStore
from app.modules.evidence import service as evidence
from app.modules.evidence.dart_collector import (
    COLLECTOR_VERSION,
    CollectionError,
    collect_document,
    collect_note,
)
from app.modules.evidence.dart_models import DartCollectionRequest, DartDocument, DartNote
from app.modules.evidence.parser import ADAPTER_VERSION, parser_identity
from app.modules.evidence.schemas import NoteInput
from app.modules.tasks import service as tasks
from app.modules.tasks.models import Job, Outbox, UserTask


async def submit(database, settings, identity, corp_code, report, scope, link_periods=True):
    if settings.job_max_attempts is None:
        raise HTTPException(503, "job_policy_not_configured")
    if report.withdrawn:
        raise HTTPException(422, "withdrawn_report")
    parser_version, rules_hash, _ = parser_identity()
    context = {
        "corp_code": corp_code,
        "receipt_no": report.receipt_no,
        "period": report.period,
        "scope": scope,
        "link_periods": link_periods,
    }
    key = evidence.fingerprint(
        {
            "workspace": str(identity.workspace_id),
            **context,
            "collector": COLLECTOR_VERSION,
            "parser": parser_version,
            "rules": rules_hash,
            "adapter": ADAPTER_VERSION,
        }
    )
    async with database.transaction() as db:
        await db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": int(key[:15], 16)})
        job = await db.scalar(select(Job).where(Job.fingerprint == key).with_for_update())
        reused = job is not None
        if job is None:
            job = Job(fingerprint=key, task_type="DART_COLLECT")
            db.add(job)
            await db.flush()
            db.add_all(
                [
                    DartCollectionRequest(
                        job_id=job.id, workspace_id=identity.workspace_id, context=context
                    ),
                    Outbox(job_id=job.id, generation=job.generation),
                ]
            )
            task = UserTask(workspace_id=identity.workspace_id, job_id=job.id)
            db.add(task)
            await db.flush()
            await tasks.emit(db, job, "task.created", [task])
        else:
            task = await db.scalar(
                select(UserTask).where(
                    UserTask.job_id == job.id, UserTask.workspace_id == identity.workspace_id
                )
            )
        return {**tasks.task_payload(task, job), "reused": reused}


async def ensure_source(database, settings, context):
    receipt_no, scope = context["receipt_no"], context["scope"]
    store = LocalArtifactStore(settings.artifact_root)
    key = evidence.fingerprint({"dart-document": receipt_no})
    async with database.transaction() as db:
        await db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": int(key[:15], 16)})
        document = await db.get(DartDocument, receipt_no)
        if document and document.corp_code != context["corp_code"]:
            raise CollectionError("dart_company_mismatch")
        if document is None:
            if not settings.open_dart_api_key:
                raise CollectionError("dart_api_key_missing")
            values = await asyncio.to_thread(
                collect_document,
                store,
                settings.open_dart_api_key.get_secret_value(),
                receipt_no,
                settings.dart_document_max_bytes,
            )
            document = DartDocument(receipt_no=receipt_no, corp_code=context["corp_code"], **values)
            db.add(document)
            await db.flush()
        note = await db.scalar(
            select(DartNote).where(DartNote.receipt_no == receipt_no, DartNote.scope == scope)
        )
        if note is None:
            locator = document.locators.get(scope)
            if locator is None:
                raise CollectionError("dart_note_scope_missing")
            values = await asyncio.to_thread(
                collect_note, store, locator, settings.note_import_max_bytes
            )
            note = DartNote(receipt_no=receipt_no, scope=scope, **values)
            db.add(note)
            await db.flush()
        # Verify immutable cached bytes too: missing/corrupted storage is not a successful reuse.
        source = await asyncio.to_thread(store.read, note.sha256)
        await asyncio.to_thread(store.read, document.archive_sha256)
        await asyncio.to_thread(store.read, document.toc_sha256)
        for member in document.xml_files:
            await asyncio.to_thread(store.read, member["sha256"])
    return document, note, source


async def prepare(database, settings, job_id, owner):
    async with database.transaction() as db:
        request = await db.get(DartCollectionRequest, job_id)
        if request is None:
            raise CollectionError("dart_collection_request_missing")
        context, workspace_id = request.context, request.workspace_id
    document, note, source = await ensure_source(database, settings, context)
    # The existing note queue handles parsing, leases, segment storage and notifications.
    async with database.transaction() as db:
        job = await db.get(Job, job_id, with_for_update=True)
        now = await db.scalar(select(func.clock_timestamp()))
        if not job or job.status != "RUNNING" or job.owner_token != owner or job.lease_until <= now:
            raise CollectionError("execution_lease_lost")
        parsed = await evidence.submit_for_workspace(
            database,
            settings,
            workspace_id,
            source,
            NoteInput(**context, encoding=note.encoding),
            dart_note_id=note.id,
        )
    return {
        "kind": "DART_COLLECT",
        "corp_code": context["corp_code"],
        "receipt_no": context["receipt_no"],
        "scope": context["scope"],
        "period": context["period"],
        "archive_sha256": document.archive_sha256,
        "archive_bytes": document.archive_bytes,
        "xml_files": document.xml_files,
        "toc_sha256": document.toc_sha256,
        "note_sha256": note.sha256,
        "note_bytes": note.byte_length,
        "locator": note.locator,
        "note_task_id": parsed["task_id"],
        "structure_id": parsed["structure_id"],
        "financial_analysis_performed": False,
        "evidence_verified": False,
    }
