from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, Response

from app.modules.evidence import agent, bundle_agent, bundles
from app.modules.evidence.bundle_tools import BundleSearchQuery, BundleTools, baseline
from app.modules.evidence.search_schemas import ContextQuery, SectionsQuery
from app.modules.identity.service import Identity, current_identity, require_origin

router = APIRouter(prefix="/api/v1/me", tags=["report-evidence"])
CurrentIdentity = Annotated[Identity, Depends(current_identity)]


@router.get("/companies/{corp_code}/evidence-reports")
async def reports(corp_code: str, request: Request, response: Response, identity: CurrentIdentity):
    response.headers["Cache-Control"] = "no-store"
    async with request.app.state.database.transaction() as db:
        return {"reports": await bundles.report_catalog(db, corp_code)}


@router.post("/evidence-bundles")
async def create(
    body: bundles.BundleInput, request: Request, response: Response, identity: CurrentIdentity
):
    require_origin(request)
    response.headers["Cache-Control"] = "no-store"
    async with request.app.state.database.transaction() as db:
        bundle = await bundles.create(db, identity, body)
        tools = await BundleTools.owned(db, identity, bundle.id)
        return await tools.metadata()


@router.get("/evidence-bundles/{bundle_id}")
async def read(bundle_id: UUID, request: Request, response: Response, identity: CurrentIdentity):
    response.headers["Cache-Control"] = "no-store"
    async with request.app.state.database.transaction() as db:
        tools = await BundleTools.owned(db, identity, bundle_id)
        return await tools.metadata()


@router.get("/evidence-bundles/{bundle_id}/sections")
async def sections(
    bundle_id: UUID,
    request: Request,
    response: Response,
    identity: CurrentIdentity,
    query: Annotated[SectionsQuery, Query()],
):
    response.headers["Cache-Control"] = "no-store"
    async with request.app.state.database.transaction() as db:
        tools = await BundleTools.owned(db, identity, bundle_id)
        return await tools.list_note_sections(query)


@router.post("/evidence-bundles/{bundle_id}/search")
async def search(
    bundle_id: UUID,
    query: BundleSearchQuery,
    request: Request,
    response: Response,
    identity: CurrentIdentity,
):
    require_origin(request)
    response.headers["Cache-Control"] = "no-store"
    async with request.app.state.database.transaction() as db:
        tools = await BundleTools.owned(db, identity, bundle_id)
        return await tools.search_note_segments(query)


@router.get("/evidence-bundles/{bundle_id}/context")
async def context(
    bundle_id: UUID,
    request: Request,
    response: Response,
    identity: CurrentIdentity,
    query: Annotated[ContextQuery, Query()],
):
    response.headers["Cache-Control"] = "no-store"
    async with request.app.state.database.transaction() as db:
        tools = await BundleTools.owned(db, identity, bundle_id)
        return await tools.read_note_context(query)


@router.get("/evidence-bundles/{bundle_id}/segments/{segment_id}")
async def segment(
    bundle_id: UUID,
    segment_id: UUID,
    request: Request,
    response: Response,
    identity: CurrentIdentity,
):
    response.headers["Cache-Control"] = "no-store"
    async with request.app.state.database.transaction() as db:
        tools = await BundleTools.owned(db, identity, bundle_id)
        result = await tools.read_note_context(ContextQuery(segment_id=segment_id))
        return next(s for s in result["segments"] if s["segment_id"] == str(segment_id))


@router.post("/evidence-bundles/{bundle_id}/baseline")
async def start_baseline(
    bundle_id: UUID, request: Request, response: Response, identity: CurrentIdentity
):
    require_origin(request)
    response.headers["Cache-Control"] = "no-store"
    async with request.app.state.database.transaction() as db:
        return await baseline(db, identity, bundle_id)


@router.get("/evidence-bundles/{bundle_id}/agent")
async def get_agent(
    bundle_id: UUID, request: Request, response: Response, identity: CurrentIdentity
):
    response.headers["Cache-Control"] = "no-store"
    async with request.app.state.database.transaction() as db:
        run = await bundle_agent.latest(db, identity, bundle_id)
        return {"available": agent.configured(request.app.state.settings), "run": run}


@router.post("/evidence-bundles/{bundle_id}/agent", status_code=202)
async def start_agent(
    bundle_id: UUID, request: Request, response: Response, identity: CurrentIdentity
):
    require_origin(request)
    response.headers["Cache-Control"] = "no-store"
    return await bundle_agent.submit(
        request.app.state.database, request.app.state.settings, identity, bundle_id
    )
