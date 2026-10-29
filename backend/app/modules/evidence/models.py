from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class SourceArtifact(Base):
    __tablename__ = "source_artifact"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    source_key: Mapped[str] = mapped_column(String(64), unique=True)
    workspace_id: Mapped[UUID] = mapped_column(ForeignKey("workspace.id"), index=True)
    corp_code: Mapped[str] = mapped_column(String(8))
    receipt_no: Mapped[str] = mapped_column(String(14))
    scope: Mapped[str] = mapped_column(String(3))
    period: Mapped[str] = mapped_column(String(7))
    encoding: Mapped[str] = mapped_column(String(16))
    sha256: Mapped[str] = mapped_column(String(64))
    byte_length: Mapped[int]
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    dart_note_id: Mapped[UUID | None] = mapped_column(ForeignKey("dart_note.id"))


class NoteStructure(Base):
    __tablename__ = "note_structure"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    artifact_id: Mapped[UUID] = mapped_column(ForeignKey("source_artifact.id"), index=True)
    job_id: Mapped[UUID] = mapped_column(ForeignKey("analysis_job.id"), unique=True)
    parser_version: Mapped[str] = mapped_column(String(32))
    adapter_version: Mapped[str] = mapped_column(String(32))
    rules_sha256: Mapped[str] = mapped_column(String(64))
    rules: Mapped[dict] = mapped_column(JSONB)
    link_periods: Mapped[bool]
    hierarchy: Mapped[dict | None] = mapped_column(JSONB)
    segment_count: Mapped[int | None]
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SourceSegment(Base):
    __tablename__ = "source_segment"
    __table_args__ = (
        UniqueConstraint("structure_id", "local_id"),
        UniqueConstraint("structure_id", "ordinal", name="uq_source_segment_structure_ordinal"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True)
    structure_id: Mapped[UUID] = mapped_column(ForeignKey("note_structure.id"), index=True)
    local_id: Mapped[str] = mapped_column(String(40))
    ordinal: Mapped[int]
    kind: Mapped[str] = mapped_column(String(32))
    source_xpath: Mapped[str] = mapped_column(Text)
    text: Mapped[str] = mapped_column(Text)
    owner_node_id: Mapped[str] = mapped_column(String(40))
    top_note_ids: Mapped[list] = mapped_column(JSONB)
    payload: Mapped[dict] = mapped_column(JSONB)
    table_data: Mapped[dict | None] = mapped_column(JSONB)


class NoteSearchRun(Base):
    __tablename__ = "note_search_run"
    __table_args__ = (
        UniqueConstraint("workspace_id", "structure_id", "dictionary_version", "tool_version"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    workspace_id: Mapped[UUID] = mapped_column(ForeignKey("workspace.id"))
    structure_id: Mapped[UUID] = mapped_column(ForeignKey("note_structure.id"), index=True)
    dictionary_version: Mapped[str] = mapped_column(String(40))
    tool_version: Mapped[str] = mapped_column(String(40))
    result: Mapped[dict] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class NoteAgentRun(Base):
    __tablename__ = "note_agent_run"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    workspace_id: Mapped[UUID] = mapped_column(ForeignKey("workspace.id"))
    structure_id: Mapped[UUID] = mapped_column(ForeignKey("note_structure.id"), index=True)
    job_id: Mapped[UUID] = mapped_column(ForeignKey("analysis_job.id"), unique=True)
    config_key: Mapped[str] = mapped_column(String(64), index=True)
    config: Mapped[dict] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
