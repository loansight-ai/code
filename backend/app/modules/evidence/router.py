import asyncio
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy import func, select

from app.core.storage import LocalArtifactStore
from app.modules.company.models import CompanyRecord
from app.modules.evidence import service
from app.modules.evidence.models import SourceSegment
from app.modules.evidence.schemas import NoteInput
from app.modules.evidence.source_view import prepare_source_view
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
        payload = service.structure_payload(*row)
        company = await db.get(CompanyRecord, row[1].corp_code)
        payload["company_name"] = company.corp_name if company else None
        return payload


@router.get("/{structure_id}/source-view")
async def source_view(
    structure_id: UUID, request: Request, response: Response, identity: CurrentIdentity
):
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    async with request.app.state.database.transaction() as db:
        revision, artifact, _ = await service.owned_structure(db, identity, structure_id)
        if revision.hierarchy is None:
            raise HTTPException(409, "note_structure_not_ready")
        segments = (
            await db.execute(
                select(SourceSegment.id, SourceSegment.source_xpath)
                .where(SourceSegment.structure_id == structure_id)
                .order_by(SourceSegment.ordinal)
            )
        ).all()
        digest, encoding = artifact.sha256, artifact.encoding
    try:
        source = await asyncio.to_thread(
            LocalArtifactStore(request.app.state.settings.artifact_root).read, digest
        )
        view = await asyncio.to_thread(prepare_source_view, source, encoding, segments)
    except (OSError, ValueError):
        raise HTTPException(503, "note_source_unavailable") from None
    # JSON data only. The client sanitizes HTML before using a sandboxed iframe.
    return {"structure_id": str(structure_id), "source_sha256": digest, **view}


@router.get("/{structure_id}/segments")
async def list_segments(
    structure_id: UUID,
    request: Request,
    response: Response,
    identity: CurrentIdentity,
    after: int = Query(default=-1, ge=-1),
    limit: int = Query(default=100, ge=1, le=500),
    node_id: str | None = Query(default=None, max_length=40),
    q: str = Query(default="", max_length=200),
    tables_only: bool = False,
) -> dict:
    response.headers["Cache-Control"] = "no-store"
    async with request.app.state.database.transaction() as db:
        revision, _, _ = await service.owned_structure(db, identity, structure_id)
        if revision.hierarchy is None:
            raise HTTPException(409, "note_structure_not_ready")
        conditions = [SourceSegment.structure_id == structure_id]
        if node_id is not None:
            nodes = revision.hierarchy.get("nodes", [])
            if node_id not in {node["id"] for node in nodes}:
                raise HTTPException(404, "note_node_not_found")
            if node_id != "root":
                descendants = {node_id}
                while True:
                    children = {
                        node["id"] for node in nodes if node.get("parent_id") in descendants
                    }
                    if children <= descendants:
                        break
                    descendants |= children
                conditions.append(SourceSegment.owner_node_id.in_(descendants))
        if q.strip():
            conditions.append(SourceSegment.text.icontains(q.strip(), autoescape=True))
        if tables_only:
            conditions.append(SourceSegment.kind == "table")
        total = await db.scalar(select(func.count()).select_from(SourceSegment).where(*conditions))
        rows = list(
            (
                await db.scalars(
                    select(SourceSegment)
                    .where(*conditions, SourceSegment.ordinal > after)
                    .order_by(SourceSegment.ordinal)
                    .limit(limit + 1)
                )
            ).all()
        )
        more = len(rows) > limit
        selected = rows[:limit]
        return {
            "segments": [service.segment_payload(row) for row in selected],
            "total": total,
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
