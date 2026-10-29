import asyncio
import csv
import io
from unittest.mock import Mock
from zipfile import ZipFile

import pytest
from sqlalchemy import event, func, select

from app.main import create_app
from app.modules.company.catalog import CatalogUnavailable, CompanyCatalog
from app.modules.company.models import CompanyImport, CompanyRecord
from app.modules.company.profiles import FIELDS, ProfileError, read_seed
from app.modules.company.repository import CompanyRepository


def master(source, rows):
    archive = io.BytesIO()
    with ZipFile(archive, "w") as output:
        output.writestr(
            "CORPCODE.xml",
            "<result>"
            + "".join(
                f"<list><corp_code>{code}</corp_code><corp_name>{name}</corp_name>"
                f"<corp_eng_name>{english}</corp_eng_name><stock_code>{stock}</stock_code>"
                "<modify_date>20261028</modify_date></list>"
                for code, name, english, stock in rows
            )
            + "</result>",
        )
    source.path.parent.mkdir(parents=True, exist_ok=True)
    source.path.write_bytes(archive.getvalue())


@pytest.fixture
async def catalog(environment):
    app, settings, database = environment
    settings.company_seed_csv = settings.artifact_root / "seed.csv"
    source = CompanyCatalog(settings)
    rows = [
        ("00123456", "삼성전자", "Samsung Electronics", "005930", "264"),
        ("00000001", "삼성상사", "", "", "46"),
        ("00000002", "삼성전자부품", "", "", "C"),
        ("00000003", "건설기업", "", "", "41"),
        ("00000004", "임대기업", "", "", "68111"),
        ("00000005", "개발기업", "", "", "6812"),
        ("00000006", "미분류기업", "", "", ""),
        ("00000007", "상위부동산", "", "", "68"),
        ("00000008", "관리기업", "", "", "682"),
        ("00000009", "물품렌탈", "", "", "77"),
        ("00000010", "100%기업", "", "0068Y0", "F"),
    ]
    master(source, [row[:4] for row in rows])
    with settings.company_seed_csv.open("w", encoding="utf-8-sig", newline="") as output:
        writer = csv.DictWriter(output, fieldnames=FIELDS)
        writer.writeheader()
        for code, name, _, _, ksic in rows:
            writer.writerow(
                dict.fromkeys(FIELDS, "")
                | {
                    "corp_code": code,
                    "corp_name": name,
                    "ksic11_code": ksic,
                }
            )
    repository = CompanyRepository(database, source)
    app.state.company_repository = repository
    return repository, source, rows


async def test_initial_import_is_once_concurrent_and_survives_restart(
    catalog, environment, monkeypatch
):
    repository, source, rows = catalog
    _, _, database = environment
    second = CompanyRepository(database, source)
    results = await asyncio.gather(repository.import_sources(), second.import_sources())
    assert sorted(results) == [False, True]
    async with database.transaction() as session:
        assert await session.scalar(select(func.count()).select_from(CompanyRecord)) == len(rows)
        imported_at = (await session.get(CompanyImport, 1)).imported_at
    monkeypatch.setattr(source, "load", Mock(side_effect=AssertionError("must read DB only")))
    source.path.unlink()
    restarted = CompanyRepository(database, source)
    result = await restarted.search("삼 성", 0, 1)
    assert result["total"] == 3
    assert len(result["items"]) == 1
    async with database.transaction() as session:
        assert (await session.get(CompanyImport, 1)).imported_at == imported_at


async def test_database_search_filters_count_pagination_and_exact_rank(catalog, client):
    repository, source, _ = catalog
    await repository.import_sources()
    source.load = Mock(side_effect=AssertionError("search must not load source"))
    for industry, count in (("제조", 2), ("건설", 2), ("도소매", 1), ("부동산 임대", 1)):
        response = await client.get("/api/v1/companies", params={"industry": industry, "limit": 1})
        assert response.status_code == 200
        assert response.json()["total"] == count
        assert len(response.json()["items"]) == 1
        assert response.json()["items"][0]["industry"] == industry
        response = await client.get(
            "/api/v1/companies", params={"industry": industry, "offset": count}
        )
        assert response.json()["total"] == count
        assert response.json()["items"] == []
    result = await repository.search("삼 성 전 자", 0, 1)
    assert result["total"] == 2
    assert result["items"][0].corp_code == "00123456"
    assert (await repository.search("sAmSuNg", 0, 30))["total"] == 1
    assert (await repository.search("005930", 0, 30))["total"] == 1
    assert (await repository.search("0068Y0", 0, 30))["total"] == 1
    assert (await repository.search("%", 0, 30))["total"] == 1
    assert (await repository.search("_", 0, 30))["total"] == 0


