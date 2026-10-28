from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field

from app.modules.company.catalog import CatalogUnavailable
from app.modules.evidence import dart_service
from app.modules.identity.service import Identity, current_identity, require_origin

router = APIRouter(prefix="/api/v1/me/disclosure-collections", tags=["disclosure-collections"])


class CollectionInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    corp_code: str = Field(pattern=r"^[0-9]{8}$")
    receipt_no: str = Field(pattern=r"^[0-9]{14}$")
    scope: Literal["CFS", "OFS"]
    link_periods: bool = True


@router.post("", status_code=202)
async def collect(
    body: CollectionInput,
    request: Request,
    response: Response,
    identity: Annotated[Identity, Depends(current_identity)],
):
    require_origin(request)
    response.headers["Cache-Control"] = "no-store"
    try:
        catalog = await request.app.state.company_reports.get(body.corp_code)
    except LookupError:
        raise HTTPException(404, "company_not_found") from None
    except CatalogUnavailable as exc:
        raise HTTPException(503, str(exc)) from None
    report = next((item for item in catalog.items if item.receipt_no == body.receipt_no), None)
    if report is None:
        raise HTTPException(422, "report_not_in_company_catalog")
    return await dart_service.submit(
        request.app.state.database,
        request.app.state.settings,
        identity,
        body.corp_code,
        report,
        body.scope,
        body.link_periods,
    )
