"""Preserve stored JSON coordinates; no invented HTML, scope or validation."""

import json
from uuid import uuid5

from app.modules.evidence.dump_archive import digest


def segments(report_id, table, row):
    key = row.get("id") or row["rcept_no"]
    title = row.get("note_title") or row.get("path") or row.get("title") or "감사의견·계속기업"
    region = {"note_section": "notes", "doc_section": "business_report", "audit_opinion": "audit"}[
        table
    ]
    scope = "OFS" if table == "note_section" else "COMMON" if table == "doc_section" else "UNKNOWN"
    # Only an exact original scope token is accepted; free text is retained for review.
    if table == "audit_opinion" and row.get("fs") in {"OFS", "CFS"}:
        scope = row["fs"]
    body = row.get("body") or ""
    if table == "audit_opinion":
        body = "\n".join(f"{k}: {v}" for k, v in row.items() if v is not None)
    tables = json.loads(row["tables"]) if row.get("tables") else []
    if not isinstance(tables, list):
        raise ValueError("invalid_dump_tables")
    base = {
        "report_id": report_id,
        "region": region,
        "scope": scope,
        "title": title,
        "ordinal": int(row.get("seq") or 0) * 1000,
        "location": {"table": table, "row_id": key, "source": row.get("source")},
        "data": {
            "body_skipped": row.get("body_skipped") == "t",
            "original_scope": row.get("fs_div") or row.get("fs"),
            "raw": row,
            "review_status": "PENDING",
        },
    }
    yield {
        **base,
        "id": uuid5(report_id, f"{table}:{key}:body"),
        "kind": "text",
        "text": body,
        "sha256": digest({"text": body, "location": base["location"]}),
    }
    for index, value in enumerate(tables):
        if not isinstance(value, dict) or not isinstance(value.get("cells"), list):
            raise ValueError("invalid_dump_cells")
        cells = value["cells"]
        if any(not isinstance(r, list) or any(not isinstance(c, str) for c in r) for r in cells):
            raise ValueError("invalid_dump_cells")
        text = "\n".join(
            [
                str(value.get("caption") or ""),
                str(value.get("unit") or ""),
                *(" | ".join(r) for r in cells),
            ]
        )
        yield {
            **base,
            "id": uuid5(report_id, f"{table}:{key}:table:{index}"),
            "kind": "table",
            "ordinal": base["ordinal"] + index + 1,
            "location": {**base["location"], "table_index": index, "table_seq": value.get("seq")},
            "data": {
                "table": value,
                "body_skipped": False,
                "review_status": "PENDING",
                "column_mapping_verified": False,
                "span_information_available": False,
            },
            "text": text,
            "sha256": digest(value),
        }
