import asyncio
import copy
import json
from pathlib import Path

from pydantic import SecretStr
from sqlalchemy import func, select

from app.modules.financial.bok import with_benchmark
from app.modules.financial.ecos import EcosError, parse_response, supplement
from app.modules.financial.models import EcosObservation


def result(year="2025"):
    path = Path(__file__).resolve().parents[3] / "frontend/src/test/fixtures/financial-result.json"
    data = json.loads(path.read_text())
    data["context"].update(fiscal_year=year, period=f"{year}.12")
    return data


def downloader(calls):
    def fetch(key, table, industry, size, item, years, unit, timeout):
        calls.append((table, industry, size, item, years))
        rows = [
            dict(
                STAT_CODE=table,
                ITEM_CODE1=industry,
                ITEM_CODE2=size,
                ITEM_CODE3=item,
                TIME=str(year),
                DATA_VALUE="321.00",
                UNIT_NAME=unit,
            )
            for year in years
        ]
        raw = json.dumps({"StatisticSearch": {"list_total_count": len(rows), "row": rows}})
        return parse_response(raw, table, industry, size, item, years, unit)

    return fetch


async def test_csv_precedes_api_and_unknown_metrics_are_not_requested(environment, monkeypatch):
    _, settings, database = environment
    settings.ecos_api_key = SecretStr("test-key")
    calls = []
    monkeypatch.setattr("app.modules.financial.ecos.download", downloader(calls))
    actual = await supplement(database, settings, result(), "10740")
    expected = with_benchmark(result(), "10740")
    assert actual == expected
    assert calls == []
    async with database.transaction() as db:
        assert await db.scalar(select(func.count()).select_from(EcosObservation)) == 0


async def test_missing_years_are_cached_and_reused_without_key(environment, monkeypatch):
    _, settings, database = environment
    settings.ecos_api_key = SecretStr("test-key")
    calls = []
    monkeypatch.setattr("app.modules.financial.ecos.download", downloader(calls))
    data = result("2022")
    before = copy.deepcopy(data)
    actual = await supplement(database, settings, data, "10740")
    assert data == before
    assert len(calls) == 11
    assert all(industry == "C10" and size == "A" for _, industry, size, _, _ in calls)
    coverage = next(
        m for m in actual["bok_benchmark"]["metrics"] if m["key"] == "interest_coverage"
    )
    assert coverage["values"][0]["value"] == "3.2100000000"
    assert coverage["values"][0]["ecos_metric_code"] == "627"
    assert coverage["values"][0]["source_kind"] == "ECOS"
    missing = next(m for m in actual["bok_benchmark"]["metrics"] if m["key"] == "operating_roa")
    assert all(p["value"] is None for p in missing["values"])
    async with database.transaction() as db:
        assert await db.scalar(select(func.count()).select_from(EcosObservation)) == 33
    calls.clear()
    settings.ecos_api_key = None
    reused = await supplement(database, settings, data, "10740")
    assert calls == []
    assert reused == actual


async def test_partial_history_keeps_csv_values_and_handles_failures(environment, monkeypatch):
    _, settings, database = environment
    settings.ecos_api_key = SecretStr("test-key")
    calls = []
    monkeypatch.setattr("app.modules.financial.ecos.download", downloader(calls))
    actual = await supplement(database, settings, result("2024"), "12000")
    ratio = next(m for m in actual["bok_benchmark"]["metrics"] if m["key"] == "current_ratio")
    assert [p["value"] for p in ratio["values"]][:2] == ["133.77", "138.55"]
    assert all(years == {2022} for *_, years in calls)
    assert all(industry == "C" for _, industry, *_ in calls)

    def failed(*args):
        raise EcosError("ECOS 연결 실패 또는 응답 시간 초과")

    monkeypatch.setattr("app.modules.financial.ecos.download", failed)
    unavailable = await supplement(database, settings, result("2019"), "10740")
    for metric in unavailable["bok_benchmark"]["metrics"]:
        if not metric["source_metric_code"].startswith("NA_"):
            assert all(p["value"] is None and "연결 실패" in p["reason"] for p in metric["values"])


async def test_cached_snapshot_values_are_not_replaced(environment, monkeypatch):
    _, settings, database = environment
    settings.ecos_api_key = SecretStr("test-key")
    calls = []
    monkeypatch.setattr("app.modules.financial.ecos.download", downloader(calls))
    pinned = with_benchmark(result("2022"), "10740")
    ratio = next(m for m in pinned["bok_benchmark"]["metrics"] if m["key"] == "current_ratio")
    ratio["values"][0].update(value="111.11", reason=None)
    actual = await supplement(database, settings, pinned, "68112")
    assert actual["bok_benchmark"]["industry_code"] == "C10"
    selected = next(m for m in actual["bok_benchmark"]["metrics"] if m["key"] == "current_ratio")
    assert selected["values"][0]["value"] == "111.11"
    assert next(
        years for table, _, _, item, years in calls if table == "501Y007" and item == "702"
    ) == {2020, 2021}


async def test_blank_snapshot_uses_existing_csv_before_api(environment, monkeypatch):
    _, settings, database = environment
    settings.ecos_api_key = SecretStr("test-key")
    calls = []
    monkeypatch.setattr("app.modules.financial.ecos.download", downloader(calls))
    pinned = with_benchmark(result(), "10740")
    ratio = next(m for m in pinned["bok_benchmark"]["metrics"] if m["key"] == "current_ratio")
    ratio["values"][0].update(value=None, reason="legacy_missing")
    actual = await supplement(database, settings, pinned, "10740")
    assert actual == with_benchmark(result(), "10740")
    assert calls == []


async def test_missing_key_does_not_cache_or_turn_absence_into_zero(environment):
    _, settings, database = environment
    actual = await supplement(database, settings, result("2022"), "10740")
    for metric in actual["bok_benchmark"]["metrics"]:
        if metric["source_metric_code"] in ("702", "629"):
            assert all(p["value"] is None and "키 미설정" in p["reason"] for p in metric["values"])
    async with database.transaction() as db:
        assert await db.scalar(select(func.count()).select_from(EcosObservation)) == 0


async def test_concurrent_missing_requests_reuse_one_immutable_row_per_year(
    environment, monkeypatch
):
    _, settings, database = environment
    settings.ecos_api_key = SecretStr("test-key")
    calls = []
    monkeypatch.setattr("app.modules.financial.ecos.download", downloader(calls))
    pinned = with_benchmark(result("2022"), "10740")
    pinned["bok_benchmark"]["metrics"] = [
        m for m in pinned["bok_benchmark"]["metrics"] if m["key"] == "current_ratio"
    ]
    first, second = await asyncio.gather(
        supplement(database, settings, pinned),
        supplement(database, settings, pinned),
    )
    assert first == second
    async with database.transaction() as db:
        assert await db.scalar(select(func.count()).select_from(EcosObservation)) == 3
