from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Path, Query, Request, Response
from pydantic import BaseModel

from app.modules.company.catalog import CatalogUnavailable, Company, Industry
from app.modules.company.exported import ExportError, read_company_collection
from app.modules.company.reports import AnnualReports

router = APIRouter(prefix="/api/v1", tags=["company"])


@router.get("/companies/{corp_code}/collected-data")
async def collected_company_data(
    request: Request,
    response: Response,
    corp_code: Annotated[str, Path(pattern=r"^[0-9]{8}$")],
    receipt_no: Annotated[str, Query(pattern=r"^[0-9]{14}$")],
    scope: Literal["CFS", "OFS"],
    import_id: UUID | None = None,
    fiscal_year: Annotated[int | None, Query(ge=2015, le=9999)] = None,
):
    response.headers["Cache-Control"] = "no-store"
    try:
        return await read_company_collection(
            request.app.state.database, import_id, corp_code, receipt_no, scope, fiscal_year
        )
    except ExportError as exc:
        raise HTTPException(404, "collected_import_not_found") from exc


class CompanySearchResult(BaseModel):
    items: list[Company]
    total: int
    offset: int
    limit: int


@router.get("/companies", response_model=CompanySearchResult)
async def search_companies(
    request: Request,
    q: Annotated[str, Query(max_length=200)] = "",
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 10,
    industry: Industry | None = None,
    market: Literal["Y", "K", "N", "E"] | None = None,
) -> dict:
    try:
        return await request.app.state.company_repository.search(q, offset, limit, industry, market)
    except CatalogUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from None


@router.get("/companies/{corp_code}/reports", response_model=AnnualReports)
async def company_reports(
    request: Request,
    corp_code: Annotated[str, Path(pattern=r"^[0-9]{8}$")],
) -> AnnualReports:
    try:
        return await request.app.state.company_reports.get(corp_code)
    except LookupError:
        raise HTTPException(status_code=404, detail="company_not_found") from None
    except CatalogUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from None
