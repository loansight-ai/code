"""Display comparison boundaries and their per-cell provenance."""

import csv
import hashlib
import io
from decimal import Decimal, InvalidOperation
from functools import lru_cache
from pathlib import Path

CONTRACT_VERSION = "core-relative-bands-v1"
DATA_PATH = Path(__file__).resolve().parents[3] / "data" / "2016-2025_화면비교기준.csv"
INDUSTRIES = {
    "제조": ("C10-34", "제조업"),
    "건설": ("F41-42", "건설업"),
    "도소매": ("G45-47", "도매 및 소매업"),
    "부동산 임대": ("L68", "부동산임대업"),
}
METRICS = {
    "current_ratio": "유동비율",
    "debt_ratio": "부채비율",
    "operating_margin": "매출액영업이익률",
    "operating_roa": "총자산영업이익률",
    "interest_coverage": "이자보상비율",
}
FIELDS = {"aggregate": "업종합산비율", "q1": "Q1", "median": "중앙값", "q3": "Q3"}
BOUNDARIES = {key: label for key, label in FIELDS.items() if key != "aggregate"}
SOURCE_NOTE = (
    "제공된 화면 비교기준의 ECOS/OFS 출처를 경계별로 표시합니다. "
    "OFS 수집 표본은 업종 전체를 대표한다는 보장이 없으며, 기업대상 ‘전체’는 ECOS의 "
    "기업 규모 구분입니다. 업종합산비율은 별도 참고값이며 사분위수·기업별 중앙값이 아닙니다."
)


def decimal_value(raw):
    if not isinstance(raw, str) or not raw.strip():
        return None
    try:
        value = Decimal(raw)
        return value if value.is_finite() else None
    except InvalidOperation:
        return None


def number(row, column):
    value = decimal_value(row[column])
    if row[column].strip() and value is None:
        raise ValueError("core_ratio_number_invalid")
    return value


@lru_cache(maxsize=1)
def dataset():
    raw = DATA_PATH.read_bytes()
    reader = csv.DictReader(io.StringIO(raw.decode("utf-8-sig")))
    required = {
        "연도",
        "산업코드",
        "비교산업",
        "업종합산_산업",
        "기업대상",
        "지표",
        "단위",
        "표본수",
        "재추출_4구간_평균변경률",
        "상태",
        *FIELDS.values(),
        *(f"{label}_ECOS여부" for label in BOUNDARIES.values()),
        *(f"{label}_CI95_{side}" for label in BOUNDARIES.values() for side in ("하한", "상한")),
    }
    if not required.issubset(reader.fieldnames or []):
        raise ValueError("core_ratio_columns_invalid")
    rows = {}
    for row in reader:
        if None in row or any(value is None for value in row.values()):
            raise ValueError("core_ratio_row_invalid")
        key = (int(row["연도"]), row["산업코드"], row["지표"])
        if key in rows or row["기업대상"] != "전체" or row["단위"] != "%":
            raise ValueError("core_ratio_row_invalid")
        values = {field: number(row, column) for field, column in FIELDS.items()}
        values.update(
            comparison_industry=row["비교산업"],
            aggregate_industry=row["업종합산_산업"],
            data_status=row["상태"],
            sample_count=int(row["표본수"]) if row["표본수"].strip() else None,
            resampling_change_rate=number(row, "재추출_4구간_평균변경률"),
        )
        if values["data_status"] not in ("사용가능", "부분결측", "보류"):
            raise ValueError("core_ratio_status_invalid")
        for field, label in BOUNDARIES.items():
            source = row[f"{label}_ECOS여부"].strip()
            if source not in ("", "0", "1"):
                raise ValueError("core_ratio_source_invalid")
            values[f"{field}_ecos"] = source == "1" if source else None
            values[f"{field}_ci_low"] = number(row, f"{label}_CI95_하한")
            values[f"{field}_ci_high"] = number(row, f"{label}_CI95_상한")
        sources = {values[f"{field}_ecos"] for field in BOUNDARIES if values[field] is not None}
        values["source_kind"] = (
            "OFS"
            if sources == {False}
            else "ECOS"
            if sources == {True}
            else "MIXED"
            if sources == {True, False}
            else "UNKNOWN"
        )
        rows[key] = values
    return rows, hashlib.sha256(raw).hexdigest()


