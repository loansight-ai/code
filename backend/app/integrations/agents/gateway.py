from app.integrations.agents.codex import CodexRuntime
from app.integrations.agents.runtime import AgentError, AgentRuntime


def configured(settings) -> bool:
    return bool(
        settings.note_agent_provider == "codex"
        and settings.codex_home
        and settings.note_agent_timeout_seconds
        and settings.note_agent_max_tool_calls
    )


def runtime_for(config: dict, settings) -> AgentRuntime:
    if config["provider"] != "codex" or settings.codex_home is None:
        raise AgentError("note_agent_not_configured")
    return CodexRuntime(settings.codex_binary, settings.codex_home, config["model"])
