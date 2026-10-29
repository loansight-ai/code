from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.modules.evidence.search_schemas import Citation

CategoryKey = Literal["audit", "borrowing", "credit", "collateral", "litigation", "off_balance"]


class Finding(BaseModel):
    model_config = ConfigDict(extra="forbid")
    statement: str = Field(min_length=1, max_length=2000)
    citations: list[Citation] = Field(min_length=1, max_length=10)


class AgentItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    key: CategoryKey
    search_status: Literal["COMPLETED", "INCOMPLETE"]
    findings: list[Finding] = Field(max_length=10)
    limitations: str = Field(min_length=1, max_length=2000)


class AgentOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    items: list[AgentItem] = Field(min_length=6, max_length=6)
