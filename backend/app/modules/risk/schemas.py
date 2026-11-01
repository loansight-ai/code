"""Versioned exact-match rules; a registry entry needs an explicit policy source."""

from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.modules.evidence.agent_schemas import CategoryKey
from app.modules.evidence.fact_schemas import FactKind

AXES = (
    "상환재원",
    "유동성/만기",
    "재무구조",
    "우발/부외 부담",
    "외부 평가",
    "담보/회수 여력",
    "수익성/원가구조",
    "운전자본/활동성",
    "성장의 질",
    "투자/자본효율성",
)


class Predicate(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    field: Literal["status", "direction", "detection", "amount_role"]
    values: tuple[str, ...] = Field(min_length=1, max_length=30)


class AmountCondition(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    currency: Literal["KRW", "USD", "EUR", "JPY"]
    role: Literal["BALANCE", "LIMIT", "CLAIM", "GUARANTEE", "PRINCIPAL"]
    operator: Literal["GTE", "LTE"]
    value: Decimal = Field(allow_inf_nan=False, max_digits=38, decimal_places=9)


class RuleDefinition(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    id: str = Field(min_length=1, max_length=80)
    version: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=200)
    category: CategoryKey
    kinds: tuple[FactKind, ...] = Field(min_length=1)
    axis: Literal[
        "상환재원",
        "유동성/만기",
        "재무구조",
        "우발/부외 부담",
        "외부 평가",
        "담보/회수 여력",
        "수익성/원가구조",
        "운전자본/활동성",
        "성장의 질",
        "투자/자본효율성",
    ]
    severity: Literal["WARNING", "CAUTION", "OBSERVATION"]
    policy_source: str = Field(min_length=1, max_length=1000)
    event_relation: Literal["CONDITION_PRESENT", "ACTUAL_EVENT", "EXPLICIT_NEGATION"]
    predicates: tuple[Predicate, ...] = Field(min_length=1)
    amount: AmountCondition | None = None

    @model_validator(mode="after")
    def actual_event_requires_explicit_status(self):
        if self.event_relation == "ACTUAL_EVENT" and not any(
            p.field == "status" for p in self.predicates
        ):
            raise ValueError("actual_event_requires_status_predicate")
        return self
