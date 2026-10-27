from datetime import UTC, datetime, timedelta
from uuid import UUID

from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select, update

from app.modules.identity.models import User, UserSession
from app.modules.identity.service import COOKIE, digest


async def test_code_leading_zero_cookie_hash_and_multiple_devices(client, environment, monkeypatch):
    app, _, database = environment
    monkeypatch.setattr("app.modules.identity.service.secrets.randbelow", lambda maximum: 427)
    created = await client.post("/api/v1/users")
    assert created.status_code == 201
    assert created.json()["user_code"] == "00427"
    cookie = created.headers["set-cookie"]
    assert "HttpOnly" in cookie and "SameSite=lax" in cookie and "Path=/" in cookie
    token = client.cookies.get(COOKIE)
    async with database.transaction() as db:
        stored = await db.scalar(select(UserSession))
        assert stored.token_hash == digest(token) and stored.token_hash != token
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test", headers={"Origin": "http://test"}
    ) as other:
        login = await other.post("/api/v1/session", json={"user_code": "00427"})
        assert login.status_code == 200
        assert login.json() == created.json()
        assert other.cookies.get(COOKIE) != token
        assert (await client.delete("/api/v1/session")).status_code == 204
        assert (await client.get("/api/v1/session")).status_code == 401
        assert (await other.get("/api/v1/session")).status_code == 200


async def test_switch_revokes_only_current_device_and_expiry(client, environment):
    _, _, database = environment
    first = (await client.post("/api/v1/users")).json()
    old_token = client.cookies.get(COOKIE)
    second = await client.post("/api/v1/users")
    assert second.json()["user_id"] != first["user_id"]
    assert (
        await client.get("/api/v1/session", headers={"Cookie": f"{COOKIE}={old_token}"})
    ).status_code == 401
    assert (await client.get("/api/v1/session")).json() == second.json()
    async with database.transaction() as db:
        await db.execute(
            update(UserSession)
            .where(
                UserSession.token_hash == digest(client.cookies.get(COOKIE)),
            )
            .values(expires_at=datetime.now(UTC) - timedelta(seconds=1))
        )
    assert (await client.get("/api/v1/session")).status_code == 401


async def test_unknown_malformed_inactive_and_linked_codes_fail_uniformly(client, environment):
    _, _, database = environment
    created = (await client.post("/api/v1/users")).json()
    for code in ("abcde", "1234", "１２３４５"):
        response = await client.post("/api/v1/session", json={"user_code": code})
        assert response.status_code == 401
        assert response.json() == {"detail": "invalid_user_code"}
    async with database.transaction() as db:
        count = await db.scalar(select(func.count()).select_from(User))
        user = await db.get(User, UUID(created["user_id"]))
        user.active = False
    assert count == 1
    response = await client.post("/api/v1/session", json={"user_code": created["user_code"]})
    assert response.status_code == 401 and response.json() == {"detail": "invalid_user_code"}
    async with database.transaction() as db:
        user = await db.get(User, UUID(created["user_id"]))
        user.active, user.account_linked = True, True
    assert (
        await client.post("/api/v1/session", json={"user_code": created["user_code"]})
    ).status_code == 401


async def test_origin_and_persistent_rate_limit(client, environment):
    app, settings, _ = environment
    for origin in ("https://foreign.invalid", "null"):
        assert (await client.post("/api/v1/users", headers={"Origin": origin})).status_code == 403
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as no_origin:
        assert (await no_origin.post("/api/v1/users")).status_code == 403
    settings.entry_ip_limit = 2
    for _ in range(2):
        assert (await client.post("/api/v1/session", json={"user_code": "bad"})).status_code == 401
    # Counters commit even when authentication fails; another client sees the same budget.
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test", headers={"Origin": "http://test"}
    ) as other:
        limited = await other.post("/api/v1/session", json={"user_code": "other"})
        assert limited.status_code == 429 and "Retry-After" in limited.headers


async def test_policy_is_required_and_cookie_can_be_secure(client, environment):
    _, settings, _ = environment
    settings.session_ttl_seconds = None
    assert (await client.post("/api/v1/users")).status_code == 503
    settings.session_ttl_seconds = 300
    settings.cookie_secure = True
    response = await client.post("/api/v1/users")
    assert "Secure" in response.headers["set-cookie"]


async def test_collision_fallback_preserves_inactive_codes(client, environment, monkeypatch):
    _, _, database = environment
    monkeypatch.setattr("app.modules.identity.service.secrets.randbelow", lambda maximum: 427)
    first = (await client.post("/api/v1/users")).json()
    async with database.transaction() as db:
        user = await db.get(User, UUID(first["user_id"]))
        user.active = False
    second = await client.post("/api/v1/users")
    assert second.status_code == 201
    assert second.json()["user_code"] != "00427"
    assert len(second.json()["user_code"]) == 5
