import asyncio
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.sse import EventSourceResponse, ServerSentEvent
from pydantic import BaseModel, ConfigDict, Field

from app.modules.identity.service import (
    COOKIE,
    Identity,
    authenticate,
    current_identity,
    require_origin,
)
from app.modules.tasks import service

router = APIRouter(prefix="/api/v1/me", tags=["tasks"])
CurrentIdentity = Annotated[Identity, Depends(current_identity)]


class CheckInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    check_key: UUID
    shared: bool = False


class Acknowledgement(BaseModel):
    model_config = ConfigDict(extra="forbid")
    state_version: int = Field(gt=0)


@router.post("/tasks/diagnostics", status_code=202)
async def create_diagnostic(body: CheckInput, request: Request, identity: CurrentIdentity) -> dict:
    require_origin(request)
    return await service.create_check(
        request.app.state.database,
        request.app.state.settings,
        identity,
        body.check_key,
        body.shared,
    )


@router.get("/tasks")
async def get_tasks(request: Request, response: Response, identity: CurrentIdentity) -> dict:
    response.headers["Cache-Control"] = "no-store"
    return await service.snapshot(request.app.state.database, identity)


@router.get("/tasks/{task_id}")
async def get_task(
    task_id: UUID, request: Request, response: Response, identity: CurrentIdentity
) -> dict:
    response.headers["Cache-Control"] = "no-store"
    async with request.app.state.database.transaction() as db:
        task, job = await service.owned_task(db, identity, task_id)
        return {**service.task_payload(task, job), "result": job.result}


@router.put("/tasks/{task_id}/acknowledgement")
async def acknowledge(
    task_id: UUID, body: Acknowledgement, request: Request, identity: CurrentIdentity
) -> dict:
    require_origin(request)
    return await service.acknowledge(
        request.app.state.database, identity, task_id, body.state_version
    )


async def event_stream(request: Request, identity: Identity, after: str):
    database, settings = request.app.state.database, request.app.state.settings
    hub = request.app.state.notifications
    # Send the first bytes immediately so proxies flush headers for idle streams.
    yield ServerSentEvent(comment="connected")
    while not await request.is_disconnected():
        version = hub.version
        try:
            # Revalidate even for an idle stream, including session switch/logout/expiry.
            current = await authenticate(database, request.cookies.get(COOKIE))
        except HTTPException:
            yield ServerSentEvent(event="session.expired", data={"reason": "session_required"})
            return
        if current.workspace_id != identity.workspace_id:
            return
        events = await service.read_events(database, identity, after, settings.event_batch_size)
        if events is None:
            yield ServerSentEvent(event="reset", data={"reason": "snapshot_required"})
            return
        for event in events:
            # No unbounded per-client queue; replay is bounded by event_batch_size.
            try:
                await authenticate(database, request.cookies.get(COOKIE))
            except HTTPException:
                yield ServerSentEvent(event="session.expired", data={"reason": "session_required"})
                return
            yield ServerSentEvent(**event)
            after = event["id"]
        try:
            async with asyncio.timeout(settings.sse_heartbeat_seconds):
                await hub.wait(version)
        except TimeoutError:
            yield ServerSentEvent(comment="keep-alive")


async def stream_context(request: Request, identity: CurrentIdentity, after: str | None = None):
    if not request.app.state.settings.task_events_enabled:
        raise HTTPException(503, "task_events_not_enabled")
    if request.headers.get("origin"):
        require_origin(request)
    header_cursor = request.headers.get("last-event-id")
    selected = header_cursor if header_cursor is not None else after
    if selected is None:
        snapshot = await service.snapshot(request.app.state.database, identity)
        selected = snapshot["event_cursor"].rsplit(":", 1)[0] + ":0"
    return identity, selected


@router.get("/task-events", response_class=EventSourceResponse)
async def task_events(request: Request, context: Annotated[tuple, Depends(stream_context)]):
    identity, selected = context
    async for event in event_stream(request, identity, selected):
        yield event
