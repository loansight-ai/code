import csv
import io
from pathlib import Path
from zipfile import ZipFile

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.config import Settings
from app.main import create_app
from app.modules.company import catalog as module
from app.modules.company.catalog import CatalogUnavailable, CompanyCatalog, parse_archive
from app.modules.company.profiles import FIELDS


def archive(rows=None):
    rows = rows or [
        ("00123456", "삼성전자", "Samsung Electronics", "005930"),
        ("00987654", "삼성상사", "", ""),
        ("01933981", "영문코드기업", "", "0068Y0"),
    ]
    xml = (
        "<result>"
        + "".join(
            f"<list><corp_code>{code}</corp_code><corp_name>{name}</corp_name>"
            f"<corp_eng_name>{english}</corp_eng_name><stock_code>{stock}</stock_code>"
            "<modify_date>20261028</modify_date></list>"
            for code, name, english, stock in rows
        )
        + "</result>"
    )
    stream = io.BytesIO()
    with ZipFile(stream, "w") as output:
        output.writestr("CORPCODE.xml", xml)
    return stream.getvalue()


def settings(tmp_path, **kwargs):
    return Settings(
        _env_file=None,
        database_url="postgresql+psycopg://test:test@localhost/test",
        artifact_root=tmp_path,
        company_seed_csv=tmp_path / "seed.csv",
        ksic11_codes_csv=tmp_path / "ksic.csv",
        **kwargs,
    )


def test_preserves_leading_zeroes_and_alphanumeric_stock_codes():
    companies = parse_archive(archive())
    assert companies[0].corp_code == "00987654"
    assert companies[0].stock_code is None
    assert next(c for c in companies if c.corp_code == "01933981").stock_code == "0068Y0"


@pytest.mark.parametrize(
    "data",
    [
        b"<result><status>010</status><message>private-key</message></result>",
        b"broken zip",
        archive([("invalid", "test", "", "")]),
        archive([("00123456", "test", "", "bad")]),
    ],
)
def test_rejects_bad_responses_without_exposing_content(data):
    with pytest.raises(CatalogUnavailable, match="^dart_catalog_invalid$"):
        parse_archive(data)


def test_download_cache_reuse_search_and_failed_refresh(tmp_path, monkeypatch):
    calls = []

    def download(key):
        calls.append(key)
        return archive()

    monkeypatch.setattr(module, "download_archive", download)
    catalog = CompanyCatalog(settings(tmp_path, open_dart_api_key="test-key"))
    assert catalog.search("삼 성", 0, 1)["total"] == 2
    assert len(catalog.search("삼 성", 0, 1)["items"]) == 1
    assert catalog.search("samsung", 0, 30)["total"] == 1
    assert catalog.search("005930", 0, 30)["items"][0].corp_code == "00123456"
    assert catalog.search("00123456", 0, 30)["total"] == 1
    assert catalog.search("absent", 0, 30)["total"] == 0
    assert catalog.search("", 100, 30)["items"] == []
    assert calls == ["test-key"]
    assert len(CompanyCatalog(settings(tmp_path)).load()) == 3
    original = catalog.path.read_bytes()
    monkeypatch.setattr(module, "download_archive", lambda key: b"invalid")
    with pytest.raises(CatalogUnavailable):
        catalog.load(refresh=True)
    assert catalog.path.read_bytes() == original
    assert len(catalog.load()) == 3


async def test_endpoint_errors_pagination_and_validation(tmp_path, monkeypatch):
    app = create_app(settings(tmp_path))
    async with app.router.lifespan_context(app):

        async def search(q, offset, limit, industry, market):
            assert market is None  # Market filtering is covered by the DB repository tests.
            return app.state.company_catalog.search(q, offset, limit, industry)

        # Router contract only; PostgreSQL behavior is covered by integration tests.
        monkeypatch.setattr(app.state.company_repository, "search", search)
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/api/v1/companies")
            assert response.status_code == 503
            assert response.json() == {"detail": "dart_api_key_missing"}
            catalog = app.state.company_catalog
            catalog.path.parent.mkdir(parents=True)
            catalog.path.write_bytes(archive())
            response = await client.get("/api/v1/companies", params={"q": "삼성", "limit": 1})
            assert response.status_code == 200
            assert response.json()["total"] == 2
            assert len(response.json()["items"]) == 1
            for params in ({"limit": 101}, {"offset": -1}, {"q": "x" * 201}, {"industry": "금융"}):
                assert (await client.get("/api/v1/companies", params=params)).status_code == 422


async def test_industry_filters_use_hierarchy_before_pagination(tmp_path, monkeypatch):
    config = settings(tmp_path)
    config.ksic11_codes_csv = Path(__file__).parents[1] / "data/company/ksic11_codes.csv"
    codes = ["C", "264", "F", "41", "G", "46", "6811", "68111", "6812", "682", "77", "68", ""]
    rows = [(f"{index:08}", f"기업{index:02}", "", "") for index in range(len(codes))]
    with config.company_seed_csv.open("w", encoding="utf-8-sig", newline="") as output:
        writer = csv.DictWriter(output, fieldnames=FIELDS)
        writer.writeheader()
        for row, code in zip(rows, codes, strict=True):
            writer.writerow(
                dict.fromkeys(FIELDS, "")
                | {"corp_code": row[0], "corp_name": row[1], "ksic11_code": code}
            )
    app = create_app(config)
    async with app.router.lifespan_context(app):

        async def search(q, offset, limit, industry, market):
            assert market is None
            return app.state.company_catalog.search(q, offset, limit, industry)

        monkeypatch.setattr(app.state.company_repository, "search", search)
        catalog = app.state.company_catalog
        catalog.path.parent.mkdir(parents=True, exist_ok=True)
        catalog.path.write_bytes(archive(rows))
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            for industry, expected in (
                ("제조", [0, 1]),
                ("건설", [2, 3]),
                ("도소매", [4, 5]),
                ("부동산 임대", [6, 7]),
            ):
                response = await client.get(
                    "/api/v1/companies",
                    params={"industry": industry, "offset": 1, "limit": 1},
                )
                assert response.status_code == 200
                assert response.json()["total"] == 2
                assert response.json()["items"][0]["corp_code"] == f"{expected[1]:08}"
                result = catalog.search(f"기업{expected[0]:02}", 0, 30, industry)
                assert result["total"] == 1
            assert catalog.search("", 0, 30)["total"] == len(codes)
            # Preserve a stale classification for review, but exclude it from filtered results.
            catalog.profiles._states["00000001"] = {"industry_review": True}
            assert catalog.search("", 0, 30, "제조")["total"] == 1
