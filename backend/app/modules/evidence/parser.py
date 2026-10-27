"""Keep the third-party parser behind a versioned, non-rendering adapter."""

import hashlib
from dataclasses import dataclass
from importlib.metadata import version
from uuid import UUID, uuid5

from lxml import html
from note_hierarchy import DocumentProcessor

from app.modules.evidence.models import NoteStructure, SourceArtifact

ADAPTER_VERSION = "note-segments-v1"


def parser_identity() -> tuple[str, str, dict]:
    processor = DocumentProcessor("dart")
    return version("dart-note-hierarchy"), processor.config.sha256, processor.config.to_dict()


@dataclass
class PreparedNotes:
    hierarchy: dict
    segments: list[dict]


def parse_notes(source: bytes, artifact: SourceArtifact, revision: NoteStructure) -> PreparedNotes:
    if version("dart-note-hierarchy") != revision.parser_version:
        raise ValueError("parser_version_mismatch")
    if revision.adapter_version != ADAPTER_VERSION:
        raise ValueError("adapter_version_mismatch")
    if hashlib.sha256(source).hexdigest() != artifact.sha256:
        raise ValueError("source_hash_mismatch")
    # Decode strictly before lxml can silently replace malformed input bytes.
    source.decode(artifact.encoding)
    processor = DocumentProcessor(
        "dart",
        encoding=artifact.encoding,
        link_periods=revision.link_periods,
        config=revision.rules,
    )
    if processor.config.sha256 != revision.rules_sha256:
        raise ValueError("rules_hash_mismatch")
    result = processor.process_html(
        source,
        document_id=str(revision.id),
        metadata={
            "corp_code": artifact.corp_code,
            "receipt_no": artifact.receipt_no,
            "period": artifact.period,
            "kind": "연결" if artifact.scope == "CFS" else "별도",
            "input_origin": "user_provided_note_html",
        },
    )
    data = result.data
    if (
        data.get("source_sha256") != artifact.sha256
        or not data.get("coverage", {}).get("normalized_text_equal")
        or not data.get("verification", {}).get("structural_checks_passed")
    ):
        raise ValueError("note_structure_validation_failed")
    if not data["blocks"] or not any(b["text"].strip() for b in data["blocks"]):
        raise ValueError("empty_note_document")
    nodes = {node["id"]: node for node in data["nodes"]}
    if len(nodes) != len(data["nodes"]):
        raise ValueError("duplicate_node_id")
    tables = {table["table_block_id"]: table for table in result.table_units}
    original = html.document_fromstring(source, parser=html.HTMLParser(encoding=artifact.encoding))
    segments = []
    for ordinal, block in enumerate(data["blocks"]):
        owner = nodes[block["owner_node_id"]]
        ancestors = set(owner.get("known_ancestor_ids", []))
        current = owner
        visited = set()
        while current:
            if current["id"] in visited:
                raise ValueError("cyclic_node_hierarchy")
            visited.add(current["id"])
            ancestors.add(current["id"])
            current = nodes[current["parent_id"]] if current.get("parent_id") else None
        if len(original.xpath(block["source_xpath"])) != 1:
            raise ValueError("invalid_source_xpath")
        segments.append(
            {
                "id": uuid5(UUID(str(revision.id)), block["id"]),
                "structure_id": revision.id,
                "local_id": block["id"],
                "ordinal": ordinal,
                "kind": block["type"],
                "source_xpath": block["source_xpath"],
                "text": block["text"],
                "owner_node_id": owner["id"],
                "top_note_ids": sorted(n for n in ancestors if nodes[n].get("level") == 1),
                "payload": block,
                "table_data": tables.get(block["id"]),
            }
        )
    if len({row["local_id"] for row in segments}) != len(segments):
        raise ValueError("duplicate_block_id")
    return PreparedNotes({key: value for key, value in data.items() if key != "blocks"}, segments)
