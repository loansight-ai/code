from datetime import date, datetime
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    func,
)
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
        CheckConstraint("fs_div IN ('CFS', 'OFS')", name="scope"),
        CheckConstraint("rcept_no ~ '^[0-9]{14}$'", name="receipt_format"),
        Index("ix_collected_financial_report", "corp_code", "rcept_no", "fs_div"),
    )

    import_id: Mapped[UUID] = mapped_column(
        ForeignKey("company_dataset_import.id"), primary_key=True
    )
    corp_code: Mapped[str] = mapped_column(ForeignKey("company.corp_code"), primary_key=True)
    fiscal_year: Mapped[int] = mapped_column("bsns_year", Integer, primary_key=True)
    scope: Mapped[str] = mapped_column("fs_div", String(3), primary_key=True)
    receipt_no: Mapped[str] = mapped_column("rcept_no", String(14))
    bs_ap: Mapped[Decimal | None] = mapped_column(Numeric())
    bs_ar: Mapped[Decimal | None] = mapped_column(Numeric())
    bs_assoc: Mapped[Decimal | None] = mapped_column(Numeric())
    bs_bond: Mapped[Decimal | None] = mapped_column(Numeric())
    bs_borrow: Mapped[Decimal | None] = mapped_column(Numeric())
    bs_borrow_st: Mapped[Decimal | None] = mapped_column(Numeric())
    bs_ca: Mapped[Decimal | None] = mapped_column(Numeric())
    bs_ca_other: Mapped[Decimal | None] = mapped_column(Numeric())
    bs_cap: Mapped[Decimal | None] = mapped_column(Numeric())
    bs_capsur: Mapped[Decimal | None] = mapped_column(Numeric())
    bs_cash: Mapped[Decimal | None] = mapped_column(Numeric())
    bs_cbond: Mapped[Decimal | None] = mapped_column(Numeric())
    bs_cl: Mapped[Decimal | None] = mapped_column(Numeric())
    bs_cl_other: Mapped[Decimal | None] = mapped_column(Numeric())
    bs_clease: Mapped[Decimal | None] = mapped_column(Numeric())
    bs_contract_a: Mapped[Decimal | None] = mapped_column(Numeric())
    bs_contract_l: Mapped[Decimal | None] = mapped_column(Numeric())
    bs_cpltd: Mapped[Decimal | None] = mapped_column(Numeric())
    bs_ctax: Mapped[Decimal | None] = mapped_column(Numeric())
    bs_dbo: Mapped[Decimal | None] = mapped_column(Numeric())
    bs_dta: Mapped[Decimal | None] = mapped_column(Numeric())
    bs_dtl: Mapped[Decimal | None] = mapped_column(Numeric())
    bs_eq_p: Mapped[Decimal | None] = mapped_column(Numeric())
    bs_goodwill: Mapped[Decimal | None] = mapped_column(Numeric())
    bs_intan: Mapped[Decimal | None] = mapped_column(Numeric())
    bs_inv: Mapped[Decimal | None] = mapped_column(Numeric())
    bs_ip: Mapped[Decimal | None] = mapped_column(Numeric())
    bs_lease: Mapped[Decimal | None] = mapped_column(Numeric())
    bs_ltb: Mapped[Decimal | None] = mapped_column(Numeric())
    bs_nca: Mapped[Decimal | None] = mapped_column(Numeric())
    bs_nca_other: Mapped[Decimal | None] = mapped_column(Numeric())
    bs_nci: Mapped[Decimal | None] = mapped_column(Numeric())
    bs_ncl: Mapped[Decimal | None] = mapped_column(Numeric())
    bs_ncl_other: Mapped[Decimal | None] = mapped_column(Numeric())
    bs_nclease: Mapped[Decimal | None] = mapped_column(Numeric())
    bs_other_eq: Mapped[Decimal | None] = mapped_column(Numeric())
    bs_ppe: Mapped[Decimal | None] = mapped_column(Numeric())
    bs_re: Mapped[Decimal | None] = mapped_column(Numeric())
    bs_rou: Mapped[Decimal | None] = mapped_column(Numeric())
    bs_stb: Mapped[Decimal | None] = mapped_column(Numeric())
    bs_stfi: Mapped[Decimal | None] = mapped_column(Numeric())
    bs_ta: Mapped[Decimal | None] = mapped_column(Numeric())
    bs_te: Mapped[Decimal | None] = mapped_column(Numeric())
    bs_tl: Mapped[Decimal | None] = mapped_column(Numeric())
    bs_tle: Mapped[Decimal | None] = mapped_column(Numeric())
    cf_amort: Mapped[Decimal | None] = mapped_column(Numeric())
    cf_bond_in: Mapped[Decimal | None] = mapped_column(Numeric())
    cf_bond_out: Mapped[Decimal | None] = mapped_column(Numeric())
    cf_capex: Mapped[Decimal | None] = mapped_column(Numeric())
    cf_cash_beg: Mapped[Decimal | None] = mapped_column(Numeric())
    cf_cash_end: Mapped[Decimal | None] = mapped_column(Numeric())
    cf_cash_gen: Mapped[Decimal | None] = mapped_column(Numeric())
    cf_cff: Mapped[Decimal | None] = mapped_column(Numeric())
    cf_cff_other: Mapped[Decimal | None] = mapped_column(Numeric())
    cf_cfi: Mapped[Decimal | None] = mapped_column(Numeric())
    cf_cfi_other: Mapped[Decimal | None] = mapped_column(Numeric())
    cf_cfo: Mapped[Decimal | None] = mapped_column(Numeric())
    cf_dep: Mapped[Decimal | None] = mapped_column(Numeric())
    cf_div_paid: Mapped[Decimal | None] = mapped_column(Numeric())
    cf_div_rec: Mapped[Decimal | None] = mapped_column(Numeric())
    cf_eq_iss: Mapped[Decimal | None] = mapped_column(Numeric())
    cf_fcf: Mapped[Decimal | None] = mapped_column(Numeric())
    cf_fx: Mapped[Decimal | None] = mapped_column(Numeric())
    cf_int_paid: Mapped[Decimal | None] = mapped_column(Numeric())
    cf_int_rec: Mapped[Decimal | None] = mapped_column(Numeric())
    cf_intan_acq: Mapped[Decimal | None] = mapped_column(Numeric())
    cf_ip_acq: Mapped[Decimal | None] = mapped_column(Numeric())
    cf_ip_disp: Mapped[Decimal | None] = mapped_column(Numeric())
    cf_lease_pay: Mapped[Decimal | None] = mapped_column(Numeric())
    cf_ltb_in: Mapped[Decimal | None] = mapped_column(Numeric())
    cf_ltb_out: Mapped[Decimal | None] = mapped_column(Numeric())
    cf_net: Mapped[Decimal | None] = mapped_column(Numeric())
    cf_net_borrow: Mapped[Decimal | None] = mapped_column(Numeric())
    cf_ni: Mapped[Decimal | None] = mapped_column(Numeric())
    cf_ppe_disp: Mapped[Decimal | None] = mapped_column(Numeric())
    cf_stb_in: Mapped[Decimal | None] = mapped_column(Numeric())
    cf_stb_out: Mapped[Decimal | None] = mapped_column(Numeric())
    cf_tax_paid: Mapped[Decimal | None] = mapped_column(Numeric())
    cf_ts_acq: Mapped[Decimal | None] = mapped_column(Numeric())
    cf_wc: Mapped[Decimal | None] = mapped_column(Numeric())
    is_cogs: Mapped[Decimal | None] = mapped_column(Numeric())
    is_dep: Mapped[Decimal | None] = mapped_column(Numeric())
    is_disc: Mapped[Decimal | None] = mapped_column(Numeric())
    is_ebitda: Mapped[Decimal | None] = mapped_column(Numeric())
    is_ebt: Mapped[Decimal | None] = mapped_column(Numeric())
    is_eq_method: Mapped[Decimal | None] = mapped_column(Numeric())
    is_fin_cost: Mapped[Decimal | None] = mapped_column(Numeric())
    is_fin_inc: Mapped[Decimal | None] = mapped_column(Numeric())
    is_gp: Mapped[Decimal | None] = mapped_column(Numeric())
    is_int_exp: Mapped[Decimal | None] = mapped_column(Numeric())
    is_ni: Mapped[Decimal | None] = mapped_column(Numeric())
    is_ni_nci: Mapped[Decimal | None] = mapped_column(Numeric())
    is_ni_p: Mapped[Decimal | None] = mapped_column(Numeric())
    is_nonop_other: Mapped[Decimal | None] = mapped_column(Numeric())
    is_oci: Mapped[Decimal | None] = mapped_column(Numeric())
    is_op: Mapped[Decimal | None] = mapped_column(Numeric())
    is_op_other: Mapped[Decimal | None] = mapped_column(Numeric())
    is_opex: Mapped[Decimal | None] = mapped_column(Numeric())
    is_other_exp: Mapped[Decimal | None] = mapped_column(Numeric())
    is_other_inc: Mapped[Decimal | None] = mapped_column(Numeric())
    is_rev: Mapped[Decimal | None] = mapped_column(Numeric())
    is_sga: Mapped[Decimal | None] = mapped_column(Numeric())
    is_tax: Mapped[Decimal | None] = mapped_column(Numeric())
    is_tci: Mapped[Decimal | None] = mapped_column(Numeric())
    nt_dev: Mapped[Decimal | None] = mapped_column(Numeric())
    nt_disp_gain: Mapped[Decimal | None] = mapped_column(Numeric())
    nt_fv_gain: Mapped[Decimal | None] = mapped_column(Numeric())
    nt_pf: Mapped[Decimal | None] = mapped_column(Numeric())
    nt_rate_max: Mapped[Decimal | None] = mapped_column(Numeric())
    nt_rate_min: Mapped[Decimal | None] = mapped_column(Numeric())
    nt_rate_wavg: Mapped[Decimal | None] = mapped_column(Numeric())
    nt_rental: Mapped[Decimal | None] = mapped_column(Numeric())
    sce_adj: Mapped[Decimal | None] = mapped_column(Numeric())
    sce_beg: Mapped[Decimal | None] = mapped_column(Numeric())
    sce_div: Mapped[Decimal | None] = mapped_column(Numeric())
    sce_end: Mapped[Decimal | None] = mapped_column(Numeric())
    sce_iss: Mapped[Decimal | None] = mapped_column(Numeric())
    sce_ni: Mapped[Decimal | None] = mapped_column(Numeric())
    sce_oci: Mapped[Decimal | None] = mapped_column(Numeric())
    sce_other: Mapped[Decimal | None] = mapped_column(Numeric())
    sce_ts: Mapped[Decimal | None] = mapped_column(Numeric())
    corp_name: Mapped[str | None] = mapped_column(Text)
    industry: Mapped[str | None] = mapped_column(Text)
    industry_group: Mapped[str | None] = mapped_column(Text)
    is_format: Mapped[str | None] = mapped_column(Text)
    nt_ip_model: Mapped[str | None] = mapped_column(Text)


