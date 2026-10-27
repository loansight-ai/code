import asyncio
from contextlib import suppress

import structlog
from pydantic import ValidationError

from app.core.config import Settings
from app.core.database import Database
from app.core.runtime import process_health, run
from app.integrations.messaging.rabbitmq import JobMessage, channel_and_queue, connect
from app.modules.tasks import service
from app.modules.tasks.models import Job

logger = structlog.get_logger()


async def execute(database: Database, job_id) -> dict:
    async with database.transaction() as db:
        job = await db.get(Job, job_id)
        if job.task_type != "PIPELINE_CHECK":
            raise ValueError("unsupported_task_type")
    # Real financial analysis handlers will be added in the next implementation stage.
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

    async def maintain_lease():
        while True:
            await asyncio.sleep(settings.job_lease_seconds / 3)
            if not await service.heartbeat(database, settings, message.job_id, owner):
                return

    keeper = asyncio.create_task(maintain_lease())
    try:
        result = await execute(database, message.job_id)
        await service.finish(database, message.job_id, owner, result)
    except (ConnectionError, TimeoutError):
        await service.fail(database, settings, message.job_id, owner, "temporary_failure", True)
    except Exception:
        await service.fail(database, settings, message.job_id, owner, "handler_failed", False)
    finally:
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
