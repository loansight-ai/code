import asyncio
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import aio_pika
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select, text

from app.integrations.messaging.rabbitmq import JobMessage, channel_and_queue, connect, publish
from app.messaging.outbox_relay import relay_once
from app.modules.identity.service import COOKIE, authenticate
from app.modules.tasks import service
from app.modules.tasks.models import Job, Outbox, TaskEvent
from app.worker.main import process_delivery, run_job


async def new_check(client, **extra):
    response = await client.post(
        "/api/v1/me/tasks/diagnostics", json={"check_key": str(uuid4()), **extra}
    )
    assert response.status_code == 202, response.text
    return response.json()


async def message_for(database, job_id, generation=1):
    async with database.transaction() as db:
        outbox = await db.scalar(
            select(Outbox).where(
                Outbox.job_id == UUID(job_id),
                Outbox.generation == generation,
            )
        )
        return JobMessage(message_id=outbox.id, job_id=outbox.job_id, generation=outbox.generation)


async def test_atomic_creation_concurrent_dedup_and_snapshot_cursor(client, environment):
    _, _, database = environment
    await client.post("/api/v1/users")
    key = str(uuid4())
    responses = await asyncio.gather(
        *[client.post("/api/v1/me/tasks/diagnostics", json={"check_key": key}) for _ in range(5)]
    )
    assert all(response.status_code == 202 for response in responses)
    assert len({response.json()["job_id"] for response in responses}) == 1
    assert len({response.json()["task_id"] for response in responses}) == 1
    async with database.transaction() as db:
        assert await db.scalar(select(func.count()).select_from(Job)) == 1
        assert await db.scalar(select(func.count()).select_from(Outbox)) == 1
        assert await db.scalar(select(func.count()).select_from(TaskEvent)) == 1
    snapshot = (await client.get("/api/v1/me/tasks")).json()
    assert len(snapshot["tasks"]) == 1 and snapshot["event_cursor"].endswith(":1")


async def test_ownership_shared_execution_and_independent_acknowledgement(client, environment):
    app, settings, database = environment
    await client.post("/api/v1/users")
    shared_key = str(uuid4())
    first = (
        await client.post(
            "/api/v1/me/tasks/diagnostics", json={"check_key": shared_key, "shared": True}
        )
    ).json()
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test", headers={"Origin": "http://test"}
    ) as other:
        await other.post("/api/v1/users")
        second = (
            await other.post(
                "/api/v1/me/tasks/diagnostics", json={"check_key": shared_key, "shared": True}
            )
        ).json()
        assert first["job_id"] == second["job_id"] and first["task_id"] != second["task_id"]
        assert (await other.get(f"/api/v1/me/tasks/{first['task_id']}")).status_code == 404
        assert (
            await other.put(
                f"/api/v1/me/tasks/{first['task_id']}/acknowledgement", json={"state_version": 1}
            )
        ).status_code == 404
        assert (
            await client.put(
                f"/api/v1/me/tasks/{first['task_id']}/acknowledgement", json={"state_version": 1}
            )
        ).status_code == 409
        await run_job(database, settings, await message_for(database, first["job_id"]))
        completed = (await client.get(f"/api/v1/me/tasks/{first['task_id']}")).json()
        assert completed["status"] == "SUCCEEDED"
        assert completed["result"]["financial_analysis_performed"] is False
        acknowledgement = {"state_version": completed["state_version"]}
        path = f"/api/v1/me/tasks/{first['task_id']}/acknowledgement"
        acknowledgements = await asyncio.gather(
            *[client.put(path, json=acknowledgement) for _ in range(3)]
        )
        assert all(response.status_code == 200 for response in acknowledgements)
        assert (await client.put(path, json=acknowledgement)).status_code == 200
        assert (await client.get("/api/v1/me/tasks")).json()["tasks"] == []
        assert len((await other.get("/api/v1/me/tasks")).json()["tasks"]) == 1
        async with database.transaction() as db:
            assert (
                await db.scalar(
                    select(func.count())
                    .select_from(TaskEvent)
                    .where(
                        TaskEvent.event_type == "task.acknowledged",
                    )
                )
                == 1
            )


