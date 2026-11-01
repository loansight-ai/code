"""Synthetic policy fixtures; never loaded by the production registry."""

from app.modules.risk.schemas import RuleDefinition


def definition(**updates):
    # Synthetic executable contract, never a production threshold/policy.
    data = {
        "id": "fixture-rule",
        "version": "fixture-v1",
        "title": "합성 테스트 규칙",
        "category": "collateral",
        "kinds": ["collateral"],
        "axis": "담보/회수 여력",
        "severity": "CAUTION",
        "policy_source": "test fixture only",
        "event_relation": "CONDITION_PRESENT",
        "predicates": [{"field": "direction", "values": ["PROVIDED"]}],
        "amount": {"currency": "KRW", "role": "BALANCE", "operator": "GTE", "value": "100000000"},
    }
    return RuleDefinition.model_validate({**data, **updates})
