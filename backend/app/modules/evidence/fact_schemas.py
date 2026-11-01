from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.modules.evidence.agent_schemas import CategoryKey
from app.modules.evidence.search_schemas import Citation

FactKind = Literal[
    "audit_opinion",
    "going_concern",
    "borrowing_maturity",
    "covenant",
    "credit_rating",
    "collateral",
    "litigation",
    "sanction",
    "guarantee",
    "subsequent_event",
]
FieldKey = Literal[
    "statement",
    "subject",
    "direction",
    "period",
    "counterparty",
    "amount",
    "unit",
    "currency",
    "maturity",
    "status",
    "absence",
    "amount_role",
    "obligation_type",
    "aggregation_level",
    "project_count",
    "case_number",
    "case_count",
]


class FactCitation(Citation):
    field: FieldKey = "statement"


class AmountCell(BaseModel):
    model_config = ConfigDict(extra="forbid")
    segment_id: UUID
    row: int = Field(ge=0)
    column: int = Field(ge=0)


class FactAmount(BaseModel):
    model_config = ConfigDict(extra="forbid")
    raw_value: str = Field(min_length=1, max_length=100)
    currency: Literal["KRW", "USD", "EUR", "JPY"]
    unit: Literal["원", "천원", "백만원", "억원", "USD", "천USD", "EUR", "JPY"]
    cell: AmountCell


class FactInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    category: CategoryKey
    kind: FactKind
    statement: str = Field(min_length=1, max_length=2000)
    subject: str = Field(min_length=1, max_length=200)
    direction: Literal["PROVIDED", "RECEIVED", "PLAINTIFF", "DEFENDANT", "ISSUER", "UNKNOWN"] = (
        "UNKNOWN"
    )
    period: str | None = Field(default=None, pattern=r"^\d{4}\.(0[1-9]|1[0-2])$")
    counterparty: str | None = Field(default=None, max_length=300)
    amount_role: Literal[
        "BALANCE",
        "LIMIT",
        "CLAIM",
        "GUARANTEE",
        "PRINCIPAL",
        "UNKNOWN",
        "LOAN_BALANCE",
        "COMMITMENT",
        "RELATED_PARTY",
        "PROVISION",
    ] = "UNKNOWN"
    amount: FactAmount | None = None
    maturity: str | None = Field(default=None, max_length=200)
    status: str | None = Field(default=None, max_length=300)
    detection: Literal["DETECTED", "EXPLICITLY_NONE"] = "DETECTED"
    citations: list[FactCitation] = Field(min_length=1, max_length=20)
    obligation_type: (
        Literal["PF_GUARANTEE", "COMPLETION_SUPPORT", "FUNDING_SUPPORT", "BUYER_GUARANTEE", "OTHER"]
        | None
    ) = None
    aggregation_level: Literal["DETAIL", "SUBTOTAL", "TOTAL", "UNKNOWN"] = "UNKNOWN"
    project_count: int | None = Field(default=None, ge=0)
    case_number: str | None = Field(default=None, min_length=1, max_length=100)
    case_count: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def kind_matches_category(self):
        if not self.statement.strip() or not self.subject.strip():
            raise ValueError("fact_text_required")
        allowed = {
            "audit": {"audit_opinion", "going_concern"},
            "borrowing": {"borrowing_maturity", "covenant"},
            "credit": {"credit_rating"},
            "collateral": {"collateral"},
            "litigation": {"litigation", "sanction"},
            "off_balance": {"guarantee", "subsequent_event"},
        }
        if self.kind not in allowed[self.category]:
            raise ValueError("fact_kind_category_mismatch")
        if self.kind != "guarantee" and (self.obligation_type or self.project_count is not None):
            raise ValueError("guarantee_metadata_kind_mismatch")
        if self.kind != "litigation" and (self.case_number or self.case_count is not None):
            raise ValueError("litigation_metadata_kind_mismatch")
        return self


class RevisionInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: int = Field(ge=0)
    reason: str = Field(min_length=1, max_length=2000)
    fact: FactInput


class ReviewInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: UUID
    expected_version: int = Field(ge=0)
    decision: Literal["APPROVE", "REJECT", "REOPEN"]
    reason: str = Field(min_length=1, max_length=2000)
    opening_id: UUID | None = None


class ExtractionOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    facts: list[FactInput] = Field(max_length=100)
    searched_categories: list[CategoryKey] = Field(max_length=6)
    limitations: str = Field(min_length=1, max_length=4000)
