from datetime import date, datetime
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class CompanyRecord(Base):
    __tablename__ = "company"
    __table_args__ = (
        CheckConstraint("corp_code ~ '^[0-9]{8}$'", name="corp_code_format"),
        Index("ix_company_active_industry_name", "active", "industry", "corp_name", "corp_code"),
        Index("ix_company_active_name", "active", "corp_name", "corp_code"),
    )

    corp_code: Mapped[str] = mapped_column(String(8), primary_key=True)
    corp_name: Mapped[str] = mapped_column(Text)
    corp_eng_name: Mapped[str | None] = mapped_column(Text)
    stock_code: Mapped[str | None] = mapped_column(String(6), index=True)
    modify_date: Mapped[str] = mapped_column(String(8))
    ksic11_code: Mapped[str | None] = mapped_column(String(5))
    ksic11_name: Mapped[str | None] = mapped_column(Text)
    ksic11_level: Mapped[int | None]
    ksic11_status: Mapped[str] = mapped_column(String(20))
    induty_code: Mapped[str | None] = mapped_column(Text)
    corp_cls: Mapped[str | None] = mapped_column(String(1))
    acc_mt: Mapped[str | None] = mapped_column(String(2))
    industry: Mapped[str | None] = mapped_column(String(20))
    search_name: Mapped[str] = mapped_column(Text)
    search_eng_name: Mapped[str] = mapped_column(Text)
    active: Mapped[bool] = mapped_column(default=True)


class CompanyImport(Base):
    __tablename__ = "company_import"
    __table_args__ = (CheckConstraint("id = 1", name="singleton"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    source_signature: Mapped[str] = mapped_column(Text)
    company_count: Mapped[int]
    imported_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class CompanyReportCatalog(Base):
    __tablename__ = "company_report_catalog"

    corp_code: Mapped[str] = mapped_column(ForeignKey("company.corp_code"), primary_key=True)
    items: Mapped[list] = mapped_column(JSONB)
    checked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    search_start: Mapped[str] = mapped_column(String(8))
    search_end: Mapped[str] = mapped_column(String(8))
    source_hashes: Mapped[list] = mapped_column(JSONB)


class CompanyDatasetImport(Base):
    __tablename__ = "company_dataset_import"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    signature: Mapped[str] = mapped_column(String(64), unique=True)
    parser_version: Mapped[str] = mapped_column(String(40))
    exported_on: Mapped[date]
    source_as_of: Mapped[date]
    manifest: Mapped[dict] = mapped_column(JSONB)
    imported_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class CollectedFinancial(Base):
    """Public source snapshot, independent of workspace-owned financial runs."""

    __tablename__ = "collected_financial"
    __table_args__ = (
        CheckConstraint("scope IN ('CFS', 'OFS')", name="scope"),
        CheckConstraint("receipt_no ~ '^[0-9]{14}$'", name="receipt_format"),
        Index("ix_collected_financial_report", "corp_code", "receipt_no", "scope"),
    )

    import_id: Mapped[UUID] = mapped_column(
        ForeignKey("company_dataset_import.id"), primary_key=True
    )
    corp_code: Mapped[str] = mapped_column(ForeignKey("company.corp_code"), primary_key=True)
    fiscal_year: Mapped[int] = mapped_column(primary_key=True)
    scope: Mapped[str] = mapped_column(String(3), primary_key=True)
    receipt_no: Mapped[str] = mapped_column(String(14))
    data: Mapped[dict] = mapped_column(JSONB)


class CollectedRiskEvent(Base):
    __tablename__ = "collected_risk_event"
    __table_args__ = (Index("ix_collected_risk_event_company_date", "corp_code", "event_date"),)

    import_id: Mapped[UUID] = mapped_column(
        ForeignKey("company_dataset_import.id"), primary_key=True
    )
    source_id: Mapped[int] = mapped_column(primary_key=True)
    corp_code: Mapped[str] = mapped_column(ForeignKey("company.corp_code"))
    receipt_no: Mapped[str] = mapped_column(String(14))
    event_date: Mapped[date]
    verified: Mapped[bool | None]
    data: Mapped[dict] = mapped_column(JSONB)


class CollectedEventCoverage(Base):
    __tablename__ = "collected_event_coverage"

    import_id: Mapped[UUID] = mapped_column(
        ForeignKey("company_dataset_import.id"), primary_key=True
    )
    corp_code: Mapped[str] = mapped_column(ForeignKey("company.corp_code"), primary_key=True)
    data: Mapped[dict] = mapped_column(JSONB)
