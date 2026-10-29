from datetime import datetime
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import DateTime, ForeignKey, Numeric, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class FinancialRun(Base):
    __tablename__ = "financial_run"
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    workspace_id: Mapped[UUID] = mapped_column(ForeignKey("workspace.id"), index=True)
    job_id: Mapped[UUID] = mapped_column(ForeignKey("analysis_job.id"), unique=True)
    context: Mapped[dict] = mapped_column(JSONB)
    source_sha256: Mapped[str | None] = mapped_column(String(64))
    result: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class FinancialFact(Base):
    __tablename__ = "financial_fact"
    __table_args__ = (UniqueConstraint("run_id", "account_key", "period"),)
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    run_id: Mapped[UUID] = mapped_column(ForeignKey("financial_run.id"), index=True)
    account_key: Mapped[str] = mapped_column(String(64))
    period: Mapped[str] = mapped_column(String(24))
    amount: Mapped[Decimal | None] = mapped_column(Numeric(38, 6))
    provenance: Mapped[dict] = mapped_column(JSONB)
