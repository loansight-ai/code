import asyncio
from contextlib import suppress

import psycopg
import structlog
from sqlalchemy.engine import make_url

from app.core.config import Settings

logger = structlog.get_logger()


class NotificationHub:
    """One LISTEN connection per API process; DB is the durable event source."""

    def __init__(self, settings: Settings):
        self.settings = settings
        self.condition = asyncio.Condition()
        self.version = 0
        self.connected = False
        self.backend_pid: int | None = None
        self.task: asyncio.Task | None = None

    async def pulse(self) -> None:
        async with self.condition:
            self.version += 1
            self.condition.notify_all()

    async def wait(self, version: int) -> None:
        async with self.condition:
            await self.condition.wait_for(lambda: self.version != version)

    async def listen(self) -> None:
        url = make_url(self.settings.database_url.get_secret_value()).set(drivername="postgresql")
        delay = 1
        while True:
            try:
                async with await psycopg.AsyncConnection.connect(
                    url.render_as_string(hide_password=False),
                    autocommit=True,
                    connect_timeout=3,
                ) as connection:
                    await connection.execute("LISTEN task_events")
                    self.backend_pid = connection.info.backend_pid
                    self.connected = True
                    delay = 1
                    # Pulse only after LISTEN registration, then all streams replay from DB.
                    await self.pulse()
                    async for _ in connection.notifies():
                        await self.pulse()
            except (psycopg.Error, OSError):
                self.connected = False
                logger.warning("task_listener_disconnected")
                await self.pulse()
                await asyncio.sleep(delay)
                delay = min(delay * 2, 30)

    def start(self) -> None:
        self.task = asyncio.create_task(self.listen())

    async def close(self) -> None:
        if self.task:
            self.task.cancel()
            with suppress(asyncio.CancelledError):
                await self.task
