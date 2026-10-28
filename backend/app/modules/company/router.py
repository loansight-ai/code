from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

from app.modules.company.catalog import CatalogUnavailable, Company, Industry

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
) -> dict:
    try:
        return await request.app.state.company_repository.search(q, offset, limit, industry)
    except CatalogUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from None
