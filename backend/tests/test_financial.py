import io
import json
from decimal import Decimal
from pathlib import Path

import pytest

from app.modules.evidence.dart_collector import CollectionError
from app.modules.financial.collector import download, parse_response
from app.modules.financial.domain import (
    amount,
    calculate,
    comparisons,
    map_facts,
    note_borrowing_summaries,
)
from app.modules.financial.notes import extract_note_candidates, supplement

CONTEXT = {
    "corp_code": "00126380",
    "receipt_no": "20260320000001",
    "scope": "OFS",
    "fiscal_year": "2025",
}


def row(account, value="100", previous="80", statement="BS", name="company label", **kwargs):
    return {
        "corp_code": CONTEXT["corp_code"],
        "rcept_no": CONTEXT["receipt_no"],
        "bsns_year": "2025",
        "reprt_code": "11011",
        "sj_div": statement,
        "account_id": account,
        "account_nm": name,
        "currency": "KRW",
        "thstrm_amount": value,
        "frmtrm_amount": previous,
        "bfefrmtrm_amount": "60",
        **kwargs,
    }


def fact(facts, key, period="current"):
    return next(f for f in facts if f["key"] == key and f["period"] == period)


def test_id_mapping_different_names_missing_zero_and_ambiguous_are_distinct():
    rows = [
        row("ifrs-full_Assets", "0"),
        row("ifrs_CurrentAssets", "300"),
        row("ifrs-full_CurrentLiabilities", "200"),
        row("ifrs-full_Inventories", "-"),
        row("ifrs-full_TradeReceivables", "20"),
        row("ifrs-full_TradeReceivables", "21"),
    ]
    facts = map_facts(rows)
    assert fact(facts, "assets")["value"] == "0"
    assert fact(facts, "inventory")["value"] is None
    assert fact(facts, "receivables")["reason"] == "ambiguous_account"
    assert fact(facts, "current_assets")["sources"][0]["account_name"] == "company label"
    metrics, totals = calculate(facts)
    assert (
        next(m for m in metrics if m["key"] == "current_ratio")["values"][0]["value"] == "150.0000"
    )
    assert totals["current"] is None


def test_broad_aggregates_finance_costs_and_unknown_standard_ids_are_not_substituted():
    facts = map_facts(
        [
            row("ifrs-full_TradeAndOtherCurrentReceivables", name="매출채권"),
            row("ifrs-full_FinanceCosts", statement="IS", name="이자비용"),
            row("ifrs-full_CurrentBorrowings", name="단기차입금"),
        ]
    )
    assert all(
        fact(facts, k)["value"] is None
        for k in ("receivables", "interest_expense", "short_borrowings")
    )
    exact = map_facts([row("-표준계정코드 미사용-", name="단기 차입금")])
    assert fact(exact, "short_borrowings")["value"] == "100"


def test_is_precedence_does_not_select_attributable_profit_or_cf_interest_paid():
    facts = map_facts(
        [
            row("ifrs-full_ProfitLoss", "10", statement="IS"),
            row("ifrs-full_ProfitLoss", "20", statement="CIS"),
            row("ifrs-full_InterestPaidClassifiedAsOperatingActivities", statement="CF"),
        ]
    )
    assert fact(facts, "net_profit")["value"] == "10"
    assert fact(facts, "interest_expense")["value"] is None


def test_lease_option_missing_components_and_negative_denominator():
    facts = map_facts(
        [
            row("ifrs-full_Liabilities", "500"),
            row("ifrs-full_Equity", "-100"),
            row("ifrs-full_CurrentLeaseLiabilities", "20"),
        ]
    )
    metrics, _ = calculate(facts)
    assert (
        next(m for m in metrics if m["key"] == "debt_ratio")["values"][0]["reason"]
        == "nonpositive_denominator"
    )
    metrics, _ = calculate(facts, "exclude")
    assert (
        next(m for m in metrics if m["key"] == "debt_ratio")["values"][0]["reason"]
        == "missing_input"
    )
    assert (
        next(m for m in metrics if m["key"] == "operating_roa")["values"][0]["reason"]
        == "missing_input"
    )


