import asyncio
from datetime import timedelta

import structlog
from sqlalchemy import func, select

from app.core.config import Settings
from app.core.database import Database
from app.core.runtime import process_health, run
from app.integrations.messaging.rabbitmq import JobMessage, channel_and_queue, connect, publish
from app.modules.financial.workflow import advance
from app.modules.tasks.models import Outbox
from app.modules.tasks.service import recover_expired

logger = structlog.get_logger()


async def relay_once(database: Database, settings: Settings, publisher) -> bool:
    async with database.transaction() as db:
        message = await db.scalar(
            select(Outbox)
            .where(
                Outbox.published_at.is_(None),
                Outbox.available_at <= func.now(),
            )
            .order_by(Outbox.available_at, Outbox.id)
            .with_for_update(skip_locked=True)
            .limit(1)
        )
        if message is None:
            return False
        message.publish_attempts += 1
        try:
            async with asyncio.timeout(10):
                await publisher(
                    JobMessage(
                        message_id=message.id, job_id=message.job_id, generation=message.generation
                    )
                )
        except Exception:
            # Preserve the Outbox. Logging provider exception strings could expose secrets.
            logger.warning("outbox_publish_failed", message_id=str(message.id))
            message.available_at = func.now() + timedelta(
                seconds=settings.retry_delay_seconds
                * min(2 ** min(message.publish_attempts - 1, 8), 256)
            )
        else:
            message.published_at = func.now()
        return True


async def main() -> None:
    settings = Settings()
    if settings.job_max_attempts is None:
        raise RuntimeError("job_max_attempts must be configured")
    database = Database(settings)
    try:
        while True:
            try:
                connection = await connect(settings)
                async with connection:
                    channel, _ = await channel_and_queue(connection, settings)

                    async def publisher(message: JobMessage, active_channel=channel):
                        await publish(active_channel, settings, message)

                    async with process_health(database, connection, channel, "relay"):
                        while True:
                            await recover_expired(database, settings)
                            await advance(database)
                            found = await relay_once(database, settings, publisher)
                            if not found:
                                await asyncio.sleep(settings.relay_interval_seconds)
            except (OSError, ConnectionError, TimeoutError):
                logger.warning("relay_connection_unavailable")
                await asyncio.sleep(settings.retry_delay_seconds)
    finally:
        await database.close()


if __name__ == "__main__":
    run(main())
