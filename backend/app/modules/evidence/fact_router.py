from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, Response

from app.integrations.agents.gateway import configured
from app.modules.evidence import fact_extraction, facts
from app.modules.evidence.bundle_tools import BundleTools
from app.modules.evidence.exposure_summary import read_summary
from app.modules.evidence.fact_schemas import FactInput, ReviewInput, RevisionInput
from app.modules.evidence.fact_sources import page, resolve
from app.modules.evidence.search_schemas import ContextQuery
from app.modules.identity.service import Identity, current_identity, require_origin

router = APIRouter(prefix="/api/v1/me/evidence-bundles/{bundle_id}", tags=["fact-review"])
Owner = Annotated[Identity, Depends(current_identity)]


@router.get("/exposure-summary")
async def exposure_summary(bundle_id: UUID, request: Request, response: Response, identity: Owner):
    response.headers["Cache-Control"] = "no-store"
    async with request.app.state.database.transaction() as db:
        tools = await BundleTools.owned(db, identity, bundle_id)
        return await read_summary(db, tools, request.app.state.database)


@router.get("/facts")
async def listing(
    bundle_id: UUID,
    request: Request,
    response: Response,
    identity: Owner,
    offset: int = Query(0, ge=0),
    limit: int = Query(30, ge=1, le=100),
):
    response.headers["Cache-Control"] = "no-store"
    async with request.app.state.database.transaction() as db:
        return await facts.list_facts(db, identity, bundle_id, offset, limit)


@router.post("/facts")
async def create(
    bundle_id: UUID, body: FactInput, request: Request, response: Response, identity: Owner
):
    require_origin(request)
    response.headers["Cache-Control"] = "no-store"
    async with request.app.state.database.transaction() as db:
        tools = await BundleTools.owned(db, identity, bundle_id)
        return facts.payload(
            await facts.add(db, tools, body, {"kind": "MANUAL", "user_id": str(identity.user_id)})
        )


@router.get("/fact-sources")
async def source(
    bundle_id: UUID,
    request: Request,
    response: Response,
    identity: Owner,
    query: Annotated[ContextQuery, Query()],
):
    response.headers["Cache-Control"] = "no-store"
    async with request.app.state.database.transaction() as db:
        tools = await BundleTools.owned(db, identity, bundle_id)
        return page(await resolve(tools, query.segment_id), query.row_offset, query.text_offset)


@router.get("/facts/{fact_id}")
async def history(
    bundle_id: UUID, fact_id: UUID, request: Request, response: Response, identity: Owner
):
    response.headers["Cache-Control"] = "no-store"
    async with request.app.state.database.transaction() as db:
        return await facts.history(db, identity, bundle_id, fact_id)


@router.post("/facts/{fact_id}/open")
async def opening(
    bundle_id: UUID, fact_id: UUID, request: Request, response: Response, identity: Owner
):
    require_origin(request)
    response.headers["Cache-Control"] = "no-store"
    async with request.app.state.database.transaction() as db:
        return await facts.opening(db, identity, bundle_id, fact_id)


@router.post("/facts/{fact_id}/revisions")
async def revision(
    bundle_id: UUID,
    fact_id: UUID,
    body: RevisionInput,
    request: Request,
    response: Response,
    identity: Owner,
):
    require_origin(request)
    response.headers["Cache-Control"] = "no-store"
    async with request.app.state.database.transaction() as db:
        return await facts.revise(db, identity, bundle_id, fact_id, body)


@router.post("/facts/{fact_id}/reviews")
async def review(
    bundle_id: UUID,
    fact_id: UUID,
    body: ReviewInput,
    request: Request,
    response: Response,
    identity: Owner,
):
    require_origin(request)
    response.headers["Cache-Control"] = "no-store"
    async with request.app.state.database.transaction() as db:
        return await facts.review(db, identity, bundle_id, fact_id, body)


@router.post("/fact-audit-candidates")
async def seed(bundle_id: UUID, request: Request, response: Response, identity: Owner):
    require_origin(request)
    response.headers["Cache-Control"] = "no-store"
    async with request.app.state.database.transaction() as db:
        return await fact_extraction.seed_audit(db, identity, bundle_id)


@router.get("/fact-extraction")
async def latest(bundle_id: UUID, request: Request, response: Response, identity: Owner):
    response.headers["Cache-Control"] = "no-store"
    async with request.app.state.database.transaction() as db:
        return {
            "available": configured(request.app.state.settings),
            "run": await fact_extraction.latest(db, identity, bundle_id),
        }


@router.post("/fact-extraction", status_code=202)
async def extract(bundle_id: UUID, request: Request, response: Response, identity: Owner):
    require_origin(request)
    response.headers["Cache-Control"] = "no-store"
    return await fact_extraction.submit(
        request.app.state.database, request.app.state.settings, identity, bundle_id
    )
