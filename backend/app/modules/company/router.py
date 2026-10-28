from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

from app.modules.company.catalog import CatalogUnavailable, Company

router = APIRouter(prefix="/api/v1", tags=["company"])


class CompanySearchResult(BaseModel):
    items: list[Company]
    total: int
    offset: int
    limit: int


@router.get("/companies", response_model=CompanySearchResult)
def search_companies(
    request: Request,
    q: Annotated[str, Query(max_length=200)] = "",
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 30,
) -> dict:
    try:
        return request.app.state.company_catalog.search(q, offset, limit)
    except CatalogUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from None