class CollectedRiskEvent(Base):
    __tablename__ = "collected_risk_event"
    __table_args__ = (Index("ix_collected_risk_event_company_date", "corp_code", "event_date"),)

    import_id: Mapped[UUID] = mapped_column(
        ForeignKey("company_dataset_import.id"), primary_key=True
    )
    source_id: Mapped[int] = mapped_column("id", Integer, primary_key=True)
    corp_code: Mapped[str] = mapped_column(ForeignKey("company.corp_code"))
    receipt_no: Mapped[str] = mapped_column("rcept_no", String(14))
    event_date: Mapped[date]
    verified: Mapped[bool | None]
    corp_name: Mapped[str | None] = mapped_column(Text)
    date_basis: Mapped[str | None] = mapped_column(Text)
    detail: Mapped[str | None] = mapped_column(Text)
    event_type: Mapped[str | None] = mapped_column(Text)
    fiscal_period: Mapped[str | None] = mapped_column(Text)
    industry: Mapped[str | None] = mapped_column(Text)
    is_first_of_type: Mapped[bool | None] = mapped_column()
    rcept_dt: Mapped[date | None] = mapped_column()
    severity: Mapped[str | None] = mapped_column(Text)
    source: Mapped[str | None] = mapped_column(Text)
    title: Mapped[str | None] = mapped_column(Text)
    use: Mapped[str | None] = mapped_column(Text)


