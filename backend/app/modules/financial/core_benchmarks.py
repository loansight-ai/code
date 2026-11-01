"""Provided core-ratio quartiles, separate from official BOK averages."""

import csv
import hashlib
import io
from functools import lru_cache
from pathlib import Path

from app.modules.financial.domain import amount

DATA_PATH = (
    Path(__file__).resolve().parents[3] / "data" / "2016-2025_4개업종_전체기업_5개재무지표.csv"
)
INDUSTRIES = {
    "제조": ("C10-34", "제조업"),
    "건설": ("F41-42", "건설업"),
    "도소매": ("G45-47", "도매 및 소매업"),
    "부동산 임대": ("L68", "부동산업"),
}
METRICS = {
    "current_ratio": "유동비율",
    "debt_ratio": "부채비율",
    "operating_margin": "매출액영업이익률",
    "operating_roa": "총자산영업이익률",
    "interest_coverage": "이자보상비율",
}
FIELDS = {"aggregate": "업종합산비율", "q1": "제1사분위수", "median": "중앙값", "q3": "제3사분위수"}
SOURCE_NOTE = (
    "팀 제공 비교자료 · 수집 설명상 ECOS 통계와 자체 OFS 표본 보충값이 포함됩니다. "
    "CSV에 셀별 출처·표본 수·보충 여부가 없어 확인되지 않았습니다. "
    "업종합산비율은 기업별 비율의 중앙값과 다릅니다."
)


@lru_cache(maxsize=1)
def dataset():
    raw = DATA_PATH.read_bytes()
    reader = csv.DictReader(io.StringIO(raw.decode("utf-8-sig")))
    required = {"연도", "산업코드", "기업대상", "지표", "단위", *FIELDS.values()}
    if not required.issubset(reader.fieldnames or []):
        raise ValueError("core_ratio_columns_invalid")
    rows = {}
    for row in reader:
        if None in row or any(value is None for value in row.values()):
            raise ValueError("core_ratio_row_invalid")
        key = (int(row["연도"]), row["산업코드"], row["지표"])
        if key in rows or row["기업대상"] != "전체" or row["단위"] != "%":
            raise ValueError("core_ratio_row_invalid")
        values = {field: amount(row[column]) for field, column in FIELDS.items()}
        if any(row[column].strip() and values[field] is None for field, column in FIELDS.items()):
            raise ValueError("core_ratio_number_invalid")
        present = [values[field] for field in ("q1", "median", "q3") if values[field] is not None]
        if present != sorted(present):
            raise ValueError("core_ratio_quartiles_invalid")
        rows[key] = values
    return rows, hashlib.sha256(raw).hexdigest()


def dataset_version():
    try:
        return dataset()[1]
    except (OSError, UnicodeError, ValueError, csv.Error):
        return "unavailable"


def build_benchmark(result):
    context = result.get("context", {})
    industry = INDUSTRIES.get(result.get("industry"))
    benchmark = {
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
    except (OSError, UnicodeError, ValueError, csv.Error):
        rows, year = {}, None
    for key, label in METRICS.items():
        history = []
        for offset in reversed(range(5)) if year is not None else ():
            target_year = year - offset
            row = rows.get((target_year, industry[0], label), {}) if industry else {}
            values = {}
            for field in FIELDS:
                value = row.get(field)
                if value is not None and key == "interest_coverage":
                    value /= 100  # Source percent -> card times.
                values[field] = str(value) if value is not None else None
            history.append({"year": target_year, **values})
        current = history[-1] if history else {"year": year, **dict.fromkeys(FIELDS)}
        reason = None
        if not industry:
            reason = "확인된 비교 업종이 없습니다."
        elif result.get("industry") == "부동산 임대":
            reason = (
                "부동산업 전체에는 개발·공급·관리·중개가 포함되어 임대업 상대 판정은 보류합니다."
            )
        elif context.get("scope") != "OFS":
            reason = "연결·별도 회계 범위 차이로 업종 상대 판정을 보류합니다."
        elif context.get("period") != f"{year}.12":
            reason = "비12월 결산 또는 연간 손익기간 확인이 필요합니다."
        elif context.get("lease") == "exclude" and key == "debt_ratio":
            reason = "리스 제외 부채비율과 비교자료의 산식이 다릅니다."
        elif key == "operating_roa":
            reason = (
                "자사는 기말 총자산, 비교자료는 연평균 총자산 기준이므로 상대 판정을 보류합니다."
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
    # Pin new runs; decorate legacy results without changing their saved facts.
    return {
        **result,
        "core_ratio_benchmark": result.get("core_ratio_benchmark") or build_benchmark(result),
    }
