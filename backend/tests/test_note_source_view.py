from uuid import uuid4

import pytest

from app.modules.evidence.source_view import prepare_source_view


def test_derived_source_anchors_do_not_change_original_and_share_element_locations():
    source = (
        b'<html><body><!--comment--><p id="old" name="old">Original text</p>'
        b'<table><tr><td>42</td></tr></table></body></html>'
    )
    before = bytes(source)
    first, second, table = uuid4(), uuid4(), uuid4()
    view = prepare_source_view(
        source,
        "utf-8",
        [(first, "/html/body/p"), (second, "/html/body/p"), (table, "/html/body/table")],
    )
    assert source == before
    assert view["anchors"][str(first)] == view["anchors"][str(second)]
    assert view["anchors"][str(table)] != view["anchors"][str(first)]
    assert 'id="old"' not in view["html"] and 'name="old"' not in view["html"]
    assert "Original text" in view["html"] and "<table" in view["html"]


def test_missing_source_location_is_not_silently_displayed():
    with pytest.raises(ValueError, match="source_location_mismatch"):
        prepare_source_view(
            b"<html><body><p>x</p></body></html>", "utf-8", [(uuid4(), "/html/body/table")]
        )
