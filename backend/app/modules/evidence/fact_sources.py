"""Full internal source reads for validation; bounded pages for human review."""


from fastapi import HTTPException
from lxml import html
from sqlalchemy import select

from app.modules.evidence.bundle_models import EvidenceSegment
from app.modules.evidence.models import SourceSegment
from app.modules.financial.notes import table_grid


async def resolve(tools, segment_id):
    row = (
        await tools.db.scalar(
            select(EvidenceSegment).where(*tools.conditions(), EvidenceSegment.id == segment_id)
        )
        if tools.bundle.report_id
        else None
    )
    if row:
        table = row.data.get("table") or {}
        return {
            "segment_id": str(row.id),
            "origin": "dump",
            "revision": str(row.report_id),
            "sha256": row.sha256,
            "scope": row.scope,
            "text": row.text,
            "title": row.title,
            "location": row.location,
            "cells": table.get("cells"),
            "source_url": None,
            "unit": table.get("unit"),
            "content_available": bool(row.text.strip()),
        }
    for reader in tools.html:
        row = await tools.db.scalar(
            select(SourceSegment).where(
                SourceSegment.structure_id == reader.revision.id, SourceSegment.id == segment_id
            )
        )
        if row:
            raw = (row.table_data or {}).get("raw_table_html")
            grid = table_grid(html.fromstring(raw)) if raw else []
            return {
                "segment_id": str(row.id),
                "origin": "html",
                "revision": str(reader.revision.id),
                "sha256": reader.artifact.sha256,
                "scope": tools.bundle.scope,
                "text": row.text,
                "title": " / ".join(
                    n["title"] for n in reader.nodes.values() if n["id"] == row.owner_node_id
                ),
                "location": {"xpath": row.source_xpath},
                "cells": [
                    [c.text_content() if c is not None else "" for c in cells] for _, cells in grid
                ]
                or None,
                "source_url": f"/notes/{reader.revision.id}?segment={row.id}",
                "unit": None,
                "content_available": bool(row.text.strip()),
            }
    raise HTTPException(422, "fact_source_outside_bundle")


def page(source, row=0, text_offset=0):
    cells = source["cells"]
    return {
        **{k: v for k, v in source.items() if k not in {"text", "cells"}},
        "text": source["text"][text_offset : text_offset + 4000],
        "text_offset": text_offset,
        "next_text_offset": text_offset + 4000
        if text_offset + 4000 < len(source["text"])
        else None,
        "cells": [[c[:1000] for c in r[:40]] for r in cells[row : row + 20]] if cells else None,
        "row_offset": row,
        "next_row_offset": row + 20 if cells and row + 20 < len(cells) else None,
        "truncated_cells": bool(
            cells
            and any(len(r) > 40 or any(len(c) > 1000 for c in r) for r in cells[row : row + 20])
        ),
    }
