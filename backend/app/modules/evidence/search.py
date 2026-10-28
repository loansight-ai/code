"""Bounded, owner-scoped keyword tools. No raw HTML or model decisions are returned."""

import asyncio
import re

from fastapi import HTTPException
from lxml import html
from sqlalchemy import Text, and_, case, cast, column, func, or_, select
from sqlalchemy.dialects.postgresql import JSONPATH

from app.modules.evidence import service
from app.modules.evidence.models import SourceSegment
from app.modules.evidence.search_schemas import Citation, ContextQuery, SearchQuery, SectionsQuery

TOOL_VERSION = "note-keyword-v1"
EXCERPT_CHARS = 600
CONTEXT_CHARS = 4000


def normalize(value: str) -> str:
    return re.sub(r"\s+", "", value).lower()


def node_path(nodes: dict, owner: str) -> list[dict]:
    path, seen = [], set()
    while owner in nodes and owner not in seen:
        seen.add(owner)
        node = nodes[owner]
        path.append({"id": owner, "title": node["title"], "parent_id": node.get("parent_id")})
        owner = node.get("parent_id")
    return list(reversed(path))


def excerpt(text: str, terms: list[str], maximum=EXCERPT_CHARS) -> dict:
    # The returned quote is always an exact substring of the stored text.
    positions = []
    for term in terms:
        pattern = r"\s*".join(re.escape(char) for char in re.sub(r"\s+", "", term))
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            positions.append(match.start())
    start = max(0, min(positions, default=0) - 100)
    end = min(len(text), start + maximum)
    return {
        "text": text[start:end],
        "start": start,
        "end": end,
        "truncated": start > 0 or end < len(text),
    }


def table_context(data: dict, query: ContextQuery):
    raw = data.get("raw_table_html") or "<table></table>"
    document = html.fromstring(raw)
    # Rowspan/colspan remain explicit; we do not claim a flattened cell grid.
    table_rows = document.xpath(".//tr")
    selected = table_rows[query.row_offset : query.row_offset + query.row_limit]
    encoded = [
        [
            {
                "text": excerpt(cell.text_content(), [], 1000),
                "colspan": cell.get("colspan", "1"),
                "rowspan": cell.get("rowspan", "1"),
                "is_header": cell.tag.lower() == "th",
            }
            for cell in row.xpath("./th|./td")[:40]
        ]
        for row in selected
    ]
    table = {
        "title": data.get("display_title"),
        "context_status": data.get("context_status"),
        "review_flags": data.get("review_flags", []),
        "context_blocks": [
            {
                "text": excerpt(b.get("text", ""), [], 1000),
                "local_id": b.get("block_id"),
                "role_inferred": b.get("role_inferred"),
            }
            for b in data.get("context_blocks", [])[:12]
        ],
        "rows": encoded,
        "total_rows": len(table_rows),
        "row_offset": query.row_offset,
        "header_rows": [
            [cell.text_content()[:1000] for cell in row.xpath("./th")[:40]]
            for row in table_rows
            if row.xpath("./th")
        ][:3],
        "leading_rows": [
            [excerpt(cell.text_content(), [], 1000) for cell in row.xpath("./th|./td")[:40]]
            for row in table_rows[:3]
        ],
        "header_inference": "explicit_th_only",
        "next_row_offset": query.row_offset + len(selected)
        if query.row_offset + len(selected) < len(table_rows)
        else None,
        "cells_truncated": any(len(row.xpath("./th|./td")) > 40 for row in selected),
        "context_truncated": len(data.get("context_blocks", [])) > 12,
        "column_mapping_verified": False,
    }
    return table


