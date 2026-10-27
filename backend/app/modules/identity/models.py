from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class User(Base):
    __tablename__ = "app_user"
    __table_args__ = (CheckConstraint("user_code ~ '^[0-9]{5}$'", name="user_code_format"),)

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    user_code: Mapped[str] = mapped_column(String(5), unique=True)
    active: Mapped[bool] = mapped_column(default=True)
    account_linked: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Workspace(Base):
    __tablename__ = "workspace"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    owner_user_id: Mapped[UUID] = mapped_column(ForeignKey("app_user.id"), unique=True)
    stream_id: Mapped[UUID] = mapped_column(default=uuid4, unique=True)
    event_seq: Mapped[int] = mapped_column(BigInteger, default=0)


class UserSession(Base):
    __tablename__ = "user_session"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("app_user.id"))
    workspace_id: Mapped[UUID] = mapped_column(ForeignKey("workspace.id"))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class EntryBucket(Base):
    __tablename__ = "entry_bucket"

    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    window_start: Mapped[int] = mapped_column(BigInteger)
    count: Mapped[int] = mapped_column(default=1)
