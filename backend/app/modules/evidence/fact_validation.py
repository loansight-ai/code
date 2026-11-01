"""Mechanical checks are separate from a reviewer's semantic decision."""

import re
from decimal import localcontext

from fastapi import HTTPException

from app.modules.evidence.fact_sources import resolve
from app.modules.evidence.service import fingerprint
from app.modules.financial.domain import amount

UNITS = {
    "원": ("KRW", 1),
    "천원": ("KRW", 1000),
    "백만원": ("KRW", 1000000),
    "억원": ("KRW", 100000000),
    "USD": ("USD", 1),
    "천USD": ("USD", 1000),
    "EUR": ("EUR", 1),
    "JPY": ("JPY", 1),
}


def normalize(text):
    return re.sub(r"\s+", "", text)


def source_digest(sources):
    return fingerprint(
        [
            {k: s[k] for k in ("segment_id", "revision", "sha256", "text", "cells")}
            for s in sorted(sources.values(), key=lambda x: x["segment_id"])
        ]
    )


def period_matches(value, period, current):
    year, month = period.split(".")
    text = normalize(value)
    dated = re.search(rf"{year}[년./-]0?{int(month)}(?!\d)", text)
    return bool(dated or (current and re.search(r"(?<!전전)당기", text)))


def column_period_matches(value, period, current):
    compact = normalize(value)
    if "당기" in compact and "전기" in compact:
        return False
    dates = set(re.findall(r"(\d{4})[년./-](\d{1,2})(?!\d)", compact))
    if len({(y, int(m)) for y, m in dates}) > 1:
        return False
    return period_matches(value, period, current)


