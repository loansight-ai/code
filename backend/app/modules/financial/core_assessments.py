"""Evidence-based card assessments; no unapproved industry thresholds."""

from decimal import Decimal

from app.modules.financial.domain import amount

VERSION = "core-card-assessments-v1-team-hypotheses"
TEAM_REFERENCES = {"current_ratio": "150", "debt_ratio": "200", "interest_coverage": "3"}
SPECS = {
    "current_ratio": True,
    "debt_ratio": False,
    "operating_margin": True,
    "operating_roa": True,
    "interest_coverage": True,
}


def assess_core_metrics(result: dict) -> list[dict]:
    metrics = {m["key"]: m for m in result.get("metrics", [])}
    facts = {(f["key"], f["period"]): f for f in result.get("facts", [])}
    industry = result.get("industry")
    assessments = []
    for key, higher_better in SPECS.items():
        metric = metrics.get(key, {})
        values = {v["period"]: v for v in metric.get("values", [])}
        current = values.get("current", {})
        previous = values.get("previous", {})
        value = amount(current.get("value"))
        prior = amount(previous.get("value"))
        current_confirmed = value is not None and current.get("state") == "CONFIRMED"
        previous_confirmed = prior is not None and previous.get("state") == "CONFIRMED"
        reference = (
            {
                "value": str(prior),
                "label": "전기",
                "kind": "PREVIOUS",
                "source": "동일 공시·회계 범위의 전기 비교값",
            }
            if previous_confirmed
            else None
        )
        status, reason = "UNAVAILABLE", "필수 계정 또는 계산 결과 미확보"
        if value is not None and not current_confirmed:
            status, reason = "NOT_EVALUATED", "근사값은 근사 사유와 원천을 먼저 확인합니다."
        elif current_confirmed:
            if previous_confirmed:
                if value == prior:
                    status, reason = "UNCHANGED", "전기와 같은 값입니다. 정상 판정을 뜻하지 않습니다."
                elif (value > prior) == higher_better:
                    status, reason = "IMPROVING", "동일 공시의 전기 대비 개선 방향입니다."
                else:
                    status, reason = "DETERIORATING", "동일 공시의 전기 대비 악화 방향입니다."
            else:
                status, reason = "NOT_EVALUATED", "비교 가능한 확정 전기값이 없습니다."

        contextual = industry == "부동산 임대" or (
            industry == "도소매" and key == "current_ratio"
        ) or (industry == "건설" and key == "debt_ratio")
        if contextual:
            status, reason = "CONTEXT_REQUIRED", "업종상 왜곡 가능성이 있어 보조·대체 지표를 확인합니다."
            if not current_confirmed:
                status, reason = "UNAVAILABLE", "필수 계정 또는 확정 계산 결과 미확보"

        if key in TEAM_REFERENCES:
            threshold = Decimal(TEAM_REFERENCES[key])
            reference = {
                "value": str(threshold),
                "label": "팀 가설",
                "kind": "TEAM_HYPOTHESIS",
                "source": "사용자 지정 팀 가설 · 유동비율 150% / 부채비율 200% / 이자보상비율 3배",
            }
            if current_confirmed and not contextual:
                outside = value < threshold if higher_better else value > threshold
                if outside:
                    status = "WARNING" if key == "debt_ratio" else "CAUTION"
                    reason = f"사용자 지정 팀 가설 {threshold} 기준의 확인 대상입니다. 최종 위험 판정이 아닙니다."

        if key == "interest_coverage" and industry != "부동산 임대":
            if current_confirmed and value < Decimal(1):
                status, reason = "CAUTION", "문서 4-1의 당기 이자보상비율 1배 미만에 해당합니다. 표시선 3배는 별도 팀 가설입니다."

        if key == "debt_ratio":
            equity = facts.get(("equity", "current"), {})
            equity_value = amount(equity.get("value"))
            if equity.get("state") == "CONFIRMED" and equity_value is not None:
                if equity_value <= 0:
                    status = "WARNING"
                    reason = "확정 자본총계가 0 이하입니다. 완전자본잠식 원문 확인이 필요합니다."

        assessments.append(
            {
                "key": key,
                "status": status,
                "reason": reason,
                "reference": reference,
                "higher_is_better": higher_better,
            }
        )
    return assessments


def with_core_assessments(result: dict | None) -> dict | None:
    if result is None:
        return None
    return {
        **result,
        "core_card_assessment_version": VERSION,
        "core_card_assessments": assess_core_metrics(result),
    }
