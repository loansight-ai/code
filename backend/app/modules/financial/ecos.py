"""Fill missing BOK reference observations only; never disclose keyed request URLs."""

import asyncio
import copy
import hashlib
import json
import urllib.error
import urllib.parse
import urllib.request
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from app.modules.financial.bok import dataset, number, with_benchmark
from app.modules.financial.models import EcosObservation

VERSION = "ecos-fsa-v1"
ENDPOINT = "https://ecos.bok.or.kr/api/StatisticSearch"
PUBLIC_URL = "https://ecos.bok.or.kr/api/"
MAX_BYTES = 1024 * 1024
# Book code -> official table, ECOS account code, source unit.
METRICS = {
    "506": ("501Y005", "506", "%"),
    "611": ("501Y006", "611", "%"),
    "612": ("501Y006", "612", "%"),
    "629": ("501Y006", "627", "%"),
    "701": ("501Y007", "701", "%"),
    "702": ("501Y007", "702", "%"),
    "707": ("501Y007", "707", "%"),
    "710": ("501Y007", "710", "%"),
    "807": ("501Y008", "806", "회"),
    "809": ("501Y008", "808", "회"),
    "810": ("501Y008", "809", "회"),
}
INDUSTRIES = {"C10-34": "C", "F41-42": "F", "G45-47": "G", "L68": "L"}
SIZES = {"전체": "A", "대기업": "L", "중견기업": "J", "중소기업": "M", "중기업": "D", "소기업": "S"}


class EcosError(Exception):
    pass


def parse_response(raw, stat_code, industry, size, metric_code, years, unit):
    try:
        data = json.loads(raw)
        if "RESULT" in data:
            code = data["RESULT"].get("CODE")
            raise EcosError(
                "ECOS 해당 통계 미제공"
                if code == "INFO-200"
                else "ECOS 조회 실패 · 인증 또는 요청 한도 확인 필요"
            )
        table = data["StatisticSearch"]
        rows = table["row"]
        if not isinstance(rows, list) or int(table["list_total_count"]) != len(rows):
            raise ValueError()
        observations = {}
        for row in rows:
            year = int(row["TIME"])
            value = number(row["DATA_VALUE"])
            if (
                row["STAT_CODE"] != stat_code
                or row["ITEM_CODE1"] != industry
                or row["ITEM_CODE2"] != size
                or row["ITEM_CODE3"] != metric_code
                or row["UNIT_NAME"].strip() != unit
                or year not in years
                or year in observations
            ):
                raise ValueError()
            # Missing/suppressed observations remain missing, never zero.
            if value is None:
                continue
            source = {
                key: row[key]
                for key in (
                    "STAT_CODE",
                    "ITEM_CODE1",
                    "ITEM_CODE2",
                    "ITEM_CODE3",
                    "TIME",
                    "DATA_VALUE",
                    "UNIT_NAME",
                )
            }
            observations[year] = {
                "value": value,
                "unit": unit,
                "source_row": source,
                "source_sha256": hashlib.sha256(
                    json.dumps(source, sort_keys=True, ensure_ascii=False).encode()
                ).hexdigest(),
            }
        return observations
    except EcosError:
        raise
    except (ValueError, KeyError, TypeError, AttributeError, UnicodeError):
        raise EcosError("ECOS 응답의 통계표·항목·연도·단위 검증 실패") from None


def download(key, stat_code, industry, size, metric_code, years, unit, timeout):
    # ECOS dimensions must be industry -> company size -> account.
    path = "/".join(
        urllib.parse.quote(str(v), safe="")
        for v in (
            key,
            "json",
            "kr",
            1,
            10,
            stat_code,
            "A",
            min(years),
            max(years),
            industry,
            size,
            metric_code,
        )
    )
    try:
        with urllib.request.urlopen(f"{ENDPOINT}/{path}", timeout=timeout) as response:
            raw = response.read(MAX_BYTES + 1)
        if len(raw) > MAX_BYTES:
            raise EcosError("ECOS 응답 크기 초과")
    except (urllib.error.URLError, TimeoutError, OSError):
        raise EcosError("ECOS 연결 실패 또는 응답 시간 초과") from None
    # The API can return intervening years, but only missing requested years are saved.
    return {
        year: row
        for year, row in parse_response(
            raw,
            stat_code,
            industry,
            size,
            metric_code,
            set(range(min(years), max(years) + 1)),
            unit,
        ).items()
        if year in years
    }


