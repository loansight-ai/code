import asyncio
from types import SimpleNamespace
from uuid import uuid4

from app.worker import main as worker


async def test_lost_lease_cancels_execution_without_publishing_result(monkeypatch):
    stopped = asyncio.Event()
    published = []

    async def claim(*_):
        return uuid4()

    async def heartbeat(*_):
        return False

    async def execute(*_):
        try:
            await asyncio.Event().wait()
        finally:
            stopped.set()

    async def finish(*args):
        published.append(args)

    monkeypatch.setattr(worker.service, "claim", claim)
    monkeypatch.setattr(worker.service, "heartbeat", heartbeat)
    monkeypatch.setattr(worker.service, "finish", finish)
    monkeypatch.setattr(worker, "execute", execute)
    message = SimpleNamespace(job_id=uuid4(), generation=1)
    async with asyncio.timeout(1):
        await worker.run_job(None, SimpleNamespace(job_lease_seconds=0.01), message)
    assert stopped.is_set() and not published