async def test_duplicate_delivery_expired_lease_and_stale_owner_fencing(client, environment):
    _, settings, database = environment
    await client.post("/api/v1/users")
    task = await new_check(client)
    job_id = UUID(task["job_id"])
    message = await message_for(database, task["job_id"])
    owner = await service.claim(database, settings, job_id, 1)
    assert owner
    assert await service.claim(database, settings, job_id, 1) is None
    async with database.transaction() as db:
        job = await db.get(Job, job_id)
        job.lease_until = datetime.now(UTC) - timedelta(seconds=1)
    assert await service.finish(database, job_id, owner, {"bad": True}) is False
    assert await service.recover_expired(database, settings) == 1
    assert await service.claim(database, settings, job_id, 1) is None
    replacement = await message_for(database, task["job_id"], 2)
    await run_job(database, settings, replacement)
    before = (await client.get(f"/api/v1/me/tasks/{task['task_id']}")).json()
    await run_job(database, settings, message)
    await run_job(database, settings, replacement)
    after = (await client.get(f"/api/v1/me/tasks/{task['task_id']}")).json()
    assert before == after and after["status"] == "SUCCEEDED"
    assert after["attempt"] == 2


async def test_retry_budget_and_failed_terminal_version(client, environment):
    _, settings, database = environment
    settings.job_max_attempts = 2
    await client.post("/api/v1/users")
    task = await new_check(client)
    job_id = UUID(task["job_id"])
    owner = await service.claim(database, settings, job_id, 1)
    assert await service.fail(database, settings, job_id, owner, "transient", True)
    second = await service.claim(database, settings, job_id, 2)
    assert await service.fail(database, settings, job_id, second, "transient", True)
    result = (await client.get(f"/api/v1/me/tasks/{task['task_id']}")).json()
    assert result["status"] == "FAILED" and result["attempt"] == 2
    async with database.transaction() as db:
        assert await db.scalar(select(func.count()).select_from(Outbox)) == 2


async def test_outbox_failure_confirm_crash_and_worker_execution(client, environment):
    _, settings, database = environment
    if settings.rabbitmq_url is None:
        pytest.skip("Set LOANSIGHT_TEST_RABBITMQ_URL for real RabbitMQ integration")
    await client.post("/api/v1/users")
    task = await new_check(client)

    async def unavailable(message):
        raise ConnectionError("broker unavailable")

    assert await relay_once(database, settings, unavailable)
    async with database.transaction() as db:
        outbox = await db.scalar(select(Outbox))
        assert outbox.published_at is None and outbox.publish_attempts == 1
        outbox.available_at = datetime.now(UTC) - timedelta(seconds=1)
    async with await connect(settings) as connection:
        channel, queue = await channel_and_queue(connection, settings)
        try:

            async def publisher(message):
                await publish(channel, settings, message)

            assert await relay_once(database, settings, publisher)
            # Simulate confirm -> Relay crash before its DB commit: duplicate publication.
            await publish(channel, settings, await message_for(database, task["job_id"]))
            for _ in range(2):
                incoming = await queue.get(timeout=5)
                await process_delivery(database, settings, incoming)
            completed = (await client.get(f"/api/v1/me/tasks/{task['task_id']}")).json()
            assert completed["status"] == "SUCCEEDED" and completed["attempt"] == 1
        finally:
            await queue.delete(if_unused=False, if_empty=False)
            await channel.queue_delete(settings.queue_name + ".dead")


