import pytest
from pydantic import ValidationError

from app.modules.evidence.search import excerpt, node_path, table_context
from app.modules.evidence.search_schemas import ContextQuery, SearchQuery


def test_excerpt_preserves_quote_around_spaced_keyword_and_unresolved_path():
    text = "앞" * 800 + "재무 약정 위반 없음" + "뒤" * 800
    result = excerpt(text, ["재무약정"])
    assert result["text"] == text[result["start"] : result["end"]]
    assert "재무 약정 위반 없음" in result["text"] and result["truncated"]
    nodes = {"a": {"id": "a", "title": "미확정", "parent_id": None}}
    assert node_path(nodes, "a") == [{"id": "a", "title": "미확정", "parent_id": None}]


def test_search_limits_and_literal_terms():
    assert SearchQuery(terms=[" 담보 ", "담보", "100%"]).terms == ["담보", "100%"]
    for payload in (
        {"terms": []},
        {"terms": ["x"] * 21},
        {"terms": ["x" * 101]},
        {"terms": ["담보"], "workspace_id": "untrusted"},
    ):
        with pytest.raises(ValidationError):
            SearchQuery.model_validate(payload)


def test_td_headers_are_not_guessed_and_leading_rows_remain_available():
    data = {
        "raw_table_html": (
            "<table><tr><td>당기</td><td>전기</td></tr><tr><td>100</td><td>90</td></tr></table>"
        )
    }
    query = ContextQuery(segment_id="11111111-1111-4111-8111-111111111111", row_offset=1)
    result = table_context(data, query)
    assert result["header_rows"] == []
    assert result["leading_rows"][0][0]["text"] == "당기"
    assert result["column_mapping_verified"] is False