def test_operating_roa_uses_each_period_closing_assets_without_average_or_lease_adjustment():
    facts = map_facts(
        [
            row("ifrs-full_Assets", "1000", "100", bfefrmtrm_amount="500"),
            row("dart_OperatingIncomeLoss", "100", "20", "IS", bfefrmtrm_amount="50"),
        ]
    )
    metrics, _ = calculate(facts)
    roa = next(m for m in metrics if m["key"] == "operating_roa")
    assert [v["value"] for v in roa["values"]] == ["10.0000", "20.0000", "10.0000"]
    assert roa["inputs"] == ["operating_profit", "assets"]
    assert roa["formula"] == "영업이익 ÷ 기말 자산총계 × 100"
    assert "기말 자산총계" in roa["basis"]
    assert next(m for m in calculate(facts, "exclude")[0] if m["key"] == "operating_roa") == roa
    fact(facts, "assets", "previous")["value"] = None
    roa = next(m for m in calculate(facts)[0] if m["key"] == "operating_roa")
    assert roa["values"][0]["value"] == "10.0000"
    assert roa["values"][1]["reason"] == "missing_input"


@pytest.mark.parametrize(
    "assets,profit,value,reason",
    [
        ("0", "100", None, "nonpositive_denominator"),
        ("-1000", "100", None, "nonpositive_denominator"),
        ("-", "100", None, "missing_input"),
        ("1000", "-50", "-5.0000", None),
        ("1000", "0", "0.0000", None),
    ],
)
def test_operating_roa_preserves_negative_profit_zero_and_missing(assets, profit, value, reason):
    facts = map_facts(
        [row("ifrs-full_Assets", assets), row("dart_OperatingIncomeLoss", profit, statement="IS")]
    )
    roa = next(m for m in calculate(facts)[0] if m["key"] == "operating_roa")
    assert roa["values"][0]["value"] == value
    assert roa["values"][0]["reason"] == reason


def test_exact_bridge_and_transition_with_no_growth_on_negative_base():
    facts = map_facts(
        [
            row("ifrs-full_Revenue", "1100", "1000", "IS"),
            row("ifrs-full_CostOfSales", "660", "600", "IS"),
            row("dart_TotalSellingGeneralAdministrativeExpenses", "210", "200", "IS"),
            row("dart_OperatingIncomeLoss", "235", "200", "IS"),
        ]
    )
    changes, bridge = comparisons(facts)
    assert changes["operating_profit"]["amount"] == "35"
    assert sum(Decimal(i["value"]) for i in bridge) == Decimal("35")
    assert bridge[-1]["value"] == "5"
    changes, _ = comparisons(map_facts([row("dart_OperatingIncomeLoss", "-10", "20", "IS")]))
    assert changes["operating_profit"]["transition"] == "NEGATIVE_TURN"
    assert amount("(1,234)") == -1234 and amount("-") is None
    assert amount("1,23") is None and amount("0.0000001") is None


@pytest.mark.parametrize(
    "change,code",
    [
        ({"rcept_no": "20260321000001"}, "financial_receipt_mismatch"),
        ({"corp_code": "00000001"}, "financial_company_mismatch"),
        ({"fs_div": "CFS"}, "financial_response_invalid"),
    ],
)
def test_response_identity_and_scope_guard(change, code):
    with pytest.raises(CollectionError, match=code):
        parse_response(
            json.dumps({"status": "000", "list": [row("ifrs-full_Assets", **change)]}).encode(),
            CONTEXT,
        )


def test_api_empty_rate_limit_and_secret_safe_network_failure(monkeypatch):
    assert parse_response(b'{"status":"013"}', CONTEXT) == []
    with pytest.raises(CollectionError, match="financial_rate_limited") as error:
        parse_response(b'{"status":"020","message":"private-key"}', CONTEXT)
    assert error.value.retryable and "private-key" not in str(error.value)
    monkeypatch.setattr("urllib.request.urlopen", lambda *a, **k: io.BytesIO(b'{"status":"013"}'))
    assert download("private-key", CONTEXT) == b'{"status":"013"}'

    def fail(*args, **kwargs):
        raise OSError("private-key")

    monkeypatch.setattr("urllib.request.urlopen", fail)
    with pytest.raises(CollectionError, match="financial_download_failed"):
        download("private-key", CONTEXT)


