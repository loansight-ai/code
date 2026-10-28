from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class SearchQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")

    terms: list[str] = Field(min_length=1, max_length=20)
    mode: Literal["ANY", "ALL"] = "ANY"
    node_id: str | None = Field(default=None, max_length=40)
    kind: Literal["table", "text"] | None = None
    offset: int = Field(default=0, ge=0, le=1_000_000)
    limit: int = Field(default=10, ge=1, le=30)

    @field_validator("terms")
    @classmethod
    def clean_terms(cls, terms):
        result = []
        for term in terms:
            term = term.strip()
            if not term or len(term) > 100:
                raise ValueError("search_term_requires_1_to_100_characters")
            if term not in result:
                result.append(term)
        return result


class SectionsQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")
    parent_id: str | None = Field(default=None, max_length=40)
    offset: int = Field(default=0, ge=0, le=1_000_000)
    limit: int = Field(default=30, ge=1, le=100)


class ContextQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")
    segment_id: UUID
    before: int = Field(default=2, ge=0, le=5)
    after: int = Field(default=2, ge=0, le=5)
    row_offset: int = Field(default=0, ge=0, le=1_000_000)
    row_limit: int = Field(default=10, ge=1, le=30)
    text_offset: int = Field(default=0, ge=0, le=20 * 1024 * 1024)


class Citation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    segment_id: UUID
    quote: str = Field(min_length=1, max_length=4000)