async def test_replay_foreign_cursor_reset_and_logout_closes_stream(client, environment):
    app, _, database = environment
    await client.post("/api/v1/users")
    identity = await authenticate(database, client.cookies.get(COOKIE))
    before = (await client.get("/api/v1/me/tasks")).json()["event_cursor"]
    await new_check(client)
    events = await service.read_events(database, identity, before, 100)
    assert [event["event"] for event in events] == ["task.created"]
    assert await service.read_events(database, identity, str(uuid4()) + ":0", 100) is None
    await new_check(client)
    assert await service.read_events(database, identity, before, 1) is None
    # A reset stream terminates, so ASGITransport can consume it without an infinite stream.
    reset = await client.get("/api/v1/me/task-events", params={"after": str(uuid4()) + ":0"})
    assert reset.status_code == 200 and "event: reset" in reset.text
    assert reset.headers["content-type"].startswith("text/event-stream")
    assert reset.headers["x-accel-buffering"] == "no"
    # A valid Last-Event-ID must take precedence over an invalid initial query cursor.
    from starlette.requests import Request

    from app.modules.tasks.router import event_stream, stream_context

    token = client.cookies.get(COOKIE)

    async def receive():
        await asyncio.sleep(1)
        return {"type": "http.request", "body": b"", "more_body": False}

    request = Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/",
            "app": app,
            "headers": [(b"cookie", f"{COOKIE}={token}".encode())],
        },
        receive=receive,
    )
    stream = event_stream(request, identity, before)
    assert (await anext(stream)).comment == "connected"
    assert (await anext(stream)).event == "task.created"
    with_header = Request(
        {
            **request.scope,
            "headers": [
                (b"cookie", f"{COOKIE}={token}".encode()),
                (b"last-event-id", before.encode()),
            ],
        },
        receive=receive,
    )
    assert (await stream_context(with_header, identity, str(uuid4()) + ":0"))[1] == before
    await client.delete("/api/v1/session")
    assert (await anext(stream)).event == "session.expired"
    await stream.aclose()
    assert (await client.get("/api/v1/me/task-events")).status_code == 401


async def test_listener_reconnect_replays_events_from_the_disconnect_gap(client, environment):
    from starlette.requests import Request

    from app.modules.tasks.router import event_stream

    app, _, database = environment
    await client.post("/api/v1/users")
    identity = await authenticate(database, client.cookies.get(COOKIE))
    hub = app.state.notifications
    async with asyncio.timeout(5), hub.condition:
        await hub.condition.wait_for(lambda: hub.connected)
    before = (await client.get("/api/v1/me/tasks")).json()["event_cursor"]
    old_pid = hub.backend_pid
    async with database.transaction() as db:
        assert await db.scalar(text("SELECT pg_terminate_backend(:pid)"), {"pid": old_pid})
    item = await new_check(client)
    async with asyncio.timeout(5), hub.condition:
        await hub.condition.wait_for(lambda: hub.backend_pid != old_pid)

    async def receive():
        await asyncio.sleep(1)
        return {"type": "http.request", "body": b"", "more_body": False}

    request = Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/",
            "app": app,
            "headers": [(b"cookie", f"{COOKIE}={client.cookies.get(COOKIE)}".encode())],
        },
        receive=receive,
    )
    stream = event_stream(request, identity, before)
    async with asyncio.timeout(5):
        assert (await anext(stream)).comment == "connected"
        event = await anext(stream)
        assert event.event == "task.created" and event.data["task_id"] == item["task_id"]
    await stream.aclose()


async def test_bad_message_and_unrecoverable_handler_are_dead_lettered(client, environment):
    _, settings, database = environment
    if settings.rabbitmq_url is None:
        pytest.skip("Set LOANSIGHT_TEST_RABBITMQ_URL to validate dead lettering")
    await client.post("/api/v1/users")
    task = await new_check(client)
    async with database.transaction() as db:
        job = await db.get(Job, UUID(task["job_id"]))
        job.task_type = "UNSUPPORTED"
    async with await connect(settings) as connection:
        channel, queue = await channel_and_queue(connection, settings)
        dead = await channel.declare_queue(settings.queue_name + ".dead", durable=True)

        async def take_dead_body():
            # Basic.get's timeout is an RPC timeout, not a wait for dead-letter routing.
            async with asyncio.timeout(5), dead.iterator() as messages:
                incoming = await anext(messages)
                body = incoming.body
                await incoming.ack()
                return body

        try:
            await channel.default_exchange.publish(
                aio_pika.Message(body=b"invalid"), routing_key=settings.queue_name, mandatory=True
            )
            incoming = await queue.get(timeout=5)
            await process_delivery(database, settings, incoming)
            assert await take_dead_body() == b"invalid"
            await publish(channel, settings, await message_for(database, task["job_id"]))
            await process_delivery(database, settings, await queue.get(timeout=5))
            assert JobMessage.model_validate_json(await take_dead_body()).job_id == UUID(
                task["job_id"]
            )
            result = (await client.get(f"/api/v1/me/tasks/{task['task_id']}")).json()
            assert result["status"] == "FAILED" and result["error_code"] == "handler_failed"
        finally:
            await queue.delete(if_unused=False, if_empty=False)
            await dead.delete(if_unused=False, if_empty=False)
