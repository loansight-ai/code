"""Four relative value bands, independent of risk or safety grades."""

from decimal import localcontext

from app.modules.financial.core_benchmarks import BOUNDARIES, decimal_value, with_core_benchmark
from app.modules.financial.domain import amount

VERSION = "core-card-assessments-v3-relative-bands"
SPECS = {
    "current_ratio": (True, "current_liabilities", "유동부채"),
    "debt_ratio": (False, "equity", "자본총계"),
    "operating_margin": (True, "revenue", "매출액"),
    "operating_roa": (True, "assets", "자산총계"),
    "interest_coverage": (True, "interest_expense", "이자비용"),
}
BANDS = ("하위 25% 구간", "25~50% 구간", "50~75% 구간", "상위 25% 구간")
NUMERATORS = {
    "current_ratio": "current_assets",
    "debt_ratio": "liabilities",
    "operating_margin": "operating_profit",
    "operating_roa": "operating_profit",
    "interest_coverage": "operating_profit",
}


def relative_band(value, q1, median, q3):
    # Apply in order, including coincident boundaries. Never round before comparison.
    return 0 if value < q1 else 1 if value < median else 2 if value <= q3 else 3


def boundary_proximity(value, comparison):
    unknown, ofs = False, False
    for field in BOUNDARIES:
        source = comparison.get(f"{field}_ecos")
        if source is True:
            continue
        if source is not False:
            unknown = True
            continue
        ofs = True
        low, high = (
            decimal_value(comparison.get(f"{field}_ci_{side}")) for side in ("low", "high")
        )
        if low is None or high is None or low > high:
            unknown = True
        elif low <= value <= high:
            return "NEAR"
    return "UNKNOWN" if unknown else "OUTSIDE" if ofs else "NOT_APPLICABLE"


def assess_core_metrics(result: dict) -> list[dict]:
    metrics = {m["key"]: m for m in result.get("metrics", [])}
    facts = {(f["key"], f["period"]): f for f in result.get("facts", [])}
    benchmark = with_core_benchmark(result)["core_ratio_benchmark"]
    comparisons = {m["key"]: m for m in benchmark["metrics"]}
    assessments = []
    for key, (higher_better, denominator, denominator_label) in SPECS.items():
        metric = metrics.get(key, {})
        current = next((v for v in metric.get("values", []) if v["period"] == "current"), {})
        value = amount(current.get("value"))
        comparison = comparisons.get(key, {})
        q1, median, q3 = (decimal_value(comparison.get(field)) for field in BOUNDARIES)
        denominator_fact = facts.get((denominator, "current"), {})
        denominator_value = amount(denominator_fact.get("value"))
        numerator_fact = facts.get((NUMERATORS[key], "current"), {})
        numerator_value = amount(numerator_fact.get("value"))
        # Saved metrics have display rounding. Use the confirmed formula inputs when available.
        if (
            value is not None
            and numerator_fact.get("state") == "CONFIRMED"
            and numerator_value is not None
            and denominator_value is not None
            and denominator_value > 0
        ):
            with localcontext() as ctx:
                ctx.prec = 60
                value = (
                    numerator_value / denominator_value * (1 if key == "interest_coverage" else 100)
                )
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
        status, label, band, proximity = ("NOT_COMPARABLE", "비교할 수 없음", None, "NOT_EVALUATED")
        reason = comparison.get("comparison_reason")
        if (
            key == "debt_ratio"
            and denominator_fact.get("state") == "CONFIRMED"
            and denominator_value is not None
            and denominator_value <= 0
        ):
            status, label = "CAPITAL_REVIEW", "자본잠식 여부 확인 필요"
            reason = "자본총계가 0 이하이므로 사분위수 비교를 생략합니다."
        elif denominator_fact.get("state") != "CONFIRMED" or denominator_value is None:
            reason = f"확정 {denominator_label} 미확보 · 상대 구간 비교 보류."
        elif denominator_value <= 0:
            reason = f"{denominator_label}가 0 이하이므로 일반 비율 비교에서 제외합니다."
        elif value is None:
            reason = "필수 계정 또는 계산 결과 미확보."
        elif current.get("state") != "CONFIRMED":
            reason = "확정 자사 값이 아니므로 상대 구간 비교를 보류합니다."
        elif metric.get("unit") != comparison.get("unit"):
            reason = "자사 지표와 비교자료의 단위가 다릅니다."
        elif any(boundary is None for boundary in (q1, median, q3)):
            status, label = "BENCHMARK_PENDING", "비교 기준 확인 중"
            reason = reason or "해당 연도 Q1·중앙값·Q3 중 미확보 경계가 있습니다."
        elif not q1 <= median <= q3 or comparison.get("data_status") != "사용가능":
            status, label = "BENCHMARK_PENDING", "비교 기준 확인 중"
            reason = "사분위 경계 순서 또는 비교자료 상태 확인이 필요합니다."
        elif reason is None:
            band = relative_band(value, q1, median, q3)
            status, label = "RELATIVE_POSITION", BANDS[band]
            reason = "값의 크기에 따른 상대 위치이며 위험·안전 등급이 아닙니다."
            proximity = boundary_proximity(value, comparison)
        else:
            status, label = "BENCHMARK_PENDING", "비교 기준 확인 중"
        assessments.append(
            {
                "key": key,
                "status": status,
                "label": label,
                "band": band,
                "comparison_value": str(value) if value is not None else None,
                "reason": reason,
                "higher_is_better": higher_better,
                "comparison_allowed": band is not None,
                "boundary_proximity": proximity,
                "boundary_note": (
                    "경계 부근: 표본 구성에 따라 상대 구간이 달라질 수 있습니다."
                    if proximity == "NEAR"
                    else None
                ),
                "reference": (
                    {
                        "value": str(median),
                        "label": "업종 중앙값",
                        "kind": "INDUSTRY_MEDIAN",
                        "source": (
                            f"{comparison.get('comparison_industry')} · "
                            f"{comparison.get('year')}년 · "
                            f"{comparison.get('source_kind')} · 기업 규모 전체"
                        ),
                    }
                    if median is not None
                    else None
                ),
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
