from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class NoteInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    corp_code: str = Field(pattern=r"^[0-9]{8}$")
    receipt_no: str = Field(pattern=r"^[0-9]{14}$")
    scope: Literal["CFS", "OFS"]
    period: str = Field(pattern=r"^[0-9]{4}\.(0[1-9]|1[0-2])$")
    encoding: Literal["utf-8", "euc-kr"] = "utf-8"
    link_periods: bool = True