def dataset_version():
    try:
        return dataset()[1]
    except (OSError, UnicodeError, ValueError, csv.Error):
        return "unavailable"


def display_row(row, year, key):
    values = {"year": year, **row}
    for field in (
        *FIELDS,
        "resampling_change_rate",
        *(f"{boundary}_ci_{side}" for boundary in BOUNDARIES for side in ("low", "high")),
    ):
        value = row.get(field)
        if value is not None and key == "interest_coverage" and field != "resampling_change_rate":
            value /= 100
        values[field] = str(value) if value is not None else None
    for field in BOUNDARIES:
        values.setdefault(f"{field}_ecos", None)
    for field in ("sample_count", "comparison_industry", "aggregate_industry"):
        values.setdefault(field, None)
    values.setdefault("source_kind", "UNKNOWN")
    values.setdefault("data_status", "미확보")
    return values


def build_benchmark(result):
    context = result.get("context", {})
    industry = INDUSTRIES.get(result.get("industry"))
    benchmark = {
        "contract_version": CONTRACT_VERSION,
        "version": dataset_version(),
        "source_file": DATA_PATH.name,
        "source_note": SOURCE_NOTE,
        "industry_code": industry[0] if industry else None,
        "industry_name": industry[1] if industry else None,
        "company_size": "전체",
        "scope": "OFS",
        "metrics": [],
    }
    try:
        rows, _ = dataset()
        year = int(context.get("fiscal_year", ""))
    except (OSError, UnicodeError, ValueError, TypeError, csv.Error):
        rows, year = {}, None
    for key, label in METRICS.items():
        history = (
            [
                display_row(
                    rows.get((year - offset, industry[0], label), {}) if industry else {},
                    year - offset,
                    key,
                )
                for offset in reversed(range(5))
            ]
            if year is not None
            else []
        )
        current = history[-1] if history else display_row({}, year, key)
        reason = None
        if not industry:
            reason = "확인된 비교 업종이 없습니다."
        elif context.get("scope") != "OFS":
            reason = "연결·별도 회계 범위 차이로 상대 구간 비교를 보류합니다."
        elif context.get("period") != f"{year}.12":
            reason = "비12월 결산 또는 연간 손익기간 확인이 필요합니다."
        elif context.get("lease") == "exclude" and key == "debt_ratio":
            reason = "리스 제외 부채비율과 비교자료의 산식이 다릅니다."
        elif result.get("industry") == "부동산 임대" and key == "operating_roa":
            reason = "부동산임대업 총자산영업이익률은 비교 표본의 손익기간 미확인으로 보류됐습니다."
        elif current["comparison_industry"] and current["comparison_industry"] != industry[1]:
            reason = (
                f"비교산업은 {current['comparison_industry']}이며 "
                f"회사 업종 {industry[1]}과 다릅니다."
            )
        elif key == "operating_roa":
            reason = (
                "자사는 기말 총자산 기준이며 비교자료와 평균 총자산 산식 일치 확인이 필요합니다."
            )
        benchmark["metrics"].append(
            {
                "key": key,
                "unit": "배" if key == "interest_coverage" else "%",
                **current,
                "history": history,
                "comparison_reason": reason,
            }
        )
    return benchmark


def with_core_benchmark(result):
    if result is None:
        return None
    pinned = result.get("core_ratio_benchmark") or {}
    # Upgrade old display contracts without rewriting saved financial facts or snapshots.
    return {
        **result,
        "core_ratio_benchmark": (
            pinned
            if pinned.get("contract_version") == CONTRACT_VERSION
            else build_benchmark(result)
        ),
    }
