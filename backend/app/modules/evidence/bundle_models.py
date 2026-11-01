"""Public immutable dump sources and private version-pinned evidence bundles."""

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class EvidenceDataset(Base):
    __tablename__ = "evidence_dataset"
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    signature: Mapped[str] = mapped_column(String(64), unique=True)
    status: Mapped[str] = mapped_column(String(16), default="LOADING")
    manifest: Mapped[dict] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class EvidenceReport(Base):
    __tablename__ = "evidence_report"
    __table_args__ = (UniqueConstraint("dataset_id", "corp_code", "receipt_no"),)
    id: Mapped[UUID] = mapped_column(primary_key=True)
    dataset_id: Mapped[UUID] = mapped_column(ForeignKey("evidence_dataset.id"), index=True)
    corp_code: Mapped[str] = mapped_column(String(8), index=True)
    receipt_no: Mapped[str] = mapped_column(String(14))
    period: Mapped[str] = mapped_column(String(7))
    data: Mapped[dict] = mapped_column(JSONB)


class EvidenceSegment(Base):
    __tablename__ = "evidence_segment"
    id: Mapped[UUID] = mapped_column(primary_key=True)
    report_id: Mapped[UUID] = mapped_column(ForeignKey("evidence_report.id"), index=True)
    ordinal: Mapped[int]
    region: Mapped[str] = mapped_column(String(24))
    scope: Mapped[str] = mapped_column(String(16))
    title: Mapped[str] = mapped_column(Text)
    text: Mapped[str] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(String(16))
    sha256: Mapped[str] = mapped_column(String(64))
    location: Mapped[dict] = mapped_column(JSONB)
    data: Mapped[dict] = mapped_column(JSONB)


class EvidenceBundle(Base):
    __tablename__ = "evidence_bundle"
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    workspace_id: Mapped[UUID] = mapped_column(ForeignKey("workspace.id"), index=True)
    fingerprint: Mapped[str] = mapped_column(String(64), unique=True)
    corp_code: Mapped[str] = mapped_column(String(8))
    receipt_no: Mapped[str] = mapped_column(String(14))
    scope: Mapped[str] = mapped_column(String(3))
    period: Mapped[str] = mapped_column(String(7))
    report_id: Mapped[UUID | None] = mapped_column(ForeignKey("evidence_report.id"))
    collection_import_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("company_dataset_import.id")
    )
    structure_ids: Mapped[list] = mapped_column(JSONB)
    baseline: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class BundleAgentRun(Base):
    __tablename__ = "bundle_agent_run"
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    bundle_id: Mapped[UUID] = mapped_column(ForeignKey("evidence_bundle.id"), index=True)
    job_id: Mapped[UUID] = mapped_column(ForeignKey("analysis_job.id"), unique=True)
    config_key: Mapped[str] = mapped_column(String(64), index=True)
    config: Mapped[dict] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
