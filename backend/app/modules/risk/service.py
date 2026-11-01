"""Owned, current-source-checked inputs and reproducible rule results."""

from collections import Counter

from sqlalchemy import select, text

from app.modules.evidence.bundle_tools import BundleTools
from app.modules.evidence.fact_models import EvidenceFact
from app.modules.evidence.fact_schemas import FactInput
from app.modules.evidence.fact_validation import validate
from app.modules.evidence.search_baseline import CATEGORIES
from app.modules.evidence.service import fingerprint
from app.modules.risk.engine import evaluate
from app.modules.risk.registry import REGISTRY_VERSION, RULES
from app.modules.risk.schemas import AXES

VERSION = "reviewed-fact-signals-v1"


async def signals(db, identity, bundle_id, offset=0, limit=30, definitions=None):
    tools = await BundleTools.owned(db, identity, bundle_id)
    await db.execute(
        text("SELECT pg_advisory_xact_lock_shared(:key)"),
        {"key": int(tools.bundle.fingerprint[:15], 16)},
    )
    # Definitions are supplied only by the server registry, never by the HTTP caller.
    rules = RULES if definitions is None else definitions
    registry = fingerprint(
        {"version": REGISTRY_VERSION, "rules": [r.model_dump(mode="json") for r in rules]}
    )
    rows = list(
        (
            await db.scalars(
                select(EvidenceFact)
                .where(EvidenceFact.bundle_id == bundle_id, EvidenceFact.state != "SUPERSEDED")
                .order_by(EvidenceFact.created_at, EvidenceFact.id)
                .with_for_update(read=True)
            )
        ).all()
    )
    inputs, evaluations, revisions = [], [], []
    categories = {
        key: {
            "key": key,
            "title": title,
            "states": Counter(),
            "ready_inputs": 0,
            "configured_rules": sum(r.category == key for r in rules),
        }
        for key, title, _, _ in CATEGORIES
    }
    for fact in rows:
        data = FactInput.model_validate(fact.data)
        gate = {"PENDING": "REVIEW_PENDING", "REJECTED": "REJECTED", "APPROVED": "READY"}.get(
            fact.state, "VALIDATION_BLOCKED"
        )
        current = None
        if fact.state == "APPROVED":
            current = await validate(tools, data)
            if current["status"] != "CITATIONS_VALID":
                gate = "VALIDATION_BLOCKED"
            elif current["source_digest"] != fact.validation["source_digest"]:
                gate = "SOURCE_CHANGED"
            elif data.period is None or data.period != tools.bundle.period:
                gate = "PERIOD_UNCONFIRMED"
            elif any(
                other.id != fact.id
                and other.state in {"PENDING", "APPROVED"}
                and other.comparison_key == fact.comparison_key
                and other.value_key != fact.value_key
                for other in rows
            ):
                gate = "CONFLICT_REQUIRES_REVIEW"
        category = categories[data.category]
        category["states"][gate] += 1
        if gate == "READY":
            category["ready_inputs"] += 1
        normalized = current["normalized_amount"] if gate == "READY" else None
        item = {
            "fact_id": str(fact.id),
            "version": fact.version,
            "revision": fact.revision,
            "state": fact.state,
            "category": data.category,
            "kind": data.kind,
            "statement": data.statement,
            "period": data.period,
            "detection": data.detection,
            "gate": gate,
            "rule_input_eligible": gate == "READY",
            "normalized_amount": normalized,
            "model_eligible": False,
            "event_status": "EXPLICIT_NEGATION"
            if data.detection == "EXPLICITLY_NONE"
            else "UNCLASSIFIED",
            "citations": [c.model_dump(mode="json") for c in data.citations],
        }
        inputs.append(item)
        revisions.append(
            {
                "id": str(fact.id),
                "version": fact.version,
                "state": fact.state,
                "data_revision": fingerprint(fact.data),
                "digest": current["source_digest"] if current else fact.validation["source_digest"],
                "gate": gate,
            }
        )
        if gate == "READY":
            applicable = [r for r in rules if r.category == data.category and data.kind in r.kinds]
            for rule in applicable:
                result = evaluate(rule, data.model_dump(mode="json"), normalized)
                evaluations.append(
                    {
                        "rule_id": rule.id,
                        "rule_version": rule.version,
                        "title": rule.title,
                        "policy_source": rule.policy_source,
                        "axis": rule.axis,
                        "category": rule.category,
                        "fact_id": str(fact.id),
                        "fact_version": fact.version,
                        "result": result,
                        "severity": rule.severity if result == "TRIGGERED" else None,
                        "event_relation": rule.event_relation if result == "TRIGGERED" else None,
                    }
                )
    for item in categories.values():
        item["states"] = dict(item["states"])
        item["status"] = (
            "DEFINITION_PENDING"
            if item["ready_inputs"] and not any(e["category"] == item["key"] for e in evaluations)
            else "PARTIAL"
            if item["ready_inputs"]
            and (
                any(k not in {"READY", "REJECTED"} for k in item["states"])
                or any(
                    e["category"] == item["key"] and e["result"] == "INPUTS_MISSING"
                    for e in evaluations
                )
            )
            else "EVALUATED"
            if item["ready_inputs"]
            else "REVIEW_PENDING"
            if item["states"].get("REVIEW_PENDING")
            else "INPUTS_BLOCKED"
            if any(k not in {"REJECTED"} for k in item["states"])
            else "INPUTS_MISSING"
        )
    triggered = [v for v in evaluations if v["result"] == "TRIGGERED"]
    # Empty results are never a normal/safe rating, including when no definition exists.
    status = (
        "DEFINITION_PENDING"
        if not rules
        else "PARTIAL"
        if any(i["gate"] not in {"READY", "REJECTED"} for i in inputs)
        or any(v["result"] == "INPUTS_MISSING" for v in evaluations)
        or any(c["status"] != "EVALUATED" for c in categories.values())
        else "EVALUATED"
        if evaluations
        else "INPUTS_MISSING"
    )
    return {
        "bundle_id": str(bundle_id),
        "bundle_revision": tools.bundle.fingerprint,
        "period": tools.bundle.period,
        "scope": tools.bundle.scope,
        "version": VERSION,
        "registry_revision": registry,
        "input_revision": fingerprint(
            {
                "version": VERSION,
                "bundle": tools.bundle.fingerprint,
                "facts": revisions,
                "registry": registry,
            }
        ),
        "evaluation_status": status,
        "axes": list(AXES),
        "categories": list(categories.values()),
        "facts": inputs[offset : offset + limit],
        "next_offset": offset + limit if offset + limit < len(inputs) else None,
        "total_facts": len(inputs),
        "ready_inputs": sum(i["gate"] == "READY" for i in inputs),
        "evaluations": evaluations,
        "severity_counts": dict(Counter(v["severity"] for v in triggered)),
        "model_input_status": "WITHHELD_CONTRACT_PENDING",
        "model_eligible": False,
        "limitations": [
            "승인된 사실의 기간·근거를 재검증하며 조건 존재를 사건 발생으로 해석하지 않습니다.",
            "위험규칙 상세 조건·임계값과 23개 RISK 원자료는 미확정입니다."
            if not rules
            else "미평가·입력 부족은 정상 판정이 아닙니다.",
            "보고서 전체 검토·최종 여신 판단·미래 예측 확률을 제공하지 않습니다.",
        ],
    }
