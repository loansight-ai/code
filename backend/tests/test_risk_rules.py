import copy

import pytest
from pydantic import ValidationError

from app.modules.risk.engine import evaluate
from app.modules.risk.registry import RULES
from tests.risk_fixture_rules import definition

FACT = {
    "category": "collateral",
    "kind": "collateral",
    "direction": "PROVIDED",
    "detection": "DETECTED",
    "status": None,
    "amount_role": "BALANCE",
    "amount": {"currency": "KRW"},
}


@pytest.mark.parametrize(
    "updates,amount,expected",
    [
        ({}, "100000000", "TRIGGERED"),
        ({}, "99999999.999999999", "NOT_TRIGGERED"),
        ({"direction": "UNKNOWN"}, "100000000", "INPUTS_MISSING"),
        ({"direction": "RECEIVED"}, "100000000", "NOT_TRIGGERED"),
        ({"direction": "RECEIVED", "amount": None}, None, "INPUTS_MISSING"),
        ({"amount": {"currency": "USD"}}, "100000000", "NOT_APPLICABLE"),
        ({"amount_role": "LIMIT"}, "100000000", "NOT_APPLICABLE"),
        ({"detection": "EXPLICITLY_NONE"}, None, "NOT_APPLICABLE"),
        ({"kind": "guarantee", "category": "off_balance"}, "100000000", "NOT_APPLICABLE"),
    ],
)
def test_exact_predicates_and_decimal_threshold_have_no_keyword_fallback(updates, amount, expected):
    fact = {**copy.deepcopy(FACT), **updates}
    assert evaluate(definition(), fact, amount) == expected


def test_actual_event_needs_status_and_never_matches_negation():
    with pytest.raises(ValidationError):
        definition(event_relation="ACTUAL_EVENT")
    rule = definition(
        event_relation="ACTUAL_EVENT",
        amount=None,
        predicates=[{"field": "status", "values": ["발생"]}],
    )
    assert evaluate(rule, {**FACT, "status": "미발생"}, None) == "NOT_TRIGGERED"
    assert evaluate(rule, {**FACT, "status": None}, None) == "INPUTS_MISSING"
    assert (
        evaluate(rule, {**FACT, "status": "발생", "detection": "EXPLICITLY_NONE"}, None)
        == "NOT_APPLICABLE"
    )


def test_unconfirmed_policy_is_not_loaded():
    assert RULES == ()
