from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.modules.company.models import CompanyRecord


class DartDocument(Base):
    __tablename__ = "dart_document"

    receipt_no: Mapped[str] = mapped_column(String(14), primary_key=True)
    corp_code: Mapped[str] = mapped_column(ForeignKey(CompanyRecord.corp_code))
    archive_sha256: Mapped[str] = mapped_column(String(64))
    archive_bytes: Mapped[int]
    xml_files: Mapped[list] = mapped_column(JSONB)
    toc_sha256: Mapped[str] = mapped_column(String(64))
    locators: Mapped[dict] = mapped_column(JSONB)
    collected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class DartNote(Base):
    __tablename__ = "dart_note"
    __table_args__ = (UniqueConstraint("receipt_no", "scope"),)

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    receipt_no: Mapped[str] = mapped_column(ForeignKey("dart_document.receipt_no"))
    scope: Mapped[str] = mapped_column(String(3))
    sha256: Mapped[str] = mapped_column(String(64))
    byte_length: Mapped[int]
    encoding: Mapped[str] = mapped_column(String(16))
    locator: Mapped[dict] = mapped_column(JSONB)
    collector_version: Mapped[str] = mapped_column(String(32))
    collected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class DartCollectionRequest(Base):
    __tablename__ = "dart_collection_request"

    job_id: Mapped[UUID] = mapped_column(ForeignKey("analysis_job.id"), primary_key=True)
    workspace_id: Mapped[UUID] = mapped_column(ForeignKey("workspace.id"))
    context: Mapped[dict] = mapped_column(JSONB)
