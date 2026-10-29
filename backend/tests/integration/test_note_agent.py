import asyncio
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient

from app.integrations.agents.runtime import AgentError, AgentResponse
from app.integrations.messaging.rabbitmq import JobMessage
from app.modules.evidence import agent
from app.modules.evidence.search_baseline import CATEGORIES
from app.worker.main import run_job

pytest_plugins = ["tests.integration.test_note_search"]


@pytest.fixture
def enabled(environment, tmp_path):
    _, settings, _ = environment
    settings.codex_home = tmp_path / "codex"
    settings.note_agent_timeout_seconds = 10
    settings.note_agent_max_tool_calls = 20
    return settings


class FakeRuntime:
    mode = "valid"

    async def run(self, prompt, definitions, call, output_schema):
        import json

        assert "baseline" in prompt
        assert len(definitions) == 3
        if self.mode == "timeout":
            raise TimeoutError
        if self.mode == "auth":
            raise AgentError("codex_auth_required")
        items = []
        for key, _, _, _ in CATEGORIES:
            args = {"category_key": key}
            # Use real search paths even for empty categories.
            args["terms"] = ["신용등급" if key == "credit" else "위반"]
            found = await call("search_note_segments", args)
            if self.mode == "repeat":
                await call("search_note_segments", args)
            findings = []
            if self.mode == "tool_error":
                await call("read_note_context", {"segment_id": str(uuid4()), "category_key": key})
            if found.get("candidates"):
                sid = found["candidates"][0]["segment_id"]
                await call("read_note_context", {"segment_id": sid, "category_key": key})
                findings = [
                    {
                        "statement": "약정 위반이 없다는 원문이 있습니다.",
                        "citations": [
                            {
                                "segment_id": sid,
                                "quote": "위반하였습니다"
                                if self.mode == "bad_quote"
                                else "위반은 없습니다",
                            }
                        ],
                    }
                ]
            items.append(
                {
                    "key": key,
                    "search_status": "COMPLETED",
                    "findings": findings,
                    "limitations": "주석 범위만 확인. 검수 전.",
                }
            )
        return AgentResponse(json.dumps({"items": items}), "fake-model", "fake-thread")


async def execute(client, environment, url):
    response = await client.post(url + "/agent")
    assert response.status_code == 202, response.text
    data = response.json()
    _, settings, database = environment
    await run_job(
        database,
        settings,
        JobMessage(
            message_id=uuid4(),
            job_id=UUID(data["job_id"]),
            generation=1,
        ),
    )
    return (await client.get(url + "/agent")).json()["run"]


async def test_real_tools_validation_saved_results_and_reuse(
    client, document, environment, enabled, monkeypatch
):
    monkeypatch.setattr(agent, "runtime_for", lambda *a: FakeRuntime())
    _, _, url = document
    run = await execute(client, environment, url)
    assert run["status"] == "SUCCEEDED"
    result = run["result"]
    assert len(result["items"]) == 6 and not result["evidence_verified"]
    assert result["report_coverage"] == "PARTIAL"
    assert result["model"] == "fake-model" and len(result["trace"]) == 11
    assert (await client.post(url + "/agent")).json()["reused"]
    assert (await client.get(url + "/baseline")).json()["run"]["agent_status"] == "NOT_RUN"


@pytest.mark.parametrize(
    "mode,reason",
    [
        ("bad_quote", "note_agent_output_invalid"),
        ("repeat", "note_agent_repeated_tool_call"),
        ("timeout", "note_agent_timeout"),
        ("auth", "codex_auth_required"),
        ("tool_error", "note_agent_partial_coverage"),
    ],
)
async def test_incomplete_preserves_baseline_and_requires_explicit_retry(
    client, document, environment, enabled, monkeypatch, mode, reason
):
    runtime = FakeRuntime()
    runtime.mode = mode
    monkeypatch.setattr(agent, "runtime_for", lambda *a: runtime)
    _, _, url = document
    run = await execute(client, environment, url)
    assert run["status"] == "PARTIAL_SUCCEEDED"
    assert run["result"]["stop_reason"] == reason
    assert len(run["result"]["items"]) == 6
    assert (await client.get(url + "/baseline")).json()["run"]
    assert not (await client.post(url + "/agent")).json()["reused"]


async def test_budget_and_concurrent_requests(client, document, environment, enabled, monkeypatch):
    enabled.note_agent_max_tool_calls = 1
    monkeypatch.setattr(agent, "runtime_for", lambda *a: FakeRuntime())
    _, _, url = document
    responses = await asyncio.gather(client.post(url + "/agent"), client.post(url + "/agent"))
    assert responses[0].json()["job_id"] == responses[1].json()["job_id"]
    run = await execute(client, environment, url)
    assert run["result"]["stop_reason"] == "note_agent_tool_budget_exhausted"
    assert len(run["result"]["trace"]) == 1


async def test_owner_origin_and_unconfigured(client, document, environment):
    app, _, _ = environment
    _, _, url = document
    assert (await client.post(url + "/agent")).status_code == 503
    assert (await client.get(url + "/agent")).json() == {
        "available": False,
        "provider": "codex",
        "run": None,
    }
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test", headers={"Origin": "http://test"}
    ) as other:
        await other.post("/api/v1/users")
        assert (await other.get(url + "/agent")).status_code == 404
        assert (await other.post(url + "/agent")).status_code == 404
    assert (await client.post(url + "/agent", headers={"Origin": "http://evil"})).status_code == 403
