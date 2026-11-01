import pytest

from app.modules.evidence.fact_validation import column_period_matches, period_matches


@pytest.mark.parametrize(
    "label,period,current,expected",
    [
        ("2025년 12월 31일", "2025.12", True, True),
        ("2025.12.31", "2025.12", True, True),
        ("2025.12.31", "2025.01", False, False),
        ("당기말", "2025.12", True, True),
        ("전기말", "2025.12", True, False),
        ("당기와 전기", "2025.12", True, False),
        ("2025.12 및 2024.12", "2025.12", True, False),
    ],
)
def test_amount_column_has_one_supported_period(label, period, current, expected):
    assert column_period_matches(label, period, current) is expected


def test_citation_can_contain_dates_but_does_not_imply_a_column_mapping():
    quote = "2025년 12월 및 2024년 12월"
    assert period_matches(quote, "2025.12", True)
    assert not column_period_matches(quote, "2025.12", True)
