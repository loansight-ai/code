from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Protocol

ToolCall = Callable[[str, dict], Awaitable[dict]]


class AgentError(Exception):
    """Only a stable, credential-free code may cross the adapter boundary."""

    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


@dataclass(frozen=True)
class AgentResponse:
    text: str
    model: str
    thread_id: str


class AgentRuntime(Protocol):
    async def run(
        self, prompt: str, definitions: list[dict], call: ToolCall, output_schema: dict
    ) -> AgentResponse: ...
