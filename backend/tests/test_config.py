import pytest
from pydantic import ValidationError

from app.core.config import Settings


@pytest.mark.parametrize(
    "url",
    [
        "sqlite:///database.db",
        "postgresql://user:private-password@localhost/database",
        "postgresql+psycopg://user:private-password@localhost",
        "private-password",
    ],
)
def test_invalid_database_configuration_hides_credentials(url):
    with pytest.raises(ValidationError) as error:
        Settings(_env_file=None, database_url=url)
    assert "private-password" not in str(error.value)


def test_database_url_is_required(monkeypatch):
    monkeypatch.delenv("LOANSIGHT_DATABASE_URL", raising=False)
    with pytest.raises(ValidationError):
        Settings(_env_file=None)


def test_environment_configuration(monkeypatch):
    url = "postgresql+psycopg://user:private-password@localhost/database"
    monkeypatch.setenv("LOANSIGHT_DATABASE_URL", url)
    monkeypatch.setenv("LOANSIGHT_DATABASE_TIMEOUT_SECONDS", "2")
    settings = Settings(_env_file=None)
    assert settings.database_url.get_secret_value() == url
    assert settings.database_timeout_seconds == 2
    assert "private-password" not in repr(settings)


@pytest.mark.parametrize("timeout", [0, -1, 61, float("inf"), float("nan")])
def test_database_timeout_is_bounded(timeout):
    with pytest.raises(ValidationError):
        Settings(
            _env_file=None,
            database_url="postgresql+psycopg://user:example@localhost/database",
            database_timeout_seconds=timeout,
        )
