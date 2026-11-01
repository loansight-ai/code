"""Source-specific readers behind the existing bounded note-tool interface."""

from typing import Literal
from uuid import UUID

from fastapi import HTTPException
from pydantic import Field
from sqlalchemy import and_, func, or_, select

from app.modules.evidence import bundles
from app.modules.evidence.bundle_models import EvidenceDataset, EvidenceReport, EvidenceSegment
from app.modules.evidence.search import NoteSearchTools, excerpt, normalize
from app.modules.evidence.search_baseline import CATEGORIES, DICTIONARY_VERSION
from app.modules.evidence.search_schemas import ContextQuery, SearchQuery, SectionsQuery


class BundleSearchQuery(SearchQuery):
    node_id: str | None = Field(default=None, max_length=100)
    origin: Literal["html", "dump"] | None = None


class BundleTools:
    @staticmethod
    def definitions():
        tools = NoteSearchTools.definitions()
        for tool in tools:
            if tool["name"] == "search_note_segments":
                tool["parameters"] = BundleSearchQuery.model_json_schema()
        return tools

    def __init__(self, db, bundle, html):
        self.db, self.bundle, self.html = db, bundle, html

    @classmethod
    async def owned(cls, db, identity, bundle_id):
        bundle = await bundles.owned(db, identity, bundle_id)
        html = [
            await NoteSearchTools.owned(db, identity, UUID(s["id"])) for s in bundle.structure_ids
        ]
        return cls(db, bundle, html)

    def provenance(self):
        b = self.bundle
        return {
            "bundle_id": str(b.id),
            "bundle_revision": b.fingerprint,
            "corp_code": b.corp_code,
            "receipt_no": b.receipt_no,
            "scope": b.scope,
            "period": b.period,
            "evidence_verified": False,
            "review_status": "PENDING",
            "tool_version": "bundle-v1",
        }

    def conditions(self):
        return [
            EvidenceSegment.report_id == self.bundle.report_id,
            EvidenceSegment.scope.in_([self.bundle.scope, "COMMON", "UNKNOWN"]),
        ]

    def candidate(self, row, terms):
        return {
            "segment_id": str(row.id),
            "ordinal": row.ordinal,
            "kind": row.kind,
            "owner_node_id": str(row.id),
            "section_path": [{"id": str(row.id), "title": row.title}],
            "excerpt": excerpt(row.text, terms),
            "origin": "dump",
            "region": row.region,
            "scope": row.scope,
            "source_revision": str(row.report_id),
            "sha256": row.sha256,
            "location": row.location,
            "source_url": None,
            "content_available": bool(row.text.strip()),
            "body_skipped": row.data.get("body_skipped", False),
            "table_title": row.title,
            "matches": [
                {"term": t, "fields": ["text"]}
                for t in terms
                if normalize(t) in normalize(row.text)
            ],
            "review_status": "PENDING",
        }

    async def metadata(self):
        sources = [
            {
                "origin": "html",
                "structure_id": str(t.revision.id),
                "sha256": t.artifact.sha256,
                "region": "notes",
            }
            for t in self.html
        ]
        report = (
            await self.db.get(EvidenceReport, self.bundle.report_id)
            if self.bundle.report_id
            else None
        )
        if report:
            dataset = await self.db.get(EvidenceDataset, report.dataset_id)
            sources.append(
                {
                    "origin": "dump",
                    "report_id": str(report.id),
                    "dataset_id": str(dataset.id),
                    "signature": dataset.signature,
                    "archive": dataset.manifest["archive_name"],
                }
            )
        counts = (
            (
                await self.db.execute(
                    select(
                        EvidenceSegment.region,
                        EvidenceSegment.scope,
                        func.count(),
                        func.count().filter(EvidenceSegment.text != ""),
                    )
                    .where(*self.conditions())
                    .group_by(EvidenceSegment.region, EvidenceSegment.scope)
                )
            ).all()
            if report
            else []
        )
        return {
            **self.provenance(),
            "company_name": report.data.get("corp_name") if report else None,
            "sources": sources,
            "coverage": [
                {"region": r, "scope": s, "segments": n, "nonempty": present}
                for r, s, n, present in counts
            ],
            "limitations": [
                "덤프 본문·표는 추출 자료이며 원본 HTML의 병합·XPath 정보가 없습니다.",
                "감사의견의 회계 범위 미확인과 생략 본문은 검수 전입니다.",
            ],
            "model_input_status": "WITHHELD_UNVERIFIED",
            "collection_import_id": str(self.bundle.collection_import_id)
            if self.bundle.collection_import_id
            else None,
            "baseline": self.bundle.baseline,
        }

    async def list_note_sections(self, query):
        # Namespace native nodes by structure to avoid cross-document collisions.
        items = []
        for tools in self.html:
            for node in tools.nodes.values():
                items.append(
                    {
                        "id": f"{tools.revision.id}:{node['id']}",
                        "title": node["title"],
                        "origin": "html",
                        "source_revision": str(tools.revision.id),
                    }
                )
        rows = (
            list(
                (
                    await self.db.scalars(
                        select(EvidenceSegment)
                        .where(*self.conditions(), EvidenceSegment.kind == "text")
                        .order_by(
                            EvidenceSegment.region, EvidenceSegment.ordinal, EvidenceSegment.id
                        )
                    )
                ).all()
            )
            if self.bundle.report_id
            else []
        )
        items.extend(
            {
                "id": str(r.id),
                "title": r.title,
                "origin": "dump",
                "region": r.region,
                "scope": r.scope,
                "body_skipped": r.data.get("body_skipped", False),
            }
            for r in rows
        )
        if query.parent_id:
            raise HTTPException(422, "bundle_sections_are_source_roots")
        end = query.offset + query.limit
        return {
            **self.provenance(),
            "sections": items[query.offset : end],
            "total": len(items),
            "next_offset": end if end < len(items) else None,
        }

    async def search_note_segments(self, query):
        candidates, total, skip = [], 0, query.offset
        node_seen = query.node_id is None
        for tools in self.html:
            if getattr(query, "origin", None) == "dump":
                continue
            node = None
            if query.node_id:
                prefix = str(tools.revision.id) + ":"
                if not query.node_id.startswith(prefix):
                    continue
                node = query.node_id[len(prefix) :]
                tools.check_node(node)
                node_seen = True
            first = await tools.search_note_segments(
                query.model_copy(update={"node_id": node, "offset": 0, "limit": 1})
            )
            count = first["total"]
            total += count
            if skip >= count:
                skip -= count
                continue
            if len(candidates) < query.limit:
                page = await tools.search_note_segments(
                    query.model_copy(
                        update={
                            "node_id": node,
                            "offset": skip,
                            "limit": query.limit - len(candidates),
                        }
                    )
                )
                candidates.extend(
                    {
                        **c,
                        "origin": "html",
                        "region": "notes",
                        "scope": self.bundle.scope,
                        "source_revision": str(tools.revision.id),
                        "sha256": tools.artifact.sha256,
                        "location": {"structure_id": str(tools.revision.id)},
                        "review_status": "PENDING",
                    }
                    for c in page["candidates"]
                )
            skip = 0
        if (
            self.bundle.report_id
            and getattr(query, "origin", None) != "html"
            and (not query.node_id or ":" not in query.node_id)
        ):
            conditions = self.conditions()
            if query.node_id:
                try:
                    node_id = UUID(query.node_id)
                except ValueError:
                    raise HTTPException(404, "note_node_not_found") from None
                owner = await self.db.scalar(
                    select(EvidenceSegment).where(*conditions, EvidenceSegment.id == node_id)
                )
                if owner is None:
                    raise HTTPException(404, "note_node_not_found")
                node_seen = True
                conditions.extend(
                    [
                        EvidenceSegment.location["table"].astext == owner.location["table"],
                        EvidenceSegment.location["row_id"].astext == str(owner.location["row_id"]),
                    ]
                )
            if query.kind:
                conditions.append(EvidenceSegment.kind == query.kind)
            fields = [
                func.lower(func.regexp_replace(f, r"\s+", "", "g"))
                for f in (EvidenceSegment.text, EvidenceSegment.title)
            ]
            conditions.append(
                (or_ if query.mode == "ANY" else and_)(
                    *(
                        or_(*(f.contains(normalize(term), autoescape=True) for f in fields))
                        for term in query.terms
                    )
                )
            )
            count = await self.db.scalar(
                select(func.count()).select_from(EvidenceSegment).where(*conditions)
            )
            total += count
            if len(candidates) < query.limit:
                selected = (
                    await self.db.scalars(
                        select(EvidenceSegment)
                        .where(*conditions)
                        .order_by(
                            EvidenceSegment.region, EvidenceSegment.ordinal, EvidenceSegment.id
                        )
                        .offset(skip)
                        .limit(query.limit - len(candidates))
                    )
                ).all()
                candidates.extend(self.candidate(r, query.terms) for r in selected)
        if not node_seen:
            raise HTTPException(404, "note_node_not_found")
        end = query.offset + len(candidates)
        return {
            **self.provenance(),
            "total": total,
            "candidates": candidates,
            "next_offset": end if end < total else None,
            "truncated": end < total,
        }

    async def read_note_context(self, query):
        row = (
            await self.db.scalar(
                select(EvidenceSegment).where(
                    *self.conditions(), EvidenceSegment.id == query.segment_id
                )
            )
            if self.bundle.report_id
            else None
        )
        if row:
            related = (
                await self.db.scalars(
                    select(EvidenceSegment)
                    .where(
                        *self.conditions(),
                        EvidenceSegment.location["table"].astext == row.location["table"],
                        EvidenceSegment.location["row_id"].astext == str(row.location["row_id"]),
                    )
                    .order_by(EvidenceSegment.ordinal, EvidenceSegment.id)
                )
            ).all()
            selected = [r for r in related if r.id == row.id]
            for r in related:
                if r.kind == "text" and r.id != row.id:
                    selected.append(r)
            table = row.data.get("table")
            page = None
            if table:
                end = query.row_offset + query.row_limit
                page = {
                    **{k: v for k, v in table.items() if k != "cells"},
                    "cells": [
                        [c[:1000] for c in r[:40]] for r in table["cells"][query.row_offset : end]
                    ],
                    "cells_truncated": any(
                        len(r) > 40 or any(len(c) > 1000 for c in r)
                        for r in table["cells"][query.row_offset : end]
                    ),
                    "row_offset": query.row_offset,
                    "total_rows": len(table["cells"]),
                    "next_row_offset": end if end < len(table["cells"]) else None,
                    "column_mapping_verified": False,
                    "span_information_available": False,
                }
            return {
                **self.provenance(),
                "next_text_offset": query.text_offset + 4000
                if query.text_offset + 4000 < len(row.text)
                else None,
                "segments": [
                    {
                        **self.candidate(r, []),
                        "excerpt": {
                            "text": r.text[query.text_offset : query.text_offset + 4000],
                            "start": query.text_offset,
                            "end": min(len(r.text), query.text_offset + 4000),
                            "truncated": len(r.text) > query.text_offset + 4000,
                        },
                    }
                    for r in selected
                ],
                "table": page,
            }
        for tools in self.html:
            try:
                result = await tools.read_note_context(query)
                result["segments"] = [
                    {
                        **s,
                        "origin": "html",
                        "region": "notes",
                        "scope": self.bundle.scope,
                        "source_revision": str(tools.revision.id),
                        "sha256": tools.artifact.sha256,
                        "location": {"structure_id": str(tools.revision.id)},
                    }
                    for s in result["segments"]
                ]
                return {**result, **self.provenance(), "origin": "html"}
            except HTTPException as error:
                if error.status_code != 404:
                    raise
        raise HTTPException(404, "source_segment_not_found")

    async def validate_citations(self, citations):
        if not citations or len(citations) > 30 or any(not c.quote.strip() for c in citations):
            raise HTTPException(422, "citation_count_or_text_invalid")
        for citation in citations:
            row = (
                await self.db.scalar(
                    select(EvidenceSegment).where(
                        *self.conditions(), EvidenceSegment.id == citation.segment_id
                    )
                )
                if self.bundle.report_id
                else None
            )
            if row:
                if citation.quote not in row.text:
                    raise HTTPException(422, "citation_text_mismatch")
                continue
            for tools in self.html:
                try:
                    await tools.validate_citations([citation])
                    break
                except HTTPException:
                    continue
            else:
                raise HTTPException(422, "citation_source_mismatch")

    async def call(self, name, arguments):
        allowed = {
            "list_note_sections": (SectionsQuery, self.list_note_sections),
            "search_note_segments": (BundleSearchQuery, self.search_note_segments),
            "read_note_context": (ContextQuery, self.read_note_context),
        }
        if name not in allowed:
            raise ValueError("unknown_note_search_tool")
        schema, method = allowed[name]
        return await method(schema.model_validate(arguments))


async def baseline(db, identity, bundle_id):
    tools = await BundleTools.owned(db, identity, bundle_id)
    if tools.bundle.baseline:
        return tools.bundle.baseline
    metadata = await tools.metadata()
    regions = {r["region"] for r in metadata["coverage"] if r["nonempty"]}
    if tools.html:
        regions.add("notes")
    items = []
    for key, title, terms, _ in CATEGORIES:
        found = await tools.search_note_segments(SearchQuery(terms=terms, limit=5))
        items.append(
            {
                "key": key,
                "title": title,
                "terms": terms,
                **found,
                "candidate_status": "MATCHED" if found["total"] else "NO_MATCH",
                "unavailable_regions": sorted({"notes", "business_report", "audit"} - regions),
                "search_status": "COMPLETED",
                "review_status": "PENDING",
            }
        )
    result = {
        **tools.provenance(),
        "items": items,
        "dictionary_version": DICTIONARY_VERSION,
        "report_coverage": "PARTIAL",
        "execution_status": "COMPLETED",
        "coverage": metadata["coverage"],
    }
    tools.bundle.baseline = result
    return result