def apply_observation(point, observation, book_code):
    value = observation.value / 100 if book_code == "629" else observation.value
    point.update(
        value=format(value, "f"),
        reason=None,
        source_kind="ECOS",
        source_url=PUBLIC_URL,
        stat_code=observation.stat_code,
        ecos_metric_code=observation.metric_code,
        ecos_industry_code=observation.industry_code,
        ecos_size_code=observation.size_code,
        fetched_at=observation.fetched_at.isoformat(),
        source_sha256=observation.source_sha256,
    )


async def supplement(database, settings, result, ksic_code=None):
    if result is None:
        return None
    result = copy.deepcopy(with_benchmark(result, ksic_code))
    benchmark = result["bok_benchmark"]
    industry = INDUSTRIES.get(benchmark.get("industry_code"), benchmark.get("industry_code"))
    size = SIZES.get(benchmark.get("company_size"))
    # Old snapshots can have blank points even when their exact CSV version
    # contains an observation. Prefer that source before consulting ECOS.
    try:
        tables, csv_version = dataset()
        source_rows = tables["bok_ratio_values"]
    except (OSError, ValueError):
        source_rows, csv_version = [], None
    local = {
        (row["metric_code"], int(row["year"])): row
        for row in source_rows
        if benchmark.get("version") == csv_version
        and row["release_id"] == benchmark.get("release_id")
        and row["industry_code"] == benchmark.get("industry_code")
        and row["company_size_code"] == benchmark.get("company_size")
        and row["population_code"] == "ALL_CORP"
        and row["frequency"] == "연간"
        and row["data_status"] == "확보"
    }
    missing = {}
    for metric in benchmark["metrics"]:
        code = metric["source_metric_code"]
        for point in metric["values"]:
            row = local.get((code, point["year"]))
            value = number(row["value"]) if row else None
            if point["value"] is None and value is not None:
                point.update(value=str(value / 100 if code == "629" else value), reason=None)
        points = [p for p in metric["values"] if p["value"] is None and p["year"] >= 2009]
        if code in METRICS and points:
            missing[code] = points
    if not missing or not industry or not size:
        return with_benchmark(result)
    years = {p["year"] for points in missing.values() for p in points}
    async with database.transaction() as db:
        cached = (
            await db.scalars(
                select(EcosObservation).where(
                    EcosObservation.adapter_version == VERSION,
                    EcosObservation.industry_code == industry,
                    EcosObservation.size_code == size,
                    EcosObservation.year.in_(years),
                )
            )
        ).all()
    by_key = {(r.stat_code, r.metric_code, r.year): r for r in cached}
    for code, points in missing.items():
        table, item, _ = METRICS[code]
        for point in points:
            observation = by_key.get((table, item, point["year"]))
            if observation:
                apply_observation(point, observation, code)

    semaphore = asyncio.Semaphore(4)

    async def fill(code, points):
        points = [p for p in points if p["value"] is None]
        if not points:
            return
        if settings is None or not settings.ecos_api_key:
            for point in points:
                point["reason"] = "ECOS API 키 미설정 · 통계 보완 보류"
            return
        table, item, unit = METRICS[code]
        try:
            async with semaphore:
                rows = await asyncio.to_thread(
                    download,
                    settings.ecos_api_key.get_secret_value(),
                    table,
                    industry,
                    size,
                    item,
                    {p["year"] for p in points},
                    unit,
                    settings.ecos_timeout_seconds,
                )
        except EcosError as exc:
            for point in points:
                point["reason"] = str(exc)
            return
        for point in points:
            row = rows.get(point["year"])
            if row is None:
                point["reason"] = "ECOS 해당 연도 통계 미제공"
                continue
            key = dict(
                adapter_version=VERSION,
                stat_code=table,
                industry_code=industry,
                size_code=size,
                metric_code=item,
                year=point["year"],
            )
            async with database.transaction() as db:
                # A concurrent request must reuse the first saved official observation.
                await db.execute(
                    insert(EcosObservation)
                    .values(
                        **key,
                        **row,
                        fetched_at=datetime.now(UTC),
                    )
                    .on_conflict_do_nothing()
                )
                observation = await db.get(EcosObservation, key)
                apply_observation(point, observation, code)

    await asyncio.gather(*(fill(code, points) for code, points in missing.items()))
    if any(p["value"] is not None for m in benchmark["metrics"] for p in m["values"]):
        benchmark.update(status="AVAILABLE", reason=None)
    benchmark["ecos_adapter_version"] = VERSION
    return with_benchmark(result)