class CollectedEventCoverage(Base):
    __tablename__ = "collected_event_coverage"

    import_id: Mapped[UUID] = mapped_column(
        ForeignKey("company_dataset_import.id"), primary_key=True
    )
    corp_code: Mapped[str] = mapped_column(ForeignKey("company.corp_code"), primary_key=True)
    audit_api_calls: Mapped[int | None] = mapped_column()
    audit_doc_ok: Mapped[int | None] = mapped_column()
    audit_doc_reports: Mapped[int | None] = mapped_column()
    corp_cls_name: Mapped[str | None] = mapped_column(Text)
    corp_name: Mapped[str | None] = mapped_column(Text)
    filings_b: Mapped[str | None] = mapped_column(Text)
    filings_b_count: Mapped[int | None] = mapped_column()
    filings_fetched_at: Mapped[datetime | None] = mapped_column()
    filings_i: Mapped[str | None] = mapped_column(Text)
    filings_i_count: Mapped[int | None] = mapped_column()
    filings_range: Mapped[str | None] = mapped_column(Text)
    first_event_date: Mapped[date | None] = mapped_column()
    first_period: Mapped[str | None] = mapped_column(Text)
    industry: Mapped[str | None] = mapped_column(Text)
    label_candidates: Mapped[int | None] = mapped_column()
    last_period: Mapped[str | None] = mapped_column(Text)
    major_bnkmngtpcbg: Mapped[str | None] = mapped_column(Text)
    major_ctrcvsbgrq: Mapped[str | None] = mapped_column(Text)
    major_dfocr: Mapped[str | None] = mapped_column(Text)
    major_fetched_at: Mapped[datetime | None] = mapped_column()
    major_range: Mapped[str | None] = mapped_column(Text)
