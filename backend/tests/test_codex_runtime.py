import asyncio
import io
import json
import os

import pytest

from app.integrations.agents.codex import CodexRuntime
from app.integrations.agents.runtime import AgentError


class Process:
    def __init__(self, messages):
        self.stdin = io.BytesIO()
        self.stdout = io.BytesIO(b"".join(json.dumps(m).encode() + b"\n" for m in messages))


def messages(account=True):
    return [
        {"id": 1, "result": {}},
        {"id": 2, "result": {"account": {"type": "chatgpt"} if account else None}},
        {"id": 3, "result": {"thread": {"id": "thread-1"}, "model": "configured-model"}},
        {"id": 4, "result": {"turn": {"id": "turn-1"}}},
    ]


async def test_dynamic_tool_protocol_and_final_message(tmp_path):
    process = Process(
        messages()
        + [
            {
                "id": 100,
                "method": "item/tool/call",
                "params": {
                    "threadId": "thread-1",
                    "tool": "search",
                    "arguments": {"terms": ["약정"]},
                },
            },
            {
                "method": "item/completed",
                "params": {
                    "item": {"type": "agentMessage", "text": '{"items": []}'},
                },
            },
            {"method": "turn/completed", "params": {"turn": {"status": "completed"}}},
        ]
    )
    calls = []

    async def call(name, arguments):
        calls.append((name, arguments))
        return {"candidates": []}

    response = await CodexRuntime("codex", tmp_path, None)._conversation(
        process, str(tmp_path), "search", [], call, {"type": "object"}
    )
    assert response.model == "configured-model" and response.thread_id == "thread-1"
    assert calls == [("search", {"terms": ["약정"]})]
    sent = [json.loads(line) for line in process.stdin.getvalue().splitlines()]
    assert sent[3]["params"]["sandbox"] == "read-only"
    assert sent[3]["params"]["ephemeral"] is True
    assert sent[-1]["result"]["success"] is True


async def test_authentication_missing_never_starts_a_turn(tmp_path):
    process = Process(messages(account=False))
    with pytest.raises(AgentError, match="codex_auth_required"):
        await CodexRuntime("codex", tmp_path, None)._conversation(
            process, str(tmp_path), "search", [], None, {}
        )
    assert b"thread/start" not in process.stdin.getvalue()


@pytest.mark.parametrize(
    "event",
    [
        {"id": 20, "method": "item/commandExecution/requestApproval", "params": {}},
        {"method": "item/completed", "params": {"item": {"type": "mcpToolCall"}}},
        {"id": 20, "method": "item/tool/call", "params": {"threadId": "other-thread"}},
    ],
)
async def test_unexpected_execution_and_scope_are_rejected(tmp_path, event):
    process = Process(messages() + [event])
    with pytest.raises(AgentError):
        await CodexRuntime("codex", tmp_path, None)._conversation(
            process, str(tmp_path), "search", [], None, {}
        )


async def test_timeout_kills_and_reaps_process(tmp_path, monkeypatch):
    import threading

    ended = threading.Event()

    class Pipe(io.BytesIO):
        def readline(self, *_):
            ended.wait(2)
            return b""

    class HangingProcess:
        stdin = io.BytesIO()
        stdout = Pipe()
        killed = False

        def poll(self):
            return 0 if self.killed else None

        def kill(self):
            self.killed = True
            ended.set()

        def wait(self):
            ended.wait(2)
            return 0

    process = HangingProcess()
    monkeypatch.setattr("app.integrations.agents.codex.subprocess.Popen", lambda *a, **kw: process)
    with pytest.raises(TimeoutError):
        async with asyncio.timeout(0.1):
            await CodexRuntime("codex", tmp_path, None).run("search", [], None, {})
    assert process.killed and process.stdin.closed and process.stdout.closed


async def test_installed_codex_authentication_handshake(tmp_path):
    binary = os.environ.get("LOANSIGHT_TEST_CODEX_BINARY")
    if not binary:
        pytest.skip("Set LOANSIGHT_TEST_CODEX_BINARY for the real CLI handshake")
    async with asyncio.timeout(20):
        with pytest.raises(AgentError, match="codex_auth_required"):
            await CodexRuntime(binary, tmp_path / "empty-home", None).run("test", [], None, {})
