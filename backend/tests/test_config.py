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


@pytest.mark.parametrize(
    "field,environment_name",
    [
        ("open_dart_api_key", "LOANSIGHT_OPEN_DART_API_KEY"),
        ("open_dart_api_key", "open_dart_api_key"),
        ("ecos_api_key", "LOANSIGHT_ECOS_API_KEY"),
        ("ecos_api_key", "ecos_api_key"),
        ("open_data_api_key", "LOANSIGHT_OPEN_DATA_API_KEY"),
        ("open_data_api_key", "open_data_api_key"),
    ],
)
def test_api_keys_accept_prefixed_and_existing_names(monkeypatch, field, environment_name):
    for name in (
        "LOANSIGHT_OPEN_DART_API_KEY",
        "open_dart_api_key",
        "LOANSIGHT_ECOS_API_KEY",
        "ecos_api_key",
        "LOANSIGHT_OPEN_DATA_API_KEY",
        "open_data_api_key",
    ):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv(environment_name, "  test-only-private-api-key  ")
    settings = Settings(
        _env_file=None,
        database_url="postgresql+psycopg://test:example@localhost/test",
    )
    assert getattr(settings, field).get_secret_value() == "test-only-private-api-key"
    assert "test-only-private-api-key" not in repr(settings)
    assert "test-only-private-api-key" not in settings.model_dump_json()


def test_api_keys_load_from_dotenv_and_canonical_name_has_priority(tmp_path, monkeypatch):
    monkeypatch.delenv("LOANSIGHT_OPEN_DART_API_KEY", raising=False)
    monkeypatch.delenv("open_dart_api_key", raising=False)
    dotenv = tmp_path / ".env"
    dotenv.write_text(
        "LOANSIGHT_DATABASE_URL=postgresql+psycopg://test:example@localhost/test\n"
        "open_dart_api_key=legacy-test-key\n"
        "LOANSIGHT_OPEN_DART_API_KEY=canonical-test-key\n"
        "ecos_api_key=ecos-test-key\n"
        "open_data_api_key=\n",
        encoding="utf-8",
    )
    settings = Settings(_env_file=dotenv)
    assert settings.open_dart_api_key.get_secret_value() == "canonical-test-key"
    assert settings.ecos_api_key.get_secret_value() == "ecos-test-key"
    assert settings.open_data_api_key is None
    monkeypatch.setenv("LOANSIGHT_OPEN_DART_API_KEY", "environment-test-key")
    assert Settings(_env_file=dotenv).open_dart_api_key.get_secret_value() == "environment-test-key"


@pytest.mark.parametrize("value", ["", "   ", "\t"])
def test_blank_api_keys_are_unconfigured(value):
    settings = Settings(
        _env_file=None,
        database_url="postgresql+psycopg://test:example@localhost/test",
        open_dart_api_key=value,
        ecos_api_key=value,
        open_data_api_key=value,
    )
    assert settings.open_dart_api_key is None
    assert settings.ecos_api_key is None
    assert settings.open_data_api_key is None
