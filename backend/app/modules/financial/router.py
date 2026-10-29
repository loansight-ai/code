import asyncio
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field

from app.core.storage import LocalArtifactStore, SourceIntegrityError
from app.modules.company.catalog import CatalogUnavailable
from app.modules.financial import service
from app.modules.identity.service import Identity, current_identity, require_origin

router = APIRouter(prefix="/api/v1/me/financial-analyses", tags=["financial"])
CurrentIdentity = Annotated[Identity, Depends(current_identity)]


class FinancialInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    corp_code: str = Field(pattern=r"^[0-9]{8}$")
    receipt_no: str = Field(pattern=r"^[0-9]{14}$")
    scope: Literal["OFS", "CFS"] = "OFS"
    lease: Literal["include", "exclude"] = "include"
    refresh_key: UUID | None = None


@router.post("", status_code=202)
async def submit(
    body: FinancialInput, request: Request, response: Response, identity: CurrentIdentity
):
    require_origin(request)
    response.headers["Cache-Control"] = "no-store"
    try:
        catalog = await request.app.state.company_reports.get(body.corp_code)
    except LookupError:
        raise HTTPException(404, "company_not_found") from None
    except CatalogUnavailable as exc:
        raise HTTPException(503, str(exc)) from None
    report = next((r for r in catalog.items if r.receipt_no == body.receipt_no), None)
    if report is None:
        raise HTTPException(422, "report_not_in_company_catalog")
    if report.withdrawn:
        raise HTTPException(422, "withdrawn_report")
    if int(report.fiscal_year) < 2015:
        raise HTTPException(422, "financial_year_unsupported")
    latest = max(
        r.receipt_no for r in catalog.items if r.period == report.period and not r.withdrawn
    )
    if latest != report.receipt_no:
        raise HTTPException(409, "financial_latest_receipt_required")
    context = {
        "corp_code": body.corp_code,
        "receipt_no": report.receipt_no,
        "fiscal_year": report.fiscal_year,
        "period": report.period,
        "report_name": report.report_name,
        "receipt_date": report.receipt_date,
        "scope": body.scope,
        "lease": body.lease,
        "refresh_key": str(body.refresh_key) if body.refresh_key else None,
    }
    return await service.submit(
        request.app.state.database, request.app.state.settings, identity, context
    )


@router.get("/{run_id}")
async def read(run_id: UUID, request: Request, response: Response, identity: CurrentIdentity):
    response.headers["Cache-Control"] = "no-store"
    return await service.read(request.app.state.database, identity, run_id)


@router.get("/{run_id}/source")
async def source(run_id: UUID, request: Request, identity: CurrentIdentity):
    run = await service.read(request.app.state.database, identity, run_id)
    if not run["result"]:
        raise HTTPException(409, "financial_source_not_ready")
    store = LocalArtifactStore(request.app.state.settings.artifact_root / "financial/originals")
    try:
        raw = await asyncio.to_thread(store.read, run["result"]["source_sha256"])
    except (OSError, SourceIntegrityError):
        raise HTTPException(409, "financial_source_unavailable") from None
    return Response(
        raw,
        media_type="application/json",
        headers={
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            "Content-Disposition": f'attachment; filename="financial-{run_id}.json"',
        },
    )
