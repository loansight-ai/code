"""Official full-statement API with receipt validation and secret-safe errors."""

import json
import urllib.error
import urllib.parse
import urllib.request

from app.modules.evidence.dart_collector import CollectionError

MAX_BYTES = 8 * 1024 * 1024
ENDPOINT = "https://opendart.fss.or.kr/api/fnlttSinglAcntAll.json"


def download(key: str, context: dict) -> bytes:
    params = urllib.parse.urlencode(
        {
            "crtfc_key": key,
            "corp_code": context["corp_code"],
            "bsns_year": context["fiscal_year"],
            "reprt_code": "11011",
            "fs_div": context["scope"],
        }
    )
    try:
        with urllib.request.urlopen(f"{ENDPOINT}?{params}", timeout=30) as response:
            raw = response.read(MAX_BYTES + 1)
        if len(raw) > MAX_BYTES:
            raise CollectionError("financial_response_invalid")
        return raw
    except (urllib.error.URLError, TimeoutError, OSError):
        raise CollectionError("financial_download_failed", retryable=True) from None


def parse_response(raw: bytes, context: dict) -> list[dict]:
    try:
        data = json.loads(raw)
        if not isinstance(data, dict):
            raise ValueError()
        status = data.get("status")
        if status == "013":
            return []
        if status != "000":
            raise CollectionError(
                "financial_rate_limited" if status == "020" else "financial_api_error",
                retryable=status in ("020", "800", "900"),
            )
        rows = data["list"]
        if not isinstance(rows, list) or not rows or len(rows) > 20000:
            raise ValueError()
        for row in rows:
            if not isinstance(row, dict):
                raise ValueError()
            if row.get("corp_code") != context["corp_code"]:
                raise CollectionError("financial_company_mismatch")
            # The API takes fiscal year, not historical receipt. Never silently
            # replace a selected filing with a newer correction.
            if row.get("rcept_no") != context["receipt_no"]:
                raise CollectionError("financial_receipt_mismatch")
            if (
                str(row.get("bsns_year")) != context["fiscal_year"]
                or row.get("reprt_code") != "11011"
            ):
                raise ValueError()
            if row.get("fs_div", context["scope"]) != context["scope"]:
                raise ValueError()
            if not all(
                isinstance(row.get(k, ""), str) for k in ("account_id", "account_nm", "sj_div")
            ):
                raise ValueError()
        return rows
    except (ValueError, KeyError, TypeError, AttributeError, UnicodeError):
        raise CollectionError("financial_response_invalid") from None
