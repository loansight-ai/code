from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, Response

from app.modules.evidence.search import NoteSearchTools
from app.modules.evidence.search_baseline import payload, run_baseline, saved_run
from app.modules.evidence.search_schemas import ContextQuery, SearchQuery, SectionsQuery
from app.modules.identity.service import Identity, current_identity, require_origin

router = APIRouter(prefix="/api/v1/me/note-imports", tags=["note-search"])
CurrentIdentity = Annotated[Identity, Depends(current_identity)]


@router.get("/{structure_id}/search/sections")
async def sections(
    structure_id: UUID,
    request: Request,
    response: Response,
    identity: CurrentIdentity,
    query: Annotated[SectionsQuery, Query()],
):
    response.headers["Cache-Control"] = "no-store"
    async with request.app.state.database.transaction() as db:
        tools = await NoteSearchTools.owned(db, identity, structure_id)
        return await tools.list_note_sections(query)


@router.post("/{structure_id}/search/segments")
async def search(
    structure_id: UUID,
    request: Request,
    response: Response,
    identity: CurrentIdentity,
    query: SearchQuery,
):
    require_origin(request)
    response.headers["Cache-Control"] = "no-store"
    async with request.app.state.database.transaction() as db:
        tools = await NoteSearchTools.owned(db, identity, structure_id)
        return await tools.search_note_segments(query)


@router.get("/{structure_id}/search/context")
async def context(
    structure_id: UUID,
    request: Request,
    response: Response,
    identity: CurrentIdentity,
    query: Annotated[ContextQuery, Query()],
):
    response.headers["Cache-Control"] = "no-store"
    async with request.app.state.database.transaction() as db:
        tools = await NoteSearchTools.owned(db, identity, structure_id)
        return await tools.read_note_context(query)


@router.get("/{structure_id}/search/baseline")
async def get_baseline(
    structure_id: UUID, request: Request, response: Response, identity: CurrentIdentity
):
    response.headers["Cache-Control"] = "no-store"
    async with request.app.state.database.transaction() as db:
        _, run = await saved_run(db, identity, structure_id)
        return {"run": payload(run) if run else None}


@router.post("/{structure_id}/search/baseline")
async def baseline(
    structure_id: UUID, request: Request, response: Response, identity: CurrentIdentity
):
    require_origin(request)
    response.headers["Cache-Control"] = "no-store"
    async with request.app.state.database.transaction() as db:
        return await run_baseline(db, identity, structure_id)
