"""Evaluate one approved, period-bound fact at a time without keyword inference."""

from decimal import Decimal


def evaluate(rule, data, normalized_amount):
    if data["kind"] not in rule.kinds or data["category"] != rule.category:
        return "NOT_APPLICABLE"
    negative = data["detection"] == "EXPLICITLY_NONE"
    if negative != (rule.event_relation == "EXPLICIT_NEGATION"):
        return "NOT_APPLICABLE"
    # A missing field cannot become a negative rule result through conjunction order.
    if any(data.get(p.field) in (None, "", "UNKNOWN") for p in rule.predicates):
        return "INPUTS_MISSING"
    if rule.amount and (
        not data.get("amount") or normalized_amount is None or data.get("amount_role") == "UNKNOWN"
    ):
        return "INPUTS_MISSING"
    if any(data[p.field] not in p.values for p in rule.predicates):
        return "NOT_TRIGGERED"
    if rule.amount:
        condition = rule.amount
        if (
            data["amount"]["currency"] != condition.currency
            or data["amount_role"] != condition.role
        ):
            return "NOT_APPLICABLE"
        value = Decimal(normalized_amount)
        matched = (
            value >= condition.value if condition.operator == "GTE" else value <= condition.value
        )
        if not matched:
            return "NOT_TRIGGERED"
    return "TRIGGERED"