def test_cached_note_supplement_requires_explicit_units_columns_and_unambiguous_values():
    html = (
        "<p>금융비용 (단위: 천원)</p><table><tr><th>구분</th><th>당기</th><th>전기</th></tr>"
        "<tr><td>이자비용</td><td>25</td><td>20</td></tr></table>"
    )
    candidates = extract_note_candidates(html.encode(), "utf-8", "a" * 64)
    facts = supplement(map_facts([]), candidates)
    assert fact(facts, "interest_expense")["value"] == "25000"
    assert fact(facts, "interest_expense")["sources"][0]["source_xpath"]
    missing_unit = html.replace("(단위: 천원)", "")
    facts = supplement(
        map_facts([]), extract_note_candidates(missing_unit.encode(), "utf-8", "a" * 64)
    )
    assert fact(facts, "interest_expense")["value"] is None
    conflicting = candidates + [{**candidates[0], "value": "99"}]
    assert fact(supplement(map_facts([]), conflicting), "interest_expense")["value"] is None


def test_official_filing_samples_for_all_four_companies_and_both_scopes():
    cases = json.loads(
        (Path(__file__).parent / "fixtures/financial_cases.json").read_text(encoding="utf-8")
    )
    assert len(cases) == 8
    for case in cases:
        metrics, _ = calculate(map_facts(case["rows"]))
        values = {m["key"]: m["values"][0]["value"] for m in metrics}
        for key, expected in case["expected"].items():
            assert values[key] == expected, (case["context"], key)


def test_separate_period_caption_and_signed_corroboration_never_create_expense_from_negative_only():
    source = (
        "<p>금융비용 당기 (단위: 천원)</p><table><tr><th></th><th>공시금액</th></tr>"
        "<tr><td>이자비용(금융원가)</td><td>(25)</td></tr></table>"
        "<p>금융비용 당기 (단위: 천원)</p><table><tr>"
        "<th></th><th>단기차입</th><th>부채 합계</th></tr>"
        "<tr><td>이자비용(금융원가)</td><td>25</td><td>25</td></tr></table>"
    )
    candidates = extract_note_candidates(source.encode(), "utf-8", "a" * 64)
    assert fact(supplement(map_facts([]), candidates), "interest_expense")["value"] == "25000"
    negative = [c for c in candidates if not c["eligible"]]
    assert fact(supplement(map_facts([]), negative), "interest_expense")["value"] is None


def test_ottogi_capital_note_subtotal_reconciles_without_filling_missing_bonds():
    source = (Path(__file__).parent / "fixtures/ottogi-capital-notes.html").read_bytes()
    candidates = extract_note_candidates(source, "utf-8", "a" * 64)
    rows = [
        row("ifrs-full_Assets", "2594463552213"),
        row("ifrs-full_CurrentLeaseLiabilities", "3611991272"),
        row("ifrs-full_NoncurrentLeaseLiabilities", "4430387738"),
    ]
    facts = supplement(map_facts(rows), candidates)
    assert fact(facts, "note_borrowing_subtotal")["value"] == "419636531000"
    assert fact(facts, "note_borrowing_subtotal", "previous")["value"] == "395650256000"
    assert fact(facts, "note_borrowing_subtotal")["mapping_method"] == "note_reconciled_subtotal"
    assert fact(facts, "bonds")["value"] is None
    assert fact(facts, "current_bonds")["value"] is None
    assert calculate(facts)[1]["current"] is None
    excluded = note_borrowing_summaries(facts, "exclude")["current"]
    included = note_borrowing_summaries(facts, "include")["current"]
    assert excluded["adjusted_subtotal"] == "419636531000"
    assert included["adjusted_subtotal"] == "427678910010"
    assert included["reconciliation"]["value"] == "-37382782000"
    assert len([c for c in included["components"] if c["kind"] == "borrowing"]) == 3


def test_note_subtotal_requires_exact_reconciliation_and_explicit_won_unit():
    source = (Path(__file__).parent / "fixtures/ottogi-capital-notes.html").read_bytes()
    wrong_control = source.replace(b"37,382,782", b"37,382,781").replace(
        b"84,626,801", b"84,626,800"
    )
    wrong_unit = source.replace("천원".encode(), b"USD")
    for invalid in (wrong_control, wrong_unit):
        candidates = extract_note_candidates(invalid, "utf-8", "a" * 64)
        assert not any(c["key"] == "note_borrowing_subtotal" for c in candidates)


def test_missing_lease_keeps_valid_note_base_but_withholds_adjusted_subtotal():
    source = (Path(__file__).parent / "fixtures/ottogi-capital-notes.html").read_bytes()
    facts = supplement(map_facts([]), extract_note_candidates(source, "utf-8", "a" * 64))
    summary = note_borrowing_summaries(facts, "include")["current"]
    assert summary["base_subtotal"] == "419636531000"
    assert summary["adjusted_subtotal"] is None and summary["reason"] == "missing_lease_input"
