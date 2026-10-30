"""Versioned BOK reference averages, independent of credit risk thresholds."""

import csv
import hashlib
from decimal import Decimal, InvalidOperation
from functools import lru_cache
from pathlib import Path

DATA_ROOT = Path(__file__).resolve().parents[3] / "data" / "bok"
SOURCE_URL = "https://www.bok.or.kr/portal/bbs/P0000599/view.do?nttId=11065774&menuNo=200455"
PERIODS = ("current", "previous", "before_previous")
# Correct the collection's aliases without changing the source metric codes.
ALIASES = {
    "debt_to_equity": "debt_ratio",
    "borrowing_dependency": "borrowing_ratio",
    "cogs_ratio": "cost_ratio",
    "sales_growth": "revenue_growth",
    "roa_operating": "operating_roa",
}


@lru_cache(maxsize=1)
def dataset():
    files = sorted(DATA_ROOT.glob("*.csv"))
    digest = hashlib.sha256()
    tables = {}
    for path in files:
        raw = path.read_bytes()
        digest.update(path.name.encode() + b"\0" + raw)
        tables[path.stem] = list(csv.DictReader(raw.decode("utf-8-sig").splitlines()))
    required = {
        "source_release",
        "metric_definitions",
        "industry_mapping",
        "bok_ratio_values",
        "bok_industry_dict",
    }
    if not required.issubset(tables):
        raise ValueError("bok_dataset_incomplete")
    return tables, digest.hexdigest()


def dataset_version():
    try:
        return dataset()[1]
    except (OSError, ValueError):
        return "unavailable"


def number(value):
    try:
        parsed = Decimal(str(value))
        return parsed if parsed.is_finite() else None
    except InvalidOperation:
        return None


def build_benchmark(result, ksic_code):
    """Choose the longest mapped KSIC prefix and exact-year, all-size observations."""
    try:
        tables, version = dataset()
    except (OSError, ValueError):
        return {"status": "UNAVAILABLE", "reason": "한국은행 통계 파일 미확보", "metrics": []}
    release = tables["source_release"][0]
    benchmark = {
        "status": "UNAVAILABLE",
        "reason": None,
        "release_id": release["release_id"],
        "version": version,
        "source_title": release["title"],
        "source_url": release["source_url"] or SOURCE_URL,
        "company_size": "전체",
        "population": "비금융 영리법인 전체 · 별도재무제표 집계",
        "industry_code": None,
        "industry_name": None,
        "mapping_note": None,
        "scope_note": (
            "연결재무제표와 별도 기준 통계의 참고 비교입니다."
            if result["context"]["scope"] == "CFS"
            else "별도재무제표 기준 업종 집계 비율입니다."
        ),
        "metrics": [],
    }
    matches = [
        r
        for r in tables["industry_mapping"]
        if ksic_code and str(ksic_code).startswith(r["company_ksic_code"])
    ]
    mapping = max(matches, key=lambda r: len(r["company_ksic_code"]), default=None)
    if not mapping or not mapping["bok_industry_code"]:
        benchmark["reason"] = "기업 KSIC에 대응하는 한국은행 통계 업종 미확보"
        return benchmark
    industry_code = mapping["bok_industry_code"]
    industry = next(r for r in tables["bok_industry_dict"] if r["industry_code"] == industry_code)
    benchmark.update(
        industry_code=industry_code,
        industry_name=industry["industry_name"],
        mapping_note=f"{mapping['mapping_type']} · {mapping['reason']}",
    )
    values = {
        (int(r["year"]), r["metric_code"]): r
        for r in tables["bok_ratio_values"]
        if r["release_id"] == release["release_id"]
        and r["industry_code"] == industry_code
        and r["company_size_code"] == "전체"
        and r["population_code"] == "ALL_CORP"
        and r["frequency"] == "연간"
    }
    for definition in tables["metric_definitions"]:
        code = definition["source_metric_code"]
        metric = {
            "key": ALIASES.get(definition["service_metric_key"], definition["service_metric_key"]),
            "source_metric_code": code,
            "label": definition["source_metric_name"] or code.removeprefix("NA_"),
            "unit": "배" if code == "629" else definition["unit"],
            "values": [],
        }
        for offset, period in enumerate(PERIODS):
            year = int(result["context"]["fiscal_year"]) - offset
            row = values.get((year, code))
            value = number(row["value"]) if row and row["data_status"] == "확보" else None
            if code == "629" and value is not None:
                value /= 100
            reason = (
                None
                if value is not None
                else ("원천 미제공 지표" if code.startswith("NA_") else "해당 연도 통계 미확보")
            )
            metric["values"].append(
                {
                    "period": period,
                    "year": year,
                    "value": str(value) if value is not None else None,
                    "reason": reason,
                }
            )
        benchmark["metrics"].append(metric)
    benchmark["status"] = (
        "AVAILABLE"
        if any(v["value"] is not None for m in benchmark["metrics"] for v in m["values"])
        else "UNAVAILABLE"
    )
    if benchmark["status"] == "UNAVAILABLE":
        benchmark["reason"] = "분석 기간에 해당하는 통계 미확보"
    return benchmark


def with_benchmark(result, ksic_code=None):
    if result is None:
        return None
    # Retain the statistics version saved with a run; recompute only own-value gaps
    # so note-enriched facts do not leave stale comparison differences.
    benchmark = result.get("bok_benchmark") or build_benchmark(result, ksic_code)
    own_metrics = {m["key"]: m for m in result["metrics"]}
    metrics = []
    for metric in benchmark["metrics"]:
        own = own_metrics.get(metric["key"])
        own_values = {v["period"]: v for v in own["values"]} if own else {}
        values = []
        for value in metric["values"]:
            actual = own_values.get(value["period"], {})
            current = number(actual.get("value"))
            average = number(value["value"])
            reason = value["reason"]
            if average is not None:
                if not own or own["unit"] != metric["unit"]:
                    reason = "동일 단위의 자사 지표 미확보"
                elif actual.get("state") != "CONFIRMED" or current is None:
                    reason = "확정 자사 값 미확보"
                elif result["context"].get("period", "").split(".")[-1] != "12":
                    reason = "비12월 결산 · 통계 기간 차이 확인 필요"
                elif result["context"]["scope"] != "OFS":
                    reason = "연결·별도 회계 범위 차이 · 차이 계산 보류"
                elif result["context"]["lease"] == "exclude" and metric["key"] in (
                    "debt_ratio",
                    "borrowing_ratio",
                ):
                    reason = "리스 제외 옵션과 통계 기준 차이 · 차이 계산 보류"
            gap = current - average if reason is None else None
            values.append(
                {**value, "gap": str(gap) if gap is not None else None, "comparison_reason": reason}
            )
        metrics.append({**metric, "values": values})
    return {**result, "bok_benchmark": {**benchmark, "metrics": metrics}}