async def validate(tools, fact):
    issues, sources = [], {}

    def block(field, code, message):
        issues.append({"field": field, "code": code, "message": message})

    try:
        await tools.validate_citations(fact.citations)
        for cite in fact.citations:
            sid = str(cite.segment_id)
            if sid not in sources:
                sources[sid] = await resolve(tools, cite.segment_id)
    except HTTPException:
        return {
            "status": "BLOCKED",
            "issues": [
                {
                    "field": "citations",
                    "code": "invalid_citation",
                    "message": "같은 근거 묶음의 실제 발췌를 확인할 수 없습니다.",
                }
            ],
            "source_digest": None,
            "normalized_amount": None,
            "semantic_verified": False,
        }
    quotes = {}
    for cite in fact.citations:
        quotes.setdefault(cite.field, []).append(cite.quote)

    def require(field, value=None):
        matches = quotes.get(field, [])
        if not matches or (value and not any(normalize(value) in normalize(q) for q in matches)):
            block(field, "field_evidence_missing", f"{field} 항목의 직접 인용을 확인해야 합니다.")
        return matches

    require("statement")
    require("subject", fact.subject)
    if fact.counterparty:
        require("counterparty", fact.counterparty)
    if fact.maturity:
        require("maturity", fact.maturity)
    if fact.status:
        require("status", fact.status)
    markers = {
        "PROVIDED": r"제공(?!받)|설정",
        "RECEIVED": r"제공받|수취|받은",
        "PLAINTIFF": r"원고",
        "DEFENDANT": r"피고|피소",
        "ISSUER": r"발행",
    }
    if fact.direction != "UNKNOWN":
        q = require("direction")
        if q and not any(re.search(markers[fact.direction], normalize(s)) for s in q):
            block(
                "direction",
                "direction_not_supported",
                "제공/수취·원고/피고 방향을 원문과 대조해야 합니다.",
            )
    if fact.period:
        q = require("period")
        if q and not any(
            period_matches(s, fact.period, fact.period == tools.bundle.period) for s in q
        ):
            block(
                "period",
                "period_not_supported",
                "기준 기간을 증명하는 날짜나 당기 표시가 필요합니다.",
            )
    if fact.detection == "EXPLICITLY_NONE":
        q = require("absence")
        if not any(re.search(r"없|아니|존재하지|발생하지", s) for s in q):
            block(
                "absence", "explicit_negative_required", "미검출이 아닌 명시적 부정문이 필요합니다."
            )
        if fact.amount is not None:
            block(
                "amount", "absence_is_not_zero", "공시상 없음을 임의 금액 0으로 변환할 수 없습니다."
            )
    normalized = None
    if fact.amount:
        money = fact.amount
        if not fact.period:
            block("period", "amount_period_required", "금액의 기준 기간을 확인해야 합니다.")
        if fact.amount_role == "UNKNOWN":
            block(
                "amount_role",
                "amount_role_required",
                "한도·잔액·청구액 등 금액 역할을 확인해야 합니다.",
            )
        else:
            role_terms = {
                "BALANCE": r"잔액|장부금액|장부가액",
                "LIMIT": r"한도",
                "CLAIM": r"청구|소송가액",
                "GUARANTEE": r"보증",
                "PRINCIPAL": r"원금",
            }
            q = require("amount_role")
            if not any(re.search(role_terms[fact.amount_role], s) for s in q):
                block(
                    "amount_role",
                    "amount_role_not_supported",
                    "금액 역할의 명시적 문맥이 필요합니다.",
                )
        require("amount")
        q = require("unit")
        observed_units = set()
        for quote in q:
            observed_units.update(
                re.findall(
                    r"단위\s*[:：]?\s*\(?\s*(천USD|백만원|천원|억원|원|USD|EUR|JPY)(?![가-힣A-Z])",
                    quote,
                )
            )
        if observed_units != {money.unit}:
            block("unit", "unit_not_verified", "인용의 단위가 없거나 여러 단위로 모호합니다.")
        currency, multiplier = UNITS[money.unit]
        if money.currency != currency or (
            currency == "KRW" and any(re.search(r"USD|EUR|JPY|달러|유로|엔화", s) for s in q)
        ):
            block("currency", "currency_not_verified", "금액 통화와 단위가 일치하지 않습니다.")
        value = amount(money.raw_value)
        if value is None:
            block("amount", "numeric_value_required", "빈값·대시를 0으로 처리할 수 없습니다.")
        sid = str(money.cell.segment_id)
        if not any(c.field == "unit" and str(c.segment_id) == sid for c in fact.citations):
            block(
                "unit", "unit_not_bound_to_table", "금액 표 자체에 표시된 단위를 인용해야 합니다."
            )
        if sid not in sources or not any(
            c.field == "amount" and str(c.segment_id) == sid for c in fact.citations
        ):
            block("amount", "cell_citation_required", "금액 셀과 연결된 인용이 필요합니다.")
        else:
            source = sources[sid]
            cells = source["cells"]
            if money.cell.column >= 40:
                block(
                    "amount", "cell_not_reviewable", "검수 화면에서 표시할 수 없는 금액 열입니다."
                )
            if (
                not cells
                or money.cell.row >= len(cells)
                or money.cell.column >= len(cells[money.cell.row])
            ):
                block("amount", "cell_out_of_range", "저장된 표의 금액 셀을 확인할 수 없습니다.")
            elif value is None or amount(cells[money.cell.row][money.cell.column].strip()) != value:
                block("amount", "amount_cell_mismatch", "원문 셀 금액과 후보 금액이 다릅니다.")
            elif len(cells[money.cell.row][money.cell.column]) > 1000:
                block(
                    "amount",
                    "cell_not_reviewable",
                    "검수 화면에서 전체를 표시할 수 없는 금액 셀입니다.",
                )
            if source["scope"] == "UNKNOWN":
                block(
                    "amount", "scope_unverified", "회계 범위가 미확인인 금액은 승인할 수 없습니다."
                )
            if cells and fact.period and money.cell.row < len(cells):
                headers = [
                    r[money.cell.column]
                    for r in cells[: money.cell.row]
                    if money.cell.column < len(r)
                ]
                if not any(
                    column_period_matches(h, fact.period, fact.period == tools.bundle.period)
                    for h in headers
                ):
                    block(
                        "period",
                        "amount_column_period_unverified",
                        "금액 열의 기간 머리글 대응이 필요합니다.",
                    )
        if value is not None:
            with localcontext() as ctx:
                ctx.prec = 60
                normalized = format(value * multiplier, "f")
            if amount(normalized) is None:
                block("amount", "amount_out_of_range", "지원 금액 정밀도 범위를 초과했습니다.")
                normalized = None
    return {
        "status": "BLOCKED" if issues else "CITATIONS_VALID",
        "issues": issues,
        "source_digest": source_digest(sources),
        "normalized_amount": normalized,
        "semantic_verified": False,
    }
