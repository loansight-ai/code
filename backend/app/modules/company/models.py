from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Index, String, Text, func
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
