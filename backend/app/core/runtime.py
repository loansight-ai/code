import asyncio
import signal
import sys
from collections.abc import Coroutine
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from tempfile import gettempdir
from time import time

from sqlalchemy import text

from app.core.database import Database


def health_path(role: str) -> Path:
    if role not in {"worker", "relay"}:
        raise ValueError("invalid role")
    return Path(gettempdir()) / f"loansight-{role}.heartbeat"


@asynccontextmanager
async def process_health(database: Database, connection, channel, role: str):
    path = health_path(role)
    path.unlink(missing_ok=True)

    async def monitor():
        while True:
            try:
                async with asyncio.timeout(4):
                    async with database.engine.connect() as db:
                        await db.execute(text("SELECT 1"))
                    if not connection.is_closed and not channel.is_closed:
                        path.touch()
            except Exception:
                pass  # Keep the previous timestamp: healthcheck will become unhealthy.
            await asyncio.sleep(5)

    task = asyncio.create_task(monitor())
    try:
        yield
    finally:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task
        path.unlink(missing_ok=True)


def run(coroutine: Coroutine) -> None:
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

    async def supervised():
        task = asyncio.create_task(coroutine)
        loop = asyncio.get_running_loop()
        if sys.platform != "win32":
            loop.add_signal_handler(signal.SIGTERM, task.cancel)
            loop.add_signal_handler(signal.SIGINT, task.cancel)
        with suppress(asyncio.CancelledError):
            await task

    asyncio.run(supervised())


if __name__ == "__main__":
    path = health_path(sys.argv[1])
    raise SystemExit(0 if path.exists() and time() - path.stat().st_mtime < 15 else 1)
