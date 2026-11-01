import json
from uuid import uuid4

import pytest

from app.modules.evidence.dump_archive import copy_value
from app.modules.evidence.dump_load import validate_package
from app.modules.evidence.dump_normalize import segments


def test_copy_null_escape_and_literal_backslash_are_distinct():
    assert copy_value(r"\N") is None
    assert copy_value(r"\\N") == r"\N"
    assert copy_value(r"first\nsecond\t\\") == "first\nsecond\t\\"
    assert copy_value(r"\141\x62") == "ab"


def test_ragged_stored_table_keeps_dashes_and_no_invented_span_information():
    row = {
        "id": "1",
        "seq": "2",
        "fs_div": "OFS",
        "note_title": "리스",
        "body": "단위: 천원",
        "tables": json.dumps(
            [{"seq": 1, "unit": "천원", "cells": [["당기", "전기"], ["리스", "-", "0"]]}]
        ),
    }
    result = list(segments(uuid4(), "note_section", row))
    assert result[1]["data"]["table"]["cells"][-1] == ["리스", "-", "0"]
    assert result[1]["data"]["span_information_available"] is False
    assert "xpath" not in result[1]["location"]
    row["fs"] = "별도인지 확인 필요"
    assert list(segments(uuid4(), "audit_opinion", row))[0]["scope"] == "UNKNOWN"


def test_wrong_dump_table_shape_is_rejected():
    with pytest.raises(ValueError, match="invalid_dump_cells"):
        list(segments(uuid4(), "note_section", {"id": "1", "tables": '[{"cells":["wrong"]}]'}))


def test_partial_or_tampered_package_not_accepted(tmp_path):
    (tmp_path / "manifest.json").write_text(json.dumps({"version": "bad", "tables": {}}))
    with pytest.raises(ValueError, match="unsupported_package"):
        validate_package(tmp_path)
