"""Immutable fact payloads with append-only review history and opening receipts."""

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class EvidenceFact(Base):
    __tablename__ = "evidence_fact"
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    bundle_id: Mapped[UUID] = mapped_column(ForeignKey("evidence_bundle.id"), index=True)
    root_id: Mapped[UUID]
    supersedes_id: Mapped[UUID | None] = mapped_column(ForeignKey("evidence_fact.id"), unique=True)
    revision: Mapped[int]
    fingerprint: Mapped[str] = mapped_column(String(64), unique=True)
    comparison_key: Mapped[str] = mapped_column(String(64), index=True)
    value_key: Mapped[str] = mapped_column(String(64))
    data: Mapped[dict] = mapped_column(JSONB)
    validation: Mapped[dict] = mapped_column(JSONB)
    origin: Mapped[dict] = mapped_column(JSONB)
    state: Mapped[str] = mapped_column(String(16), default="PENDING")
    version: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class FactOpening(Base):
    __tablename__ = "fact_opening"
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    fact_id: Mapped[UUID] = mapped_column(ForeignKey("evidence_fact.id"), index=True)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("app_user.id"))
    fact_version: Mapped[int]
    source_digest: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class FactReview(Base):
    __tablename__ = "fact_review"
    __table_args__ = (UniqueConstraint("fact_id", "request_id"),)
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    fact_id: Mapped[UUID] = mapped_column(ForeignKey("evidence_fact.id"), index=True)
    request_id: Mapped[UUID]
    reviewer_id: Mapped[UUID] = mapped_column(ForeignKey("app_user.id"))
    opening_id: Mapped[UUID | None] = mapped_column(ForeignKey("fact_opening.id"))
    decision: Mapped[str] = mapped_column(String(16))
    reason: Mapped[str] = mapped_column(String(2000))
    before_state: Mapped[str] = mapped_column(String(16))
    after_state: Mapped[str] = mapped_column(String(16))
    version: Mapped[int]
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class FactExtraction(Base):
    __tablename__ = "fact_extraction"
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    bundle_id: Mapped[UUID] = mapped_column(ForeignKey("evidence_bundle.id"), index=True)
    job_id: Mapped[UUID] = mapped_column(ForeignKey("analysis_job.id"), unique=True)
    config_key: Mapped[str] = mapped_column(String(64), index=True)
    config: Mapped[dict] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
