from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, Response

from app.modules.identity.service import Identity, current_identity
from app.modules.risk.service import signals

router = APIRouter(prefix="/api/v1/me/evidence-bundles", tags=["risk-signals"])


@router.get("/{bundle_id}/signals")
async def get_signals(
    bundle_id: UUID,
    request: Request,
    response: Response,
    identity: Annotated[Identity, Depends(current_identity)],
    offset: int = Query(0, ge=0),
    limit: int = Query(30, ge=1, le=100),
):
    response.headers["Cache-Control"] = "no-store"
    async with request.app.state.database.transaction() as db:
        return await signals(db, identity, bundle_id, offset, limit)
