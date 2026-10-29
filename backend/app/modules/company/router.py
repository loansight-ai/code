from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Path, Query, Request
from pydantic import BaseModel

from app.modules.company.catalog import CatalogUnavailable, Company, Industry
from app.modules.company.reports import AnnualReports

router = APIRouter(prefix="/api/v1", tags=["company"])


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
