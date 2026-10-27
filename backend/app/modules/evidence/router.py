from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy import select

from app.modules.evidence import service
from app.modules.evidence.models import SourceSegment
from app.modules.evidence.schemas import NoteInput
from app.modules.identity.service import Identity, current_identity, require_origin

router = APIRouter(prefix="/api/v1/me/note-imports", tags=["note-imports"])
CurrentIdentity = Annotated[Identity, Depends(current_identity)]


@router.post(
    "",
    status_code=202,
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {"text/html": {"schema": {"type": "string", "format": "binary"}}},
        },
    },
)
async def import_notes(
    request: Request,
    response: Response,
    identity: CurrentIdentity,
    context: Annotated[NoteInput, Query()],
) -> dict:
    require_origin(request)
    if request.headers.get("content-type", "").split(";")[0].strip().lower() != "text/html":
        raise HTTPException(415, "note_html_required")
    maximum = request.app.state.settings.note_import_max_bytes
    source = bytearray()
    async for chunk in request.stream():
        if len(source) + len(chunk) > maximum:
            raise HTTPException(413, "note_html_too_large")
        source.extend(chunk)
    response.headers["Cache-Control"] = "no-store"
    return await service.submit(
        request.app.state.database, request.app.state.settings, identity, bytes(source), context
    )


@router.get("/{structure_id}")
async def get_structure(
    structure_id: UUID,
    request: Request,
    response: Response,
    identity: CurrentIdentity,
) -> dict:
    response.headers["Cache-Control"] = "no-store"
    async with request.app.state.database.transaction() as db:
        row = await service.owned_structure(db, identity, structure_id)
        return service.structure_payload(*row)


@router.get("/{structure_id}/segments")
async def list_segments(
    structure_id: UUID,
    request: Request,
    response: Response,
    identity: CurrentIdentity,
    after: int = Query(default=-1, ge=-1),
    limit: int = Query(default=100, ge=1, le=500),
) -> dict:
    response.headers["Cache-Control"] = "no-store"
    async with request.app.state.database.transaction() as db:
        revision, _, _ = await service.owned_structure(db, identity, structure_id)
        if revision.hierarchy is None:
            raise HTTPException(409, "note_structure_not_ready")
        rows = list(
            (
                await db.scalars(
                    select(SourceSegment)
                    .where(
                        SourceSegment.structure_id == structure_id, SourceSegment.ordinal > after
                    )
                    .order_by(SourceSegment.ordinal)
                    .limit(limit + 1)
                )
            ).all()
        )
        more = len(rows) > limit
        selected = rows[:limit]
        return {
            "segments": [service.segment_payload(row) for row in selected],
            "total": revision.segment_count,
            "next_after": selected[-1].ordinal if more else None,
        }


@router.get("/{structure_id}/segments/{segment_id}")
async def get_segment(
    structure_id: UUID,
    segment_id: UUID,
    request: Request,
    response: Response,
    identity: CurrentIdentity,
) -> dict:
    response.headers["Cache-Control"] = "no-store"
    async with request.app.state.database.transaction() as db:
        await service.owned_structure(db, identity, structure_id)
        segment = await db.scalar(
            select(SourceSegment).where(
                SourceSegment.id == segment_id, SourceSegment.structure_id == structure_id
            )
        )
        if segment is None:
            raise HTTPException(404, "source_segment_not_found")
        return service.segment_payload(segment)
