"""Relative core-card positions, independent of final credit decisions."""

from app.modules.financial.core_benchmarks import build_benchmark, with_core_benchmark
from app.modules.financial.domain import amount

VERSION = "core-card-assessments-v2-quartiles"
SPECS = {
    "current_ratio": (True, "current_liabilities", "유동부채"),
    "debt_ratio": (False, "equity", "자본총계"),
    "operating_margin": (True, "revenue", "매출액"),
    "operating_roa": (True, "assets", "자산총계"),
    "interest_coverage": (True, "interest_expense", "이자비용"),
}


def assess_core_metrics(result: dict) -> list[dict]:
    metrics = {m["key"]: m for m in result.get("metrics", [])}
    facts = {(f["key"], f["period"]): f for f in result.get("facts", [])}
    benchmark = result.get("core_ratio_benchmark") or build_benchmark(result)
    comparisons = {m["key"]: m for m in benchmark["metrics"]}
    assessments = []
    for key, (higher_better, denominator, denominator_label) in SPECS.items():
        metric = metrics.get(key, {})
        current = next((v for v in metric.get("values", []) if v["period"] == "current"), {})
        value = amount(current.get("value"))
        comparison = comparisons.get(key, {})
        median = amount(comparison.get("median"))
        boundary = amount(comparison.get("q1" if higher_better else "q3"))
        denominator_fact = facts.get((denominator, "current"), {})
        denominator_value = amount(denominator_fact.get("value"))
        flags = []
        profit = facts.get(("operating_profit", "current"), {})
        if (
            key in ("operating_margin", "operating_roa")
            and profit.get("state") == "CONFIRMED"
            and (amount(profit.get("value")) or 0) < 0
        ):
            flags.append("영업적자")
        if key == "debt_ratio":
            capital = facts.get(("capital", "current"), {})
            capital_value = amount(capital.get("value"))
            if (
                denominator_fact.get("state") == "CONFIRMED"
                and denominator_value is not None
                and denominator_value > 0
                and capital.get("state") == "CONFIRMED"
                and capital_value is not None
                and denominator_value < capital_value
            ):
                flags.append("부분자본잠식")
        status = "NOT_EVALUATED"
        reason = comparison.get("comparison_reason")
        if (
            key == "debt_ratio"
            and denominator_fact.get("state") == "CONFIRMED"
            and denominator_value is not None
            and denominator_value <= 0
        ):
            status = "WARNING"
            reason = "자본총계가 0 이하입니다. 완전자본잠식 원문 확인 · 분위수 판정 제외."
            flags.append("자본총계 0 이하")
        elif denominator_fact.get("state") != "CONFIRMED" or denominator_value is None:
            reason = f"확정 {denominator_label} 미확보 · 업종 상대 판정 보류."
        elif denominator_value <= 0:
            reason = f"{denominator_label}가 0 이하이므로 일반 비율 비교에서 제외합니다."
        elif value is None:
            status, reason = "UNAVAILABLE", "필수 계정 또는 계산 결과 미확보."
        elif current.get("state") != "CONFIRMED":
            reason = "확정 자사 값이 아니므로 업종 상대 판정을 보류합니다."
        elif metric.get("unit") != comparison.get("unit"):
            reason = "자사 지표와 비교자료의 단위가 다릅니다."
        elif reason is None:
            if median is None or boundary is None:
                reason = "해당 연도의 중앙값 또는 판정 사분위수 미확보 · 비교 보류."
            elif value < boundary if higher_better else value > boundary:
                status = "CAUTION"
                reason = (
                    "제공 비교자료의 Q1 미만 · 업종 하위 구간."
                    if higher_better
                    else "제공 비교자료의 Q3 초과 · 업종 대비 부채 수준 높음."
                )
            elif value < median if higher_better else value > median:
                status, reason = "WATCH", "제공 비교자료의 중앙값보다 취약한 쪽에 위치합니다."
            else:
                status = "REFERENCE_RANGE"
                reason = (
                    "제공 비교자료의 중앙값 이상입니다. 정상 판정을 뜻하지 않습니다."
                    if higher_better
                    else "제공 비교자료의 중앙값 이하 부채비율입니다. 정상 판정을 뜻하지 않습니다."
                )
        assessments.append(
            {
                "key": key,
                "status": status,
                "reason": reason or "비교자료 미확보 · 업종 상대 판정 보류.",
                "higher_is_better": higher_better,
                "reference": (
                    {
                        "value": str(median),
                        "label": "업종 중앙값",
                        "kind": "INDUSTRY_MEDIAN",
                    "source": (
                        f"{benchmark['industry_name']} · {comparison.get('year')}년 · "
                        "별도 기준 · 전체 규모 · 팀 제공 비교자료"
                    ),
                    }
                    if median is not None
                    else None
                ),
                "comparison_allowed": status in ("CAUTION", "WATCH", "REFERENCE_RANGE"),
                "flags": flags,
            }
        )
    return assessments


def with_core_assessments(result: dict | None) -> dict | None:
    if result is None:
        return None
    result = with_core_benchmark(result)
    return {
        **result,
        "core_card_assessment_version": VERSION,
        "core_card_assessments": assess_core_metrics(result),
    }
