import json
import urllib.error
from decimal import Decimal
from unittest.mock import patch

import pytest

from app.modules.financial.bok import ecos_mappings
from app.modules.financial.ecos import EcosError, download, parse_response


def response(**changes):
    row = dict(
        STAT_CODE="501Y007",
        ITEM_CODE1="F",
        ITEM_CODE2="A",
        ITEM_CODE3="707",
        TIME="2022",
        DATA_VALUE="123.45",
        UNIT_NAME="%",
    )
    row.update(changes)
    return json.dumps({"StatisticSearch": {"list_total_count": 1, "row": [row]}}).encode()


def parse(raw):
    return parse_response(raw, "501Y007", "F", "A", "707", {2022}, "%")


def test_ecos_codes_are_distinct_from_book_codes():
    METRICS, industries, sizes = ecos_mappings()
    assert industries["C10-34"] == "C"
    assert sizes["전체"] == "A"
    assert METRICS["629"][:2] == ("501Y006", "627")
    assert METRICS["807"][:2] == ("501Y008", "806")
    assert METRICS["809"][:2] == ("501Y008", "808")
    assert METRICS["810"][:2] == ("501Y008", "809")


def test_mapping_file_is_authoritative_and_excludes_description_rows(monkeypatch):
    import copy

    from app.modules.financial import bok

    tables, version = bok.dataset()
    changed = copy.deepcopy(tables)
    row = next(r for r in changed["ecos_mapping"] if r["source_code"] == "629")
    row["ecos_item_code"] = "test-account"
    monkeypatch.setattr(bok, "dataset", lambda: (changed, version))
    metrics, industries, sizes = bok.ecos_mappings()
    assert metrics["629"][1] == "test-account"
    assert "C10~C34·F41·F42·G45·G46·G47" not in industries
    assert set(sizes.values()) == {"A", "L", "J", "M", "D", "S"}
    changed["ecos_mapping"].append(row.copy())
    with pytest.raises(ValueError, match="mapping_invalid"):
        bok.ecos_mappings()


def test_exact_dimensions_year_unit_and_decimal_preserved():
    row = parse(response())[2022]
    assert row["value"] == Decimal("123.45")
    assert len(row["source_sha256"]) == 64
    assert parse(response(DATA_VALUE="0"))[2022]["value"] == 0
    assert parse(response(DATA_VALUE="-")) == {}
    assert parse(response(UNIT_NAME="% "))[2022]["unit"] == "%"


@pytest.mark.parametrize(
    "changes",
    [
        {"STAT_CODE": "501Y006"},
        {"ITEM_CODE1": "C"},
        {"ITEM_CODE2": "M"},
        {"ITEM_CODE3": "629"},
        {"TIME": "2021"},
        {"UNIT_NAME": "배"},
    ],
)
def test_rejects_mismatched_series(changes):
    with pytest.raises(EcosError, match="검증 실패"):
        parse(response(**changes))


def test_no_data_and_error_messages_do_not_leak_response_details():
    with pytest.raises(EcosError, match="미제공"):
        parse(b'{"RESULT":{"CODE":"INFO-200"}}')
    with pytest.raises(EcosError) as error:
        parse(b'{"RESULT":{"CODE":"ERROR-100","MESSAGE":"secret-key"}}')
    assert "secret-key" not in str(error.value)
    invalid = json.loads(response())
    invalid["StatisticSearch"]["list_total_count"] = 2
    with pytest.raises(EcosError, match="검증 실패"):
        parse(json.dumps(invalid))


def test_request_uses_industry_size_account_order_and_hides_transport_errors():
    with patch("urllib.request.urlopen") as request:
        request.return_value.__enter__.return_value.read.return_value = response()
        result = download("test-key", "501Y007", "F", "A", "707", {2022}, "%", 2)
        assert request.call_args.args[0].endswith("/501Y007/A/2022/2022/F/A/707")
        assert result[2022]["value"] == Decimal("123.45")
    with patch("urllib.request.urlopen", side_effect=urllib.error.URLError("secret-key")):
        with pytest.raises(EcosError) as error:
            download("secret-key", "501Y007", "F", "A", "707", {2022}, "%", 2)
        assert "secret-key" not in str(error.value)