class NoteSearchTools:
    """Create only after authenticated owned_structure; bind one immutable revision."""

    def __init__(self, db, revision, artifact):
        self.db, self.revision, self.artifact = db, revision, artifact
        if revision.hierarchy is None:
            raise HTTPException(409, "note_structure_not_ready")
        self.nodes = {node["id"]: node for node in revision.hierarchy.get("nodes", [])}

    @classmethod
    async def owned(cls, db, identity, structure_id):
        revision, artifact, _ = await service.owned_structure(db, identity, structure_id)
        return cls(db, revision, artifact)

    @staticmethod
    def definitions():
        return [
            {"name": name, "description": description, "parameters": schema.model_json_schema()}
            for name, schema, description in (
                ("list_note_sections", SectionsQuery, "고정된 문서의 목차와 직속 구간 수 조회"),
                (
                    "search_note_segments",
                    SearchQuery,
                    "고정된 문서의 문단·표·목차 키워드 검색. 위험 판정 아님",
                ),
                ("read_note_context", ContextQuery, "구간의 앞뒤 문단·표 행과 원문 위치 조회"),
            )
        ]

    async def call(self, name: str, arguments: dict):
        tools = {
            "list_note_sections": (SectionsQuery, self.list_note_sections),
            "search_note_segments": (SearchQuery, self.search_note_segments),
            "read_note_context": (ContextQuery, self.read_note_context),
        }
        if name not in tools:
            raise ValueError("unknown_note_search_tool")
        schema, handler = tools[name]
        return await handler(schema.model_validate(arguments))

    def provenance(self):
        return {
            "structure_id": str(self.revision.id),
            "source_sha256": self.artifact.sha256,
            "corp_code": self.artifact.corp_code,
            "receipt_no": self.artifact.receipt_no,
            "scope": self.artifact.scope,
            "period": self.artifact.period,
            "tool_version": TOOL_VERSION,
            "evidence_verified": False,
            "input_origin": "dart_viewer_note_html"
            if self.artifact.dart_note_id
            else "user_provided_note_html",
        }

    def check_node(self, node_id):
        if node_id is not None and node_id not in self.nodes:
            raise HTTPException(404, "note_node_not_found")

    def candidate(self, row, terms):
        path = node_path(self.nodes, row.owner_node_id)
        table = row.table_data or {}
        fields = {
            "text": row.text,
            "section": " / ".join(n["title"] for n in path),
            "table_title": table.get("display_title") or "",
            "table_context": " ".join(b.get("text", "") for b in table.get("context_blocks", [])),
        }
        matches = [
            {
                "term": term,
                "fields": [
                    name for name, value in fields.items() if normalize(term) in normalize(value)
                ],
            }
            for term in terms
        ]
        return {
            "segment_id": str(row.id),
            "ordinal": row.ordinal,
            "kind": row.kind,
            "owner_node_id": row.owner_node_id,
            "section_path": path,
            "excerpt": excerpt(row.text, terms),
            "matches": [m for m in matches if m["fields"]],
            "source_url": f"/notes/{self.revision.id}?segment={row.id}",
            "table_title": table.get("display_title"),
            "structure_review_flags": self.nodes.get(row.owner_node_id, {}).get("review_flags", []),
        }

    async def list_note_sections(self, query: SectionsQuery):
        self.check_node(query.parent_id)
        counts = dict(
            (
                await self.db.execute(
                    select(SourceSegment.owner_node_id, func.count())
                    .where(SourceSegment.structure_id == self.revision.id)
                    .group_by(SourceSegment.owner_node_id)
                )
            ).all()
        )
        nodes = [
            n
            for n in self.nodes.values()
            if query.parent_id is None or n.get("parent_id") == query.parent_id
        ]
        selected = nodes[query.offset : query.offset + query.limit]
        next_offset = query.offset + len(selected)
        return {
            **self.provenance(),
            "sections": [
                {
                    "id": n["id"],
                    "title": n["title"],
                    "parent_id": n.get("parent_id"),
                    "status": n.get("status"),
                    "review_flags": n.get("review_flags", []),
                    "direct_segment_count": counts.get(n["id"], 0),
                }
                for n in selected
            ],
            "total": len(nodes),
            "next_offset": next_offset if next_offset < len(nodes) else None,
        }

    async def search_note_segments(self, query: SearchQuery):
        self.check_node(query.node_id)
        # SQL filters and limits run before segment objects are materialized.
        section = case(
            {key: " / ".join(n["title"] for n in node_path(self.nodes, key)) for key in self.nodes},
            value=SourceSegment.owner_node_id,
            else_="",
        )
        context_strings = (
            func.jsonb_array_elements_text(
                func.jsonb_path_query_array(
                    SourceSegment.table_data, cast("$.context_blocks[*].text", JSONPATH)
                )
            )
            .table_valued(column("value", Text))
            .alias("table_context")
        )
        context_text = (
            select(func.string_agg(context_strings.c.value, " "))
            .select_from(context_strings)
            .correlate(SourceSegment)
            .scalar_subquery()
        )
        fields = [
            SourceSegment.text,
            section,
            SourceSegment.table_data["display_title"].astext,
            context_text,
        ]
        normalized = [
            func.lower(func.regexp_replace(func.coalesce(field, ""), r"\s+", "", "g"))
            for field in fields
        ]
        term_matches = [
            or_(*(field.contains(normalize(term), autoescape=True) for field in normalized))
            for term in query.terms
        ]
        conditions = [
            SourceSegment.structure_id == self.revision.id,
            (or_ if query.mode == "ANY" else and_)(*term_matches),
        ]
        if query.kind:
            conditions.append(
                SourceSegment.kind == "table"
                if query.kind == "table"
                else SourceSegment.kind != "table"
            )
        if query.node_id and query.node_id != "root":
            descendants = {query.node_id}
            while True:
                children = {
                    key for key, n in self.nodes.items() if n.get("parent_id") in descendants
                }
                if children <= descendants:
                    break
                descendants |= children
            conditions.append(SourceSegment.owner_node_id.in_(descendants))
        matched_count = sum(case((match, 1), else_=0) for match in term_matches)
        title_match = or_(
            *(normalized[1].contains(normalize(term), autoescape=True) for term in query.terms)
        )
        total = await self.db.scalar(
            select(func.count()).select_from(SourceSegment).where(*conditions)
        )
        rows = list(
            (
                await self.db.scalars(
                    select(SourceSegment)
                    .where(*conditions)
                    .order_by(matched_count.desc(), title_match.desc(), SourceSegment.ordinal)
                    .offset(query.offset)
                    .limit(query.limit)
                )
            ).all()
        )
        next_offset = query.offset + len(rows)
        return {
            **self.provenance(),
            "query": query.model_dump(),
            "total": total,
            "candidates": [self.candidate(row, query.terms) for row in rows],
            "next_offset": next_offset if next_offset < total else None,
            "truncated": next_offset < total,
            "ranking": "matched_terms_then_section_then_order",
        }

    async def read_note_context(self, query: ContextQuery):
        target = await self.db.scalar(
            select(SourceSegment).where(
                SourceSegment.structure_id == self.revision.id, SourceSegment.id == query.segment_id
            )
        )
        if target is None:
            raise HTTPException(404, "source_segment_not_found")
        rows = list(
            (
                await self.db.scalars(
                    select(SourceSegment)
                    .where(
                        SourceSegment.structure_id == self.revision.id,
                        SourceSegment.ordinal.between(
                            target.ordinal - query.before, target.ordinal + query.after
                        ),
                    )
                    .order_by(SourceSegment.ordinal)
                )
            ).all()
        )
        items = [
            {
                **self.candidate(row, []),
                "excerpt": excerpt(row.text, [], CONTEXT_CHARS),
                "crosses_section_boundary": row.owner_node_id != target.owner_node_id,
            }
            for row in rows
        ]
        start = min(query.text_offset, len(target.text))
        end = min(start + CONTEXT_CHARS, len(target.text))
        for item in items:
            if item["segment_id"] == str(target.id):
                item["excerpt"] = {
                    "text": target.text[start:end],
                    "start": start,
                    "end": end,
                    "truncated": start > 0 or end < len(target.text),
                }
        table = None
        if target.table_data:
            table = await asyncio.to_thread(table_context, target.table_data, query)
            local_ids = [b["local_id"] for b in table["context_blocks"] if b["local_id"]]
            context_ids = (
                dict(
                    (
                        await self.db.execute(
                            select(SourceSegment.local_id, SourceSegment.id).where(
                                SourceSegment.structure_id == self.revision.id,
                                SourceSegment.local_id.in_(local_ids),
                            )
                        )
                    ).all()
                )
                if local_ids
                else {}
            )
            for block in table["context_blocks"]:
                segment_id = context_ids.get(block["local_id"])
                block["source_segment_id"] = str(segment_id) if segment_id else None
        return {
            **self.provenance(),
            "segment_id": str(target.id),
            "segments": items,
            "table": table,
            "window": {"before": query.before, "after": query.after},
            "document_segment_count": self.revision.segment_count,
            "next_text_offset": end if end < len(target.text) else None,
        }

    async def validate_citations(self, citations: list[Citation]):
        if not citations or len(citations) > 30:
            raise HTTPException(422, "citation_count_out_of_range")
        rows = (
            await self.db.scalars(
                select(SourceSegment).where(
                    SourceSegment.structure_id == self.revision.id,
                    SourceSegment.id.in_([c.segment_id for c in citations]),
                )
            )
        ).all()
        texts = {row.id: row.text for row in rows}
        if any(
            not c.quote.strip() or c.quote not in texts.get(c.segment_id, "") for c in citations
        ):
            raise HTTPException(422, "citation_source_mismatch")
        return {**self.provenance(), "citations_valid": True, "semantic_verification": False}
