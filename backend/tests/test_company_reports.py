import io
import json
from urllib.parse import parse_qs, urlparse

import pytest

from app.modules.company.catalog import CatalogUnavailable
from app.modules.company.reports import download_reports


def row(number, title="사업보고서 (2025.12)", code="00126380", remarks=""):
    return {
        "corp_code": code,
        "rcept_no": f"20260320{number:06}",
        "report_nm": title,
        "rcept_dt": "20260320",
        "rm": remarks,
    }


def page(items, page_no=1, total_page=1, total_count=None):
    return json.dumps(
        {
            "status": "000",
            "page_no": page_no,
            "total_page": total_page,
            "total_count": len(items) if total_count is None else total_count,
            "list": items,
        }
    ).encode()


def test_all_pages_and_fiscal_periods_not_filing_year(monkeypatch):
    calls = []
    pages = [
        page([row(3), row(2, "[기재정정]사업보고서 (2024.03)")], 1, 2, 3),
        page([row(1, "사업보고서 (1998.12)", remarks="철")], 2, 2, 3),
    ]

    def request(url, timeout):
        calls.append(parse_qs(urlparse(url).query))
        return io.BytesIO(pages[len(calls) - 1])

    monkeypatch.setattr("urllib.request.urlopen", request)
    items, originals = download_reports("private-key", "00126380", "20261028")
    assert [item["period"] for item in items] == ["2025.12", "2024.03", "1998.12"]
    assert items[0]["fiscal_year"] == "2025"
    assert items[2]["withdrawn"] is True
    assert originals == pages
    assert [call["page_no"] for call in calls] == [["1"], ["2"]]
    assert calls[0]["pblntf_detail_ty"] == ["A001"]
    assert calls[0]["last_reprt_at"] == ["Y"]
    assert calls[0]["bgn_de"] == ["19990101"]


@pytest.mark.parametrize(
    "response",
    [
        b'{"status":"020","message":"private-key"}',
        b"invalid",
        b"[]",
        b"null",
        page([row(1, code="99999999")]),
        page([row(1, "unknown title")]),
        page([row(1)], total_count=2),
        page([row(1), row(1)]),
    ],
)
def test_rejects_errors_and_incomplete_lists_without_exposing_secrets(monkeypatch, response):
    monkeypatch.setattr("urllib.request.urlopen", lambda *args, **kwargs: io.BytesIO(response))
    with pytest.raises(CatalogUnavailable) as error:
        download_reports("private-key", "00126380", "20261028")
    assert "private-key" not in str(error.value)


def test_empty_is_not_failure(monkeypatch):
    monkeypatch.setattr(
        "urllib.request.urlopen", lambda *args, **kwargs: io.BytesIO(b'{"status":"013"}')
    )
    assert download_reports("private-key", "00126380", "20261028")[0] == []
