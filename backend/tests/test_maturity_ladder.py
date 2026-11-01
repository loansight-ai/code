from datetime import date
from decimal import Decimal

import pytest

from app.modules.evidence.exposure_summary import build_summary
from app.modules.evidence.maturity_ladder import classify, date_band, loan_period_band
from tests.test_exposure_summary import bundle, record


def test_disjoint_bands_reconcile_to_composition_and_year_summary_without_litigation():
    values = [
        ("M3", "1610"),
        ("M6", "0"),
        ("M12", "3400"),
        ("Y2", "3765"),
        ("Y3", "800"),
        ("OVER3", "600"),
        ("UNDISCLOSED", "810"),
    ]
    records = [
        record(value, row=i + 1, maturity_bucket=key) for i, (key, value) in enumerate(values)
    ]
    records.append(
        record("420", "CLAIM", kind="litigation", direction="DEFENDANT", source="lawsuit")
    )
    result = build_summary(bundle(), records)
    ladder = result["maturity_ladder"]
    assert ladder["total"] == result["provided"]["totals"]["loan_balance"] == "10985"
    assert sum(Decimal(b["amount"]) for b in ladder["bins"]) == Decimal("10985")
    assert ladder["within_amount"] == result["maturity"]["obligation"]["values"]["within"] == "5010"
    assert result["maturity"]["obligation"]["values"]["beyond"] == "5165"
    assert round(Decimal(ladder["within_percent"])) == 46
    assert len(ladder["items"]) == 7


@pytest.mark.parametrize(
    "ending,band",
    [
        ("2026-03-31", "M3"),
        ("2026-04-01", "M6"),
        ("2026-06-30", "M6"),
        ("2026-07-01", "M12"),
        ("2026-12-31", "M12"),
        ("2027-01-01", "Y2"),
        ("2027-12-31", "Y2"),
        ("2028-01-01", "Y3"),
        ("2028-12-31", "Y3"),
        ("2029-01-01", "OVER3"),
        ("2025-12-30", "OVERDUE"),
    ],
)
def test_calendar_boundaries(ending, band):
    assert date_band(date.fromisoformat(ending), date(2025, 12, 31)) == band


def test_loan_period_fallback_preserves_raw_period_and_does_not_invent_end_days():
    result = build_summary(bundle(), [record("100", loan_period="25.04~28.02")])
    ladder = result["maturity_ladder"]
    assert ladder["state"] == "RECALCULATED"
    assert ladder["items"][0]["basis"] == "LOAN_PERIOD"
    assert ladder["items"][0]["band"] == "Y3"
    assert ladder["items"][0]["loan_period"] == "25.04~28.02"
    assert ladder["within_amount"] == "0" and ladder["within_percent"] == "0"
    assert loan_period_band("2025.04~2026.05", date(2025, 11, 30)) is None
    assert loan_period_band("2028.04~2026.05", date(2025, 11, 30)) is None


def test_reported_band_precedes_loan_period_and_conflicting_date_is_held():
    assert classify(
        {"maturity_bucket": "M3", "loan_period": "2025.04~2028.02"}, date(2025, 12, 31)
    ) == ("M3", "REPORTED_BAND")
    result = build_summary(bundle(), [record("100", maturity_bucket="M3", maturity="2028-12-31")])[
        "maturity_ladder"
    ]
    assert result["state"] == "CONFLICT" and result["within_percent"] is None
    assert result["bins"][-1]["amount"] == "100"


def test_all_unknown_never_becomes_zero_percent_and_public_absence_is_distinct():
    for bucket, state in [(None, "MATURITY_UNCONFIRMED"), ("UNDISCLOSED", "UNDISCLOSED")]:
        result = build_summary(bundle(), [record("100", maturity_bucket=bucket)])["maturity_ladder"]
        assert result["state"] == state
        assert result["within_percent"] is None and result["within_amount"] is None
        assert result["bins"][-1]["amount"] == "100"
    absence = record("0")
    absence["data"]["citations"] = [{"field": "absence", "quote": "제공한 보증은 해당사항 없음"}]
    result = build_summary(bundle(), [], absences=[absence])["maturity_ladder"]
    assert result["state"] == "EXPLICIT_NONE" and result["total"] is None
    assert result["absence_quotes"][0]["quote"] == "제공한 보증은 해당사항 없음"
    zero_unknown = build_summary(bundle(), [record("0", maturity_bucket="UNDISCLOSED")])[
        "maturity_ladder"
    ]
    assert zero_unknown["state"] == "UNDISCLOSED" and zero_unknown["within_amount"] is None
    assert build_summary(bundle(), [])["maturity_ladder"]["state"] != "EXPLICIT_NONE"
    assert (
        build_summary(bundle(), [record("100")], absences=[absence])["maturity_ladder"]["state"]
        == "CONFLICT"
    )
    assert (
        build_summary(bundle(), [], absences=[absence], unready=1)["maturity_ladder"]["state"]
        == "REVIEW_REQUIRED"
    )
