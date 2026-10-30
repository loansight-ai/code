from decimal import Decimal

import pytest

from app.modules.financial.domain import calculate, map_facts


def facts():
    # Sales differ from cost of sales to detect an accidental cost-based ratio.
    rows = []
    for key, current, previous, oldest, statement in (
        ("Revenue", "1200", "900", "600", "IS"),
        ("CostOfSales", "600", "450", "300", "IS"),
        ("Inventories", "300", "100", "80", "BS"),
        ("TradeReceivables", "200", "100", "50", "BS"),
        ("TradePayables", "150", "50", "30", "BS"),
        ("Assets", "2000", "1000", "500", "BS"),
        ("NoncurrentAssets", "1000", "800", "400", "BS"),
        ("NoncurrentLiabilities", "400", "200", "100", "BS"),
        ("Equity", "600", "600", "300", "BS"),
    ):
        rows.append(
            dict(
                account_id="ifrs-full_" + key,
                sj_div=statement,
                currency="KRW",
                thstrm_amount=current,
                frmtrm_amount=previous,
                bfefrmtrm_amount=oldest,
            )
        )
    return map_facts(rows)


def value(data, key, period="current"):
    metric = next(m for m in calculate(data)[0] if m["key"] == key)
    return next(v for v in metric["values"] if v["period"] == period)


def test_turnover_uses_sales_and_average_balances_and_preserves_oldest_gap():
    data = facts()
    for key, expected in (
        ("inventory_turnover", "6.0000"),
        ("receivables_turnover", "8.0000"),
        ("payables_turnover", "12.0000"),
        ("asset_turnover", "0.8000"),
    ):
        assert value(data, key)["value"] == expected
        assert value(data, key, "before_previous")["reason"] == "opening_balance_missing"
    assert value(data, "inventory_turnover", "previous")["value"] == "10.0000"
    data.append(dict(key="inventory", period="opening_balance", value="40", state="CONFIRMED"))
    assert value(data, "inventory_turnover", "before_previous")["value"] == "10.0000"


@pytest.mark.parametrize(
    "field,period,amount,reason",
    [
        ("inventory", "previous", None, "opening_balance_missing"),
        ("inventory", "current", "-1", "negative_turnover_input"),
        ("inventory", "previous", "-1", "negative_turnover_input"),
        ("revenue", "current", "-1", "negative_turnover_input"),
        ("revenue", "current", None, "missing_input"),
    ],
)
def test_turnover_does_not_guess_missing_or_invalid_inputs(field, period, amount, reason):
    data = facts()
    next(f for f in data if f["key"] == field and f["period"] == period)["value"] = amount
    assert value(data, "inventory_turnover")["value"] is None
    assert value(data, "inventory_turnover")["reason"] == reason


def test_zero_balances_revenue_and_nonpositive_long_term_funding():
    data = facts()
    for fact in data:
        if fact["key"] == "inventory":
            fact["value"] = "0"
    assert value(data, "inventory_turnover")["reason"] == "nonpositive_denominator"
    data = facts()
    next(f for f in data if f["key"] == "revenue" and f["period"] == "current")["value"] = "0"
    assert value(data, "inventory_turnover")["value"] == "0.0000"
    assert value(data, "long_term_asset_fit")["value"] == "100.0000"
    next(f for f in data if f["key"] == "equity" and f["period"] == "current")["value"] = "-400"
    assert value(data, "long_term_asset_fit")["reason"] == "nonpositive_denominator"


def test_average_asset_turnover_does_not_change_closing_operating_roa_or_pending_policies():
    data = facts()
    metrics = {m["key"]: m for m in calculate(data)[0]}
    assert "기말 자산총계" in metrics["operating_roa"]["formula"]
    for key in ("ccc", "inventory_days", "ebitda_coverage", "cash_coverage", "capex_cashflow"):
        assert metrics[key]["values"][0]["value"] is None
    fit = metrics["long_term_asset_fit"]
    assert fit == next(m for m in calculate(data, "exclude")[0] if m["key"] == fit["key"])
    assert Decimal(metrics["payables_turnover"]["values"][0]["value"]) == 12
