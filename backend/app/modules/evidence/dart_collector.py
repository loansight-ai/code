"""Preserve official ZIP/XML and independently fetched DART viewer HTML without JS evaluation."""

import io
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from zipfile import BadZipFile, ZipFile

from lxml import html

from app.core.storage import LocalArtifactStore

COLLECTOR_VERSION = "dart-viewer-v1"


class CollectionError(Exception):
    def __init__(self, code: str, retryable: bool = False):
        self.code, self.retryable = code, retryable
        super().__init__(code)


def fetch(url: str, maximum: int) -> bytes:
    try:
        with urllib.request.urlopen(url, timeout=30) as response:
            target = urllib.parse.urlparse(response.geturl())
            if target.scheme != "https" or target.hostname not in {
                "opendart.fss.or.kr",
                "dart.fss.or.kr",
            }:
                raise CollectionError("dart_unexpected_redirect")
            data = response.read(maximum + 1)
        if len(data) > maximum or not data:
            raise CollectionError("dart_source_size_invalid")
        return data
    except (urllib.error.URLError, OSError, TimeoutError):
        # urllib errors can contain credentials from the request URL.
        raise CollectionError("dart_download_failed", True) from None


def decode_html(data: bytes) -> tuple[str, str]:
    for encoding in ("utf-8", "euc-kr"):
        try:
            content = data.decode(encoding)
            if "<html" in content.lower() and "<body" in content.lower():
                return content, encoding
        except UnicodeError:
            pass
    raise CollectionError("dart_html_invalid")


def find_note_locators(source: bytes, receipt_no: str) -> dict:
    content, _ = decode_html(source)
    scripts = "\n".join(html.fromstring(content).xpath("//script/text()"))
    found: dict[str, list] = {"CFS": [], "OFS": []}
    # Each node starts with a fresh object. Never execute downloaded JavaScript.
    blocks = re.split(r"var\s+(node\d+)\s*=\s*\{\s*\}\s*;", scripts)
    for index in range(1, len(blocks), 2):
        name, block = blocks[index], blocks[index + 1]
        values = {}
        for key, value in re.findall(
            re.escape(name)
            + r"\['(text|rcpNo|dcmNo|eleId|offset|length|dtd)'\]\s*=\s*(\"(?:[^\"\\]|\\.)*\")\s*;",
            block,
        ):
            values[key] = json.loads(value)
        title = re.sub(r"^[\d.\s]+", "", values.get("text", ""))
        title = "".join(title.split())
        scope = (
            "CFS"
            if title == "연결재무제표주석"
            else "OFS"
            if title in {"재무제표주석", "별도재무제표주석"}
            else None
        )
        if scope is None:
            continue
        if (
            values.get("rcpNo") != receipt_no
            or any(
                not re.fullmatch(r"[0-9]{1,16}", values.get(key, ""))
                for key in ("dcmNo", "eleId", "offset", "length")
            )
            or not re.fullmatch(r"[a-zA-Z0-9_-]{1,40}\.(xsd|dtd)", values.get("dtd", ""))
        ):
            raise CollectionError("dart_note_locator_invalid")
        found[scope].append(values)
    if any(len(items) > 1 for items in found.values()):
        raise CollectionError("dart_note_locator_ambiguous")
    return {scope: items[0] for scope, items in found.items() if items}


def viewer_url(locator: dict) -> str:
    return "https://dart.fss.or.kr/report/viewer.do?" + urllib.parse.urlencode(
        {key: locator[key] for key in ("rcpNo", "dcmNo", "eleId", "offset", "length", "dtd")}
    )


def collect_document(store: LocalArtifactStore, key: str, receipt_no: str, max_bytes: int) -> dict:
    archive = fetch(
        "https://opendart.fss.or.kr/api/document.xml?"
        + urllib.parse.urlencode(
            {
                "crtfc_key": key,
                "rcept_no": receipt_no,
            }
        ),
        max_bytes,
    )
    manifest = []
    try:
        with ZipFile(io.BytesIO(archive)) as zipped:
            entries = zipped.infolist()
            if len(entries) > 1000 or sum(item.file_size for item in entries) > max_bytes * 10:
                raise CollectionError("dart_archive_invalid")
            names = set()
            for info in entries:
                if info.is_dir():
                    continue
                # Names are metadata only: never extract archive-controlled paths to disk.
                if info.filename in names:
                    raise CollectionError("dart_archive_invalid")
                names.add(info.filename)
                if info.filename.lower().endswith(".xml"):
                    content = zipped.read(info)
                    manifest.append(
                        {
                            "name": info.filename,
                            "sha256": store.put(content),
                            "byte_length": len(content),
                        }
                    )
    except (BadZipFile, RuntimeError, OSError, ValueError):
        raise CollectionError("dart_archive_invalid") from None
    if not manifest:
        raise CollectionError("dart_archive_invalid")
    toc = fetch(f"https://dart.fss.or.kr/dsaf001/main.do?rcpNo={receipt_no}", max_bytes)
    locators = find_note_locators(toc, receipt_no)
    return {
        "archive_sha256": store.put(archive),
        "archive_bytes": len(archive),
        "xml_files": manifest,
        "toc_sha256": store.put(toc),
        "locators": locators,
    }


def collect_note(store: LocalArtifactStore, locator: dict, maximum: int) -> dict:
    source = fetch(viewer_url(locator), maximum)
    text, encoding = decode_html(source)
    document = html.fromstring(text)
    for element in document.xpath("//script|//style"):
        element.drop_tree()
    normalized = "".join(document.text_content().split())
    heading = "".join(locator["text"].split())
    if heading not in normalized or not document.xpath("//table") or len(normalized) < 100:
        raise CollectionError("dart_note_html_invalid")
    return {
        "sha256": store.put(source),
        "byte_length": len(source),
        "encoding": encoding,
        "locator": locator,
        "collector_version": COLLECTOR_VERSION,
    }
