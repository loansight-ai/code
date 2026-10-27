"""Parse isolated Compose fixtures without exposing the developer's real .env."""

import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
DOCKER = shutil.which("docker")
pytestmark = pytest.mark.skipif(not DOCKER, reason="Docker Compose CLI is required")


def compose_config(tmp_path, dotenv=None, **overrides):
    deploy = tmp_path / "deploy"
    deploy.mkdir()
    backend = tmp_path / "backend"
    backend.mkdir()
    for filename in ("compose.yaml", "backend.defaults.env"):
        shutil.copy2(ROOT / "deploy" / filename, deploy / filename)
    if dotenv is not None:
        (backend / ".env").write_text(dotenv, encoding="utf-8")
    environment = {
        key: value for key, value in os.environ.items() if not key.startswith("LOANSIGHT_")
    }
    environment.update(overrides)
    environment["DOCKER_CONFIG"] = str(tmp_path / "docker-config")
    result = subprocess.run(
        [DOCKER, "compose", "-f", str(deploy / "compose.yaml"), "config", "--format", "json"],
        env=environment,
        capture_output=True,
        text=True,
        check=True,
        timeout=20,
    )
    return json.loads(result.stdout)["services"]


def test_compose_keeps_development_defaults_without_dotenv(tmp_path):
    services = compose_config(tmp_path, LOANSIGHT_FRONTEND_PORT="5174")
    for name in ("api", "worker", "outbox-relay", "migrate"):
        settings = services[name]["environment"]
        assert settings["LOANSIGHT_SESSION_TTL_SECONDS"] == "86400"
        assert settings["LOANSIGHT_TASK_EVENTS_ENABLED"] == "true"
        assert "http://localhost:5174" in json.loads(settings["LOANSIGHT_ALLOWED_ORIGINS"])


def test_compose_dotenv_overrides_defaults_and_preserves_internal_connections(tmp_path):
    services = compose_config(
        tmp_path,
        "LOANSIGHT_SESSION_TTL_SECONDS=1234\n"
        "LOANSIGHT_DATABASE_TIMEOUT_SECONDS=2\n"
        "LOANSIGHT_DATABASE_URL=postgresql+psycopg://native:example@localhost/native\n"
        "LOANSIGHT_RABBITMQ_URL=amqp://native:example@localhost/\n"
        'LOANSIGHT_ALLOWED_ORIGINS=["http://localhost:9000"]\n'
        "open_dart_api_key=test-only-dart-key\n"
        "ecos_api_key=test-only-ecos-key\n"
        "open_data_api_key=test-only-data-key\n",
    )
    for name in ("api", "worker", "outbox-relay", "migrate"):
        settings = services[name]["environment"]
        assert settings["LOANSIGHT_SESSION_TTL_SECONDS"] == "1234"
        assert settings["LOANSIGHT_DATABASE_TIMEOUT_SECONDS"] == "2"
        assert "@db:5432/" in settings["LOANSIGHT_DATABASE_URL"]
        assert "@rabbitmq:5672/" in settings["LOANSIGHT_RABBITMQ_URL"]
        assert json.loads(settings["LOANSIGHT_ALLOWED_ORIGINS"]) == ["http://localhost:9000"]
        assert settings["open_dart_api_key"] == "test-only-dart-key"
        assert settings["ecos_api_key"] == "test-only-ecos-key"
        assert settings["open_data_api_key"] == "test-only-data-key"
