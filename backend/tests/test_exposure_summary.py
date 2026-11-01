from decimal import Decimal
from types import SimpleNamespace

from app.modules.evidence.exposure_summary import boundaries, build_summary


def bundle(period="2025.12"):
    return SimpleNamespace(id="bundle", fingerprint="revision", period=period, scope="OFS")


def record(value, role="LOAN_BALANCE", row=1, source="table", **changes):
    data = {
        "kind": "guarantee",
        "statement": "PF 대출보증",
        "direction": "PROVIDED",
        "obligation_type": "PF_GUARANTEE",
        "aggregation_level": "DETAIL",
        "project_count": 7,
        "amount_role": role,
        "maturity": None,
        "amount": {
            "cell": {
                "segment_id": source,
                "row": row,
                "column": {"LIMIT": 1, "COMMITMENT": 2, "LOAN_BALANCE": 3, "RELATED_PARTY": 4}.get(
                    role, 1
                ),
            }
        },
    }
    data.update(changes)
    return {
        "data": data,
        "value": Decimal(value),
        "source": {"segment_id": source, "title": "주석 34", "scope": "OFS"},
    }


def test_roles_received_and_total_rows_never_inflate_numerator():
    records = [
        record("5860"),
        record("8120", "LIMIT"),
        record("6540", "COMMITMENT"),
        record("1840", "RELATED_PARTY"),
        record("5860", row=2, aggregation_level="SUBTOTAL"),
        record("5860", row=3, aggregation_level="TOTAL"),
        record("1240", direction="RECEIVED", source="received"),
    ]
    result = build_summary(bundle(), records, equity="10000")
    assert result["provided"]["totals"] == {
        "limit": "8120",
        "commitment": "6540",
        "loan_balance": "5860",
        "related_party": "1840",
    }
    assert result["provided"]["rows"][0]["project_count"] == 7
    assert result["received"]["totals"]["loan_balance"] == "1240"
    assert result["ratio_percent"] == "58.600"


def test_missing_columns_unclassified_rows_and_overlapping_tables_fail_closed():
    result = build_summary(bundle(), [record("100", "LIMIT")], equity="1000")
    assert result["provided"]["totals"]["loan_balance"] is None
    assert result["ratio_percent"] is None
    assert result["provided"]["totals"]["related_party"] is None
    assert (
        build_summary(bundle(), [record("100", aggregation_level="UNKNOWN")])["provided"]["totals"][
            "loan_balance"
        ]
        is None
    )
    assert (
        build_summary(bundle(), [record("100"), record("100", source="duplicate-table")])[
            "provided"
        ]["totals"]["loan_balance"]
        is None
    )


def test_duplicate_cells_are_not_added_and_zero_is_only_explicit():
    result = build_summary(bundle(), [record("0"), record("0")], equity="0")
    assert result["provided"]["totals"]["loan_balance"] == "0"
    assert result["ratio_percent"] is None
    assert build_summary(bundle(), [])["maturity"]["obligation"]["values"]["within"] is None


def test_one_calendar_year_boundary_unknown_and_leap_year():
    result = build_summary(
        bundle(),
        [
            record("40", maturity="2026.12.31"),
            record("30", row=2, maturity="2027-01-01"),
            record("20", row=3),
            record("10", row=4, maturity="3~6개월"),
        ],
    )
    assert result["maturity"]["obligation"]["values"] == {
        "within": "40",
        "beyond": "30",
        "undisclosed": "30",
        "overdue": "0",
    }
    assert result["maturity"]["obligation"]["within_percent"] == "40.0"
    assert tuple(str(v) for v in boundaries("2024.02")) == ("2024-02-29", "2025-02-28")
    assert (
        build_summary(
            bundle(),
            [record("5", kind="borrowing_maturity", role="BALANCE", maturity="2026-12-31")],
        )["maturity"]["debt"]["total"]
        == "5"
    )


def test_litigation_uses_defendant_reported_totals_and_unique_cases_only():
    records = [
        record(
            "1000",
            "CLAIM",
            kind="litigation",
            direction="DEFENDANT",
            aggregation_level="TOTAL",
            case_count=12,
        ),
        record(
            "30",
            "PROVISION",
            kind="litigation",
            direction="DEFENDANT",
            aggregation_level="TOTAL",
            row=2,
        ),
        record(
            "900",
            "CLAIM",
            kind="litigation",
            direction="PLAINTIFF",
            aggregation_level="TOTAL",
            case_count=3,
            source="plaintiff",
        ),
    ]
    for i, value in enumerate(["50", "300", "100", "200"]):
        records.append(
            record(
                value,
                "CLAIM",
                kind="litigation",
                direction="DEFENDANT",
                case_number=f"2025가합{i}",
                row=i + 10,
            )
        )
    records.append(
        record(
            "300",
            "CLAIM",
            kind="litigation",
            direction="DEFENDANT",
            case_number="2025가합1",
            source="copy",
        )
    )
    result = build_summary(bundle(), records)["litigation"]
    assert (result["case_count"], result["claim"], result["provision"]) == (12, "1000", "30")
    assert [r["claim"] for r in result["top_cases"]] == ["300", "200", "100"]
    assert len(result["top_cases"]) == 3
    assert result["plaintiff_facts"] == 1


def test_financial_decimal_precision_is_preserved():
    result = build_summary(
        bundle(), [record("12345678901234567890.123456"), record("0.000001", row=2)]
    )
    assert result["provided"]["totals"]["loan_balance"] == "12345678901234567890.123457"


def test_overdue_dates_and_negative_equity_are_never_relabelled_missing():
    result = build_summary(bundle(), [record("10", maturity="2025-12-30")], equity="-100")
    assert result["maturity"]["obligation"]["values"]["overdue"] == "10"
    assert result["maturity"]["obligation"]["values"]["undisclosed"] == "0"
    assert result["equity"] == "-100"
    assert result["ratio_percent"] is None


def test_project_counts_are_not_summed_across_obligations_for_the_same_project():
    result = build_summary(bundle(), [record("10"), record("20", row=2)])
    assert result["provided"]["rows"][0]["project_count"] is None
    # A separate summary table is safely ignored when the detail table is available.
    result = build_summary(
        bundle(), [record("10"), record("10", source="summary", aggregation_level="TOTAL")]
    )
    assert result["provided"]["totals"]["loan_balance"] == "10"