async def test_refresh_upserts_and_preserves_absent_companies(catalog, environment):
    repository, source, _ = catalog
    _, _, database = environment
    await repository.import_sources()
    master(
        source, [("00123456", "변경기업", "Changed", "005930"), ("00999999", "신규기업", "", "")]
    )
    assert await repository.import_sources(refresh=True)
    assert (await repository.search("", 0, 30))["total"] == 2
    assert (await repository.search("변경기업", 0, 30))["total"] == 1
    async with database.transaction() as session:
        assert (await session.get(CompanyRecord, "00000001")).active is False
        assert (await session.get(CompanyRecord, "00999999")).ksic11_status == "unmatched"
    assert not await repository.import_sources(refresh=True)


async def test_failed_refresh_retains_checkpoint_and_search(catalog, environment, monkeypatch):
    repository, source, _ = catalog
    _, _, database = environment
    await repository.import_sources()
    async with database.transaction() as session:
        signature = (await session.get(CompanyImport, 1)).source_signature
    master(source, [("00999999", "신규기업", "", "")])
    monkeypatch.setattr(source.profiles, "load", Mock(side_effect=ProfileError("bad_snapshot")))
    with pytest.raises((ProfileError, CatalogUnavailable)):
        await repository.import_sources(refresh=True)
    assert (await repository.search("", 0, 30))["total"] == 11
    async with database.transaction() as session:
        assert (await session.get(CompanyImport, 1)).source_signature == signature


async def test_import_failure_rolls_back_row_updates_and_checkpoint(catalog, environment):
    repository, source, _ = catalog
    _, _, database = environment
    await repository.import_sources()
    master(source, [("00999999", "신규기업", "", "")])

    def fail_checkpoint(connection, cursor, statement, parameters, context, executemany):
        if statement.startswith("INSERT INTO company_import"):
            raise RuntimeError("simulated checkpoint failure")

    event.listen(database.engine.sync_engine, "before_cursor_execute", fail_checkpoint)
    try:
        with pytest.raises(RuntimeError, match="checkpoint failure"):
            await repository.import_sources(refresh=True)
    finally:
        event.remove(database.engine.sync_engine, "before_cursor_execute", fail_checkpoint)
    assert (await repository.search("", 0, 30))["total"] == 11
    async with database.transaction() as session:
        assert await session.get(CompanyRecord, "00999999") is None
        assert (await session.get(CompanyImport, 1)).company_count == 11


async def test_profile_review_state_refreshes_database_filter(catalog):
    repository, source, _ = catalog
    await repository.import_sources()
    snapshot = source.profiles.store.read()
    snapshot["profiles"], _ = read_seed(source.profiles.seed)
    snapshot["companies"] = {"00123456": {"industry_review": True}}
    source.profiles.store.save(snapshot)
    await repository.import_sources(refresh=True)
    assert (await repository.search("", 0, 30, "제조"))["total"] == 1
    result = await repository.search("00123456", 0, 30)
    assert result["items"][0].ksic11_status == "review_required"


async def test_api_startup_imports_without_waiting_for_a_search(catalog, environment, monkeypatch):
    _, _, rows = catalog
    _, settings, database = environment
    application = create_app(settings)
    completed = asyncio.Event()
    original = CompanyRepository.import_sources

    async def track_import(repository, **kwargs):
        result = await original(repository, **kwargs)
        if repository is application.state.company_repository:
            completed.set()
        return result

    monkeypatch.setattr(CompanyRepository, "import_sources", track_import)
    async with application.router.lifespan_context(application):
        async with asyncio.timeout(5):
            await completed.wait()
        async with database.transaction() as session:
            assert (await session.get(CompanyImport, 1)).company_count == len(rows)


async def test_market_filter_applies_before_count_and_pagination(catalog, environment, client):
    from sqlalchemy import update

    repository, _, rows = catalog
    _, _, database = environment
    await repository.import_sources()
    async with database.transaction() as db:
        await db.execute(update(CompanyRecord).values(corp_cls=None))
        for code, market in ((rows[0][0], "Y"), (rows[1][0], "Y"), (rows[2][0], "K")):
            record = await db.get(CompanyRecord, code)
            record.corp_cls = market
    first = await client.get("/api/v1/companies", params={"market": "Y", "limit": 1})
    assert first.status_code == 200
    assert first.json()["total"] == 2
    assert len(first.json()["items"]) == 1
    assert first.json()["items"][0]["corp_cls"] == "Y"
    last = await client.get("/api/v1/companies", params={"market": "Y", "offset": 2})
    assert last.json()["total"] == 2 and last.json()["items"] == []
    assert (await client.get("/api/v1/companies", params={"market": "invalid"})).status_code == 422
