import asyncio
from contextlib import suppress

import structlog
from pydantic import ValidationError
from sqlalchemy.exc import SQLAlchemyError

from app.core.config import Settings
from app.core.database import Database
from app.core.runtime import process_health, run
from app.integrations.agents.runtime import AgentError
from app.integrations.messaging.rabbitmq import JobMessage, channel_and_queue, connect
from app.modules.evidence import agent as evidence_agent
from app.modules.evidence import dart_service
from app.modules.evidence import service as evidence
from app.modules.evidence.dart_collector import CollectionError
from app.modules.evidence.parser import PreparedNotes
from app.modules.financial import enrichment
from app.modules.financial import service as financial
from app.modules.financial.enrichment import PreparedEnrichment
from app.modules.financial.service import PreparedFinancials
from app.modules.tasks import service
from app.modules.tasks.models import Job

logger = structlog.get_logger()


async def execute(
    database: Database, job_id, settings: Settings | None = None
) -> dict | PreparedNotes | PreparedFinancials | PreparedEnrichment:
    async with database.transaction() as db:
        job = await db.get(Job, job_id)
        task_type = job.task_type
    if task_type == "NOTE_STRUCTURE" and settings is not None:
        return await evidence.prepare(database, settings, job_id)
    if task_type == "DART_COLLECT" and settings is not None:
        return await dart_service.prepare(database, settings, job_id, job.owner_token)
    if task_type == "NOTE_AGENT" and settings is not None:
        return await evidence_agent.prepare(database, settings, job_id)
    if task_type == "FINANCIAL_ANALYSIS" and settings is not None:
        return await financial.prepare(database, settings, job_id)
    if task_type == "FINANCIAL_NOTE_ENRICHMENT" and settings is not None:
        return await enrichment.prepare(database, settings, job_id)
    if task_type != "PIPELINE_CHECK":
        raise ValueError("unsupported_task_type")
    return {
        "kind": "PIPELINE_CHECK",
        "transport": "outbox-rabbitmq-worker",
        "financial_analysis_performed": False,
    }


async def run_job(database: Database, settings: Settings, message: JobMessage) -> None:
    owner = await service.claim(database, settings, message.job_id, message.generation)
    if owner is None:
        # A live owner or a completed/stale generation exists. Lease recovery is Relay's job.
        return

    execution = asyncio.create_task(execute(database, message.job_id, settings))
    lease_lost = False

    async def maintain_lease():
        nonlocal lease_lost
        while True:
            await asyncio.sleep(settings.job_lease_seconds / 3)
            if not await service.heartbeat(database, settings, message.job_id, owner):
                lease_lost = True
                execution.cancel()
                return

    keeper = asyncio.create_task(maintain_lease())
    try:
        result = await execution
        if isinstance(result, PreparedNotes):
            await evidence.complete(database, message.job_id, owner, result)
        elif isinstance(result, PreparedFinancials):
            await financial.complete(database, message.job_id, owner, result)
        elif isinstance(result, PreparedEnrichment):
            await enrichment.complete(database, message.job_id, owner, result)
        else:
            await service.finish(database, message.job_id, owner, result)
    except asyncio.CancelledError:
        if not lease_lost:
            raise
    except AgentError as failure:
        await service.fail(database, settings, message.job_id, owner, failure.code, False)
    except CollectionError as failure:
        await service.fail(
            database, settings, message.job_id, owner, failure.code, failure.retryable
        )
    except (ConnectionError, TimeoutError, OSError, SQLAlchemyError):
        await service.fail(database, settings, message.job_id, owner, "temporary_failure", True)
    except Exception:
        await service.fail(database, settings, message.job_id, owner, "handler_failed", False)
    finally:
        execution.cancel()
        await asyncio.gather(execution, return_exceptions=True)
        keeper.cancel()
        with suppress(asyncio.CancelledError):
            await keeper


async def process_delivery(database: Database, settings: Settings, incoming) -> None:
    try:
        message = JobMessage.model_validate_json(incoming.body)
        if incoming.message_id != str(message.message_id):
            raise ValueError("message_id_mismatch")
    except (ValidationError, ValueError):
        await incoming.reject(requeue=False)
        return
    try:
        await run_job(database, settings, message)
    except Exception:
        # Leave unacked on transport/DB failure; channel close makes it redeliverable.
        logger.warning("worker_processing_interrupted", job_id=str(message.job_id))
        await asyncio.sleep(settings.retry_delay_seconds)
        raise
    async with database.transaction() as db:
        job = await db.get(Job, message.job_id)
        failed = job is not None and job.status == "FAILED"
    if failed:
        await incoming.reject(requeue=False)
    else:
        await incoming.ack()


async def main() -> None:
    settings = Settings()
    if settings.job_max_attempts is None:
        raise RuntimeError("job_max_attempts must be configured")
    database = Database(settings)
    try:
        async with await connect(settings) as connection:
            channel, queue = await channel_and_queue(connection, settings)
            async with (
                process_health(database, connection, channel, "worker"),
                queue.iterator() as messages,
            ):
                async for incoming in messages:
                    await process_delivery(database, settings, incoming)
    finally:
        await database.close()


if __name__ == "__main__":
    run(main())
