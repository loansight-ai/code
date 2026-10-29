from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.modules.financial.domain import map_facts
from app.modules.financial.enrichment import Candidate, apply_candidates, validate_cell


def example():
    table_id, caption_id = uuid4(), uuid4()
    caption = SimpleNamespace(
        id=caption_id, text="당기 (단위 : 천원)", local_id="caption", owner_node_id="n1", ordinal=1
    )
    table = SimpleNamespace(
        id=table_id,
        kind="table",
        local_id="table",
        owner_node_id="n1",
        ordinal=2,
        table_data={
            "raw_table_html": (
                "<table><tr><td>구분</td><td>금액</td></tr>"
                "<tr><td>자산총계</td><td>40,000,000</td></tr></table>"
            )
        },
    )
    c = Candidate(
        key="assets",
        period="current",
        account_name="자산총계",
        raw_amount="40,000,000",
        currency="KRW",
        unit_multiplier=1000,
        row_index=1,
        label_column=0,
        amount_column=1,
        citation={"segment_id": table_id, "quote": "자산총계"},
        period_citation={"segment_id": caption_id, "quote": "당기"},
        unit_citation={"segment_id": caption_id, "quote": "단위 : 천원"},
        rationale="공시의 자산총계 직접 금액",
    )
    result = {
        "facts": map_facts([]),
        "periods": [{"key": "current", "label": "제55기"}],
        "context": {"lease": "include"},
    }
    return c, {table_id: table, caption_id: caption}, result


def test_direct_cell_period_unit_and_value_are_verified():
    c, segments, result = example()
    assert validate_cell(c, segments, result) == (None, "40000000000")


def test_investee_and_related_party_subtotals_are_not_company_totals():
    c, segments, result = example()
    assert (
        validate_cell(c, segments, result, "특수관계자 거래")[0] == "account_scope_requires_review"
    )
    assert (
        validate_cell(c, segments, result, "종속기업의 요약 재무정보")[0]
        == "account_scope_requires_review"
    )


@pytest.mark.parametrize(
    "change,reason",
    [
        ({"raw_amount": "39"}, "amount_cell_mismatch"),
        ({"row_index": 8}, "cell_out_of_range"),
        ({"unit_multiplier": 1}, "unit_not_verified"),
        ({"period": "previous"}, "period_not_verified"),
        ({"account_name": "자산총계및기타"}, "account_scope_requires_review"),
    ],
)
def test_bad_candidates_are_not_applied(change, reason):
    c, segments, result = example()
    result["periods"].append({"key": "previous", "label": "제54기"})
    assert validate_cell(c.model_copy(update=change), segments, result)[0] == reason


def test_cropped_period_and_currency_citations_cannot_hide_ambiguity():
    c, segments, result = example()
    caption = segments[c.period_citation.segment_id]
    caption.text = "당기 전기 (단위 : 천원)"
    assert validate_cell(c, segments, result)[0] == "period_not_verified"
    caption.text = "당기 (단위 : 천원, USD)"
    assert validate_cell(c, segments, result)[0] == "currency_not_verified"


def test_conflicting_candidates_preserve_original_snapshot_and_missing_fact():
    _, _, baseline = example()
    candidates = [
        {"key": "assets", "period": "current", "value": value, "status": "VALIDATED"}
        for value in ("40000000000", "50000000000")
    ]
    enriched = apply_candidates(baseline, candidates)
    assert all(c["status"] == "CONFLICT" for c in candidates)
    assert next(f for f in enriched["facts"] if f["key"] == "assets")["value"] is None
    assert "metrics" not in baseline
