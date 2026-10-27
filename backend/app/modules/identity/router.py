from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, text, update

from app.modules.identity.models import UserSession
from app.modules.identity.service import (
    COOKIE,
    Identity,
    current_identity,
    require_origin,
    start_session,
)

router = APIRouter(prefix="/api/v1", tags=["identity"])


class SessionInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    user_code: str = Field(max_length=32)


@router.post("/users", status_code=201)
async def create_user(request: Request, response: Response) -> dict:
    return await start_session(request, response, None)


@router.post("/session")
async def login(body: SessionInput, request: Request, response: Response) -> dict:
    return await start_session(request, response, body.user_code)


@router.get("/session")
async def get_session(
    response: Response, identity: Annotated[Identity, Depends(current_identity)]
) -> dict:
    response.headers["Cache-Control"] = "no-store"
    return {
        "user_id": str(identity.user_id),
        "user_code": identity.user_code,
        "workspace_id": str(identity.workspace_id),
    }


@router.delete("/session", status_code=204)
async def logout(
    request: Request, identity: Annotated[Identity, Depends(current_identity)]
) -> Response:
    require_origin(request)
    async with request.app.state.database.transaction() as db:
        await db.execute(
            update(UserSession)
            .where(UserSession.id == identity.session_id)
            .values(revoked_at=func.now())
        )
        await db.execute(
            text("SELECT pg_notify('task_events', :scope)"), {"scope": str(identity.workspace_id)}
        )
    response = Response(status_code=204, headers={"Cache-Control": "no-store"})
    response.delete_cookie(
        COOKIE,
        path="/",
        secure=request.app.state.settings.cookie_secure,
        httponly=True,
        samesite="lax",
    )
    return response
