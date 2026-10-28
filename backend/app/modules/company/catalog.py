"""OpenDART company master. Refresh explicitly; never guess industry or market."""

import argparse
import io
import re
import threading
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path
from tempfile import NamedTemporaryFile
from zipfile import BadZipFile, ZipFile

from pydantic import BaseModel

from app.core.config import Settings

MAX_ZIP_BYTES = 30 * 1024 * 1024
MAX_XML_BYTES = 100 * 1024 * 1024


class CatalogUnavailable(Exception):
    pass


class Company(BaseModel):
    corp_code: str
    corp_name: str
    corp_eng_name: str | None
    stock_code: str | None
    modify_date: str


def parse_archive(data: bytes) -> list[Company]:
    try:
        with ZipFile(io.BytesIO(data)) as archive:
            info = archive.getinfo("CORPCODE.xml")
            if info.file_size > MAX_XML_BYTES:
                raise CatalogUnavailable("dart_catalog_invalid")
            xml = archive.read(info)
        # No DTD/entity declarations are needed in the official master.
        if b"<!DOCTYPE" in xml.upper() or b"<!ENTITY" in xml.upper():
            raise CatalogUnavailable("dart_catalog_invalid")
        root = ET.fromstring(xml)
        if root.tag != "result":
            raise CatalogUnavailable("dart_catalog_invalid")
        companies = []
        seen = set()
        for row in root.findall("list"):
            code = (row.findtext("corp_code") or "").strip()
            name = (row.findtext("corp_name") or "").strip()
            stock = (row.findtext("stock_code") or "").strip()
            modified = (row.findtext("modify_date") or "").strip()
            if (
                not re.fullmatch(r"[0-9]{8}", code)
                or not name
                or code in seen
                or (stock and not re.fullmatch(r"[0-9A-Z]{6}", stock))
                or not re.fullmatch(r"[0-9]{8}", modified)
            ):
                raise CatalogUnavailable("dart_catalog_invalid")
            seen.add(code)
            companies.append(
                Company(
                    corp_code=code,
                    corp_name=name,
                    corp_eng_name=(row.findtext("corp_eng_name") or "").strip() or None,
                    stock_code=stock or None,
                    modify_date=modified,
                )
            )
        if not companies:
            raise CatalogUnavailable("dart_catalog_invalid")
        return sorted(companies, key=lambda item: (item.corp_name, item.corp_code))
    except (BadZipFile, KeyError, ET.ParseError, RuntimeError, OSError, ValueError):
        raise CatalogUnavailable("dart_catalog_invalid") from None


def download_archive(key: str) -> bytes:
    query = urllib.parse.urlencode({"crtfc_key": key})
    try:
        with urllib.request.urlopen(
            f"https://opendart.fss.or.kr/api/corpCode.xml?{query}", timeout=30
        ) as response:
            data = response.read(MAX_ZIP_BYTES + 1)
        if len(data) > MAX_ZIP_BYTES:
            raise CatalogUnavailable("dart_catalog_invalid")
        return data
    except (urllib.error.URLError, TimeoutError, OSError):
        # urllib exceptions can contain the URL and API key. Never expose them.
        raise CatalogUnavailable("dart_download_failed") from None


class CompanyCatalog:
    def __init__(self, settings: Settings):
        self.path = settings.artifact_root / "company" / "CORPCODE.zip"
        self.key = settings.open_dart_api_key
        self._lock = threading.Lock()
        self._companies: list[Company] | None = None
        self._cache_stamp: int | None = None

    def load(self, *, refresh: bool = False) -> list[Company]:
        with self._lock:
            try:
                stamp = self.path.stat().st_mtime_ns if self.path.exists() else None
            except OSError:
                raise CatalogUnavailable("dart_cache_unavailable") from None
            if not refresh and self._companies is not None and stamp == self._cache_stamp:
                return self._companies
            if not refresh and self.path.exists():
                try:
                    companies = parse_archive(self.path.read_bytes())
                except OSError:
                    raise CatalogUnavailable("dart_cache_unavailable") from None
            else:
                if not self.key:
                    raise CatalogUnavailable("dart_api_key_missing")
                data = download_archive(self.key.get_secret_value())
                companies = parse_archive(data)
                temporary: Path | None = None
                try:
                    self.path.parent.mkdir(parents=True, exist_ok=True)
                    with NamedTemporaryFile(dir=self.path.parent, delete=False) as output:
                        temporary = Path(output.name)
                        output.write(data)
                    temporary.replace(self.path)
                except OSError:
                    raise CatalogUnavailable("dart_cache_unavailable") from None
                finally:
                    if temporary is not None:
                        temporary.unlink(missing_ok=True)
            self._companies = companies
            self._cache_stamp = self.path.stat().st_mtime_ns
            return companies

    def search(self, query: str, offset: int, limit: int) -> dict:
        needle = "".join(query.split()).casefold()
        companies = self.load()
        matches = [
            company
            for company in companies
            if not needle
            or any(
                needle in "".join(value.split()).casefold()
                for value in (
                    company.corp_name,
                    company.corp_eng_name or "",
                    company.corp_code,
                    company.stock_code or "",
                )
            )
        ]
        # Exact code/name matches precede partial matches; ties stay deterministic.
        if needle:
            matches.sort(
                key=lambda company: (
                    needle
                    not in (
                        "".join(company.corp_name.split()).casefold(),
                        company.corp_code,
                        company.stock_code,
                    )
                )
            )
        return {
            "items": matches[offset : offset + limit],
            "total": len(matches),
            "offset": offset,
            "limit": limit,
        }


def main() -> None:
    parser = argparse.ArgumentParser(description="Download/cache the OpenDART company master")
    parser.add_argument("--refresh", action="store_true", help="Replace cache after validation")
    args = parser.parse_args()
    catalog = CompanyCatalog(Settings())
    try:
        companies = catalog.load(refresh=args.refresh)
    except CatalogUnavailable as exc:
        parser.exit(1, f"{exc}\n")
    print(f"companies={len(companies)} cache={catalog.path}")


if __name__ == "__main__":
    main()
