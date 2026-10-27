from pathlib import Path

from pydantic import AliasChoices, Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url
from sqlalchemy.exc import ArgumentError


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="LOANSIGHT_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        hide_input_in_errors=True,
    )

    database_url: SecretStr
    database_timeout_seconds: float = Field(default=3, gt=0, le=60)
    artifact_root: Path = Path(".run/artifacts")
    note_import_max_bytes: int = Field(default=20 * 1024 * 1024, gt=0)
    open_dart_api_key: SecretStr | None = Field(
        default=None,
        validation_alias=AliasChoices("LOANSIGHT_OPEN_DART_API_KEY", "open_dart_api_key"),
    )
    ecos_api_key: SecretStr | None = Field(
        default=None,
        validation_alias=AliasChoices("LOANSIGHT_ECOS_API_KEY", "ecos_api_key"),
    )
    open_data_api_key: SecretStr | None = Field(
        default=None,
        validation_alias=AliasChoices("LOANSIGHT_OPEN_DATA_API_KEY", "open_data_api_key"),
    )
    # Business policies have no defaults; deployments must supply explicit values.
    session_ttl_seconds: int | None = Field(default=None, gt=0)
    entry_window_seconds: int | None = Field(default=None, gt=0)
    entry_ip_limit: int | None = Field(default=None, gt=0)
    entry_code_limit: int | None = Field(default=None, gt=0)
    entry_global_limit: int | None = Field(default=None, gt=0)
    allowed_origins: list[str] = Field(default_factory=list)
    cookie_secure: bool = True
    task_events_enabled: bool = False
    rabbitmq_url: SecretStr | None = None
    queue_name: str = "loansight.jobs.v1"
    job_lease_seconds: int = Field(default=30, ge=3)
    job_max_attempts: int | None = Field(default=None, gt=0)
    retry_delay_seconds: int = Field(default=5, gt=0)
    relay_interval_seconds: float = Field(default=1, gt=0)
    event_batch_size: int = Field(default=100, gt=0, le=1000)
    sse_heartbeat_seconds: float = Field(default=10, gt=0)

    @field_validator("open_dart_api_key", "ecos_api_key", "open_data_api_key", mode="before")
    @classmethod
    def normalize_api_key(cls, value):
        if isinstance(value, SecretStr):
            value = value.get_secret_value()
        if isinstance(value, str):
            return value.strip() or None
        return value

    @field_validator("database_url")
    @classmethod
    def validate_database_url(cls, value: SecretStr) -> SecretStr:
        try:
            url = make_url(value.get_secret_value())
        except ArgumentError:
            raise ValueError("database_url must be a valid PostgreSQL URL") from None
        if url.drivername != "postgresql+psycopg" or not url.host or not url.database:
            raise ValueError("database_url requires postgresql+psycopg, host and database")
        return value
