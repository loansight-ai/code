"""Company-specific annual filing availability from the official DART list API."""

import asyncio
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import UTC, datetime, timedelta, timezone

from pydantic import BaseModel, Field
from sqlalchemy import text

from app.core.config import Settings
from app.core.database import Database
from app.core.storage import LocalArtifactStore
from app.modules.company.catalog import CatalogUnavailable
from app.modules.company.models import CompanyRecord, CompanyReportCatalog

SEARCH_START = "19990101"


class AnnualReport(BaseModel):
    receipt_no: str = Field(pattern=r"^[0-9]{14}$")
    report_name: str
    fiscal_year: str = Field(pattern=r"^[0-9]{4}$")
    period: str = Field(pattern=r"^[0-9]{4}\.(0[1-9]|1[0-2])$")
    receipt_date: str
    withdrawn: bool = False


class AnnualReports(BaseModel):
    corp_code: str
    items: list[AnnualReport]
    checked_at: datetime
    search_start: str
    search_end: str


def download_reports(key: str, corp_code: str, end: str) -> tuple[list[dict], list[bytes]]:
    reports: dict[str, AnnualReport] = {}
    originals = []
    page = 1
    total_pages = None
    total_count = None
    while True:
        params = urllib.parse.urlencode(
            {
                "crtfc_key": key,
                "corp_code": corp_code,
                "bgn_de": SEARCH_START,
                "end_de": end,
                "last_reprt_at": "Y",
                "pblntf_detail_ty": "A001",
                "sort": "date",
                "sort_mth": "desc",
                "page_no": page,
                "page_count": 100,
            }
        )
        try:
            with urllib.request.urlopen(
                f"https://opendart.fss.or.kr/api/list.json?{params}", timeout=30
            ) as response:
                raw = response.read(4 * 1024 * 1024 + 1)
            if len(raw) > 4 * 1024 * 1024:
                raise ValueError("oversized response")
            payload = json.loads(raw)
            if payload.get("status") == "013" and page == 1:
                return [], [raw]
            if payload.get("status") != "000":
                raise CatalogUnavailable(
                    "dart_reports_rate_limited"
                    if payload.get("status") == "020"
                    else "dart_reports_unavailable"
                )
            pages = int(payload["total_page"])
            count = int(payload["total_count"])
            if not 1 <= pages <= 99999 or int(payload["page_no"]) != page:
                raise ValueError("invalid pagination")
            if total_pages is not None and (total_pages != pages or total_count != count):
                raise ValueError("list changed during fetch")
            total_pages = pages
            total_count = count
            entries = payload["list"]
            if not isinstance(entries, list) or not entries or len(entries) > 100:
                raise ValueError("invalid list")
            for row in entries:
                if row["corp_code"] != corp_code:
                    raise ValueError("company mismatch")
                # The period in the report title is the fiscal period, not its filing year.
                match = re.search(r"사업보고서\s*\((\d{4})\.(0[1-9]|1[0-2])\)", row["report_nm"])
                if match is None:
                    raise ValueError("unknown annual report period")
                receipt_date = datetime.strptime(row["rcept_dt"], "%Y%m%d").date().isoformat()
                report = AnnualReport(
                    receipt_no=row["rcept_no"],
                    report_name=row["report_nm"],
                    fiscal_year=match[1],
                    period=f"{match[1]}.{match[2]}",
                    receipt_date=receipt_date,
                    withdrawn="철" in row.get("rm", ""),
                )
                if report.receipt_no in reports:
                    raise ValueError("duplicate receipt")
                reports[report.receipt_no] = report
            originals.append(raw)
        except CatalogUnavailable:
            raise
        except (
            urllib.error.URLError,
            OSError,
            TimeoutError,
            ValueError,
            KeyError,
            TypeError,
            AttributeError,
        ):
            # Do not expose exceptions: they can include the URL containing the API key.
            raise CatalogUnavailable("dart_reports_unavailable") from None
        if page == total_pages:
            break
        page += 1
    if len(reports) != total_count:
        raise CatalogUnavailable("dart_reports_unavailable")
    items = sorted(reports.values(), key=lambda item: (item.period, item.receipt_no), reverse=True)
    return [item.model_dump() for item in items], originals


class ReportRepository:
    def __init__(self, database: Database, settings: Settings):
        self.database = database
        self.settings = settings
        self.originals = LocalArtifactStore(settings.artifact_root / "company/reports/originals")

    async def get(self, corp_code: str) -> AnnualReports:
        async with self.database.transaction() as session:
            # Serialize only requests for the same company, including across API processes.
            await session.execute(
                text("SELECT pg_advisory_xact_lock(736421, :code)"), {"code": int(corp_code)}
            )
            company = await session.get(CompanyRecord, corp_code)
            if company is None or not company.active:
                raise LookupError("company_not_found")
            cached = await session.get(CompanyReportCatalog, corp_code)
            now = datetime.now(UTC)
            if cached and now - cached.checked_at < timedelta(
                seconds=self.settings.company_reports_cache_seconds
            ):
                return AnnualReports.model_validate(cached, from_attributes=True)
            if not self.settings.open_dart_api_key:
                raise CatalogUnavailable("dart_api_key_missing")
            end = now.astimezone(timezone(timedelta(hours=9))).strftime("%Y%m%d")
            items, originals = await asyncio.to_thread(
                download_reports, self.settings.open_dart_api_key.get_secret_value(), corp_code, end
            )
            hashes = await asyncio.to_thread(lambda: [self.originals.put(raw) for raw in originals])
            values = dict(
                items=items,
                checked_at=datetime.now(UTC),
                search_start=SEARCH_START,
                search_end=end,
                source_hashes=hashes,
            )
            if cached:
                for key, value in values.items():
                    setattr(cached, key, value)
            else:
                cached = CompanyReportCatalog(corp_code=corp_code, **values)
                session.add(cached)
            result = AnnualReports.model_validate(cached, from_attributes=True)
        return result
