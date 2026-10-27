import hashlib
import re
import secrets
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID

from fastapi import HTTPException, Request, Response
from sqlalchemy import func, select, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.database import Database
from app.modules.identity.models import EntryBucket, User, UserSession, Workspace

COOKIE = "loansight_session"


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


@dataclass(frozen=True)
class Identity:
    session_id: UUID
    user_id: UUID
    workspace_id: UUID
    user_code: str


def require_origin(request: Request) -> None:
    origin = request.headers.get("origin")
    if not origin or origin not in request.app.state.settings.allowed_origins:
        raise HTTPException(403, "origin_not_allowed")


async def authenticate(database: Database, token: str | None) -> Identity:
    if not token:
        raise HTTPException(401, "session_required")
    async with database.transaction() as db:
        row = (
            await db.execute(
                select(UserSession, User, Workspace)
                .join(User, User.id == UserSession.user_id)
                .join(Workspace, Workspace.id == UserSession.workspace_id)
                .where(
                    UserSession.token_hash == digest(token),
                    UserSession.revoked_at.is_(None),
                    UserSession.expires_at > func.now(),
                    User.active.is_(True),
                    Workspace.owner_user_id == User.id,
                )
            )
        ).first()
        if not row:
            raise HTTPException(401, "session_required")
        session, user, workspace = row
        return Identity(session.id, user.id, workspace.id, user.user_code)


async def current_identity(request: Request) -> Identity:
    return await authenticate(request.app.state.database, request.cookies.get(COOKIE))


def entry_policy(settings: Settings) -> tuple[int, int, int, int, int]:
    values = (
        settings.session_ttl_seconds,
        settings.entry_window_seconds,
        settings.entry_ip_limit,
        settings.entry_code_limit,
        settings.entry_global_limit,
    )
    if any(value is None for value in values):
        raise HTTPException(503, "identity_policy_not_configured")
    return values


async def throttle(request: Request, code: str) -> None:
    settings = request.app.state.settings
    _, window, ip_limit, code_limit, global_limit = entry_policy(settings)
    start = int(time.time()) // window * window
    ip = request.client.host if request.client else "unknown"
    buckets = sorted(
        [
            ("ip:" + digest(ip), ip_limit),
            ("code:" + digest(code), code_limit),
            ("global", global_limit),
        ]
    )
    exceeded = False
    # Commit counters even for invalid credentials / 429; shared by every API replica.
    async with request.app.state.database.transaction() as db:
        for key, limit in buckets:
            statement = insert(EntryBucket).values(key=key, window_start=start, count=0)
            await db.execute(statement.on_conflict_do_nothing(index_elements=["key"]))
            bucket = await db.get(EntryBucket, key, with_for_update=True)
            if bucket.window_start != start:
                bucket.window_start, bucket.count = start, 0
            bucket.count += 1
            exceeded |= bucket.count > limit
    if exceeded:
        raise HTTPException(429, "entry_rate_limited", headers={"Retry-After": str(window)})


async def allocate_user(db: AsyncSession) -> tuple[User, Workspace]:
    # Serializes exhaustion checks; the DB unique constraint remains the final guard.
    await db.execute(text("SELECT pg_advisory_xact_lock(7319001)"))
    used = set((await db.scalars(select(User.user_code))).all())
    if len(used) >= 100_000:
        raise HTTPException(503, "user_code_space_exhausted")
    for _ in range(32):
        code = f"{secrets.randbelow(100_000):05d}"
        if code not in used:
            break
    else:
        code = secrets.choice([f"{n:05d}" for n in range(100_000) if f"{n:05d}" not in used])
    user = User(user_code=code)
    try:
        async with db.begin_nested():
            db.add(user)
            await db.flush()
    except IntegrityError:
        raise HTTPException(503, "user_code_allocation_conflict") from None
    workspace = Workspace(owner_user_id=user.id)
    db.add(workspace)
    await db.flush()
    return user, workspace


async def start_session(request: Request, response: Response, code: str | None) -> dict:
    require_origin(request)
    await throttle(request, "new-user" if code is None else code)
    ttl, *_ = entry_policy(request.app.state.settings)
    async with request.app.state.database.transaction() as db:
        if code is None:
            user, workspace = await allocate_user(db)
        else:
            if not re.fullmatch(r"[0-9]{5}", code):
                raise HTTPException(401, "invalid_user_code")
            row = (
                await db.execute(
                    select(User, Workspace)
                    .join(Workspace, Workspace.owner_user_id == User.id)
                    .where(
                        User.user_code == code,
                        User.active.is_(True),
                        User.account_linked.is_(False),
                    )
                )
            ).first()
            if not row:
                raise HTTPException(401, "invalid_user_code")
            user, workspace = row
        previous = request.cookies.get(COOKIE)
        if previous:
            await db.execute(
                update(UserSession)
                .where(
                    UserSession.token_hash == digest(previous),
                    UserSession.revoked_at.is_(None),
                )
                .values(revoked_at=func.now())
            )
        token = secrets.token_urlsafe(32)
        db.add(
            UserSession(
                token_hash=digest(token),
                user_id=user.id,
                workspace_id=workspace.id,
                expires_at=datetime.now(UTC) + timedelta(seconds=ttl),
            )
        )
        await db.execute(
            text("SELECT pg_notify('task_events', :scope)"), {"scope": str(workspace.id)}
        )
        result = {
            "user_id": str(user.id),
            "user_code": user.user_code,
            "workspace_id": str(workspace.id),
        }
    response.set_cookie(
        COOKIE,
        token,
        max_age=ttl,
        httponly=True,
        secure=request.app.state.settings.cookie_secure,
        samesite="lax",
        path="/",
    )
    response.headers["Cache-Control"] = "no-store"
    return result
