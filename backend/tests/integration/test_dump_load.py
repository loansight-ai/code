import hashlib
import json

import pytest
from sqlalchemy import func, select

from app.modules.evidence.bundle_models import EvidenceDataset, EvidenceReport
from app.modules.evidence.dump_archive import TABLES, VERSION, digest
from app.modules.evidence.dump_load import load_source, publish, raw, state, validate_package


def package(directory, broken=False):
    corp, receipt = "00112004", "20170331004204"
    data = {
        "report": [{"corp_code": corp, "rcept_no": receipt, "period": "2016.12"}],
        "note_section": [
            {
                "id": "1",
                "corp_code": corp,
                "rcept_no": receipt,
                "fs_div": "OFS",
                "body": "담보",
                "tables": '[{"cells":["bad"]}]' if broken else None,
            }
        ],
        "doc_section": [],
        "audit_opinion": [],
    }
    manifest = {
        "version": VERSION,
        "archive_name": "test.dump",
        "selection": [{"corp_code": corp, "receipt_no": receipt}],
        "tables": {},
    }
    for table in TABLES:
        encoded = "".join(json.dumps(r) + "\n" for r in data[table]).encode()
        (directory / (table + ".jsonl")).write_bytes(encoded)
        manifest["tables"][table] = {
            "rows": len(data[table]),
            "sha256": hashlib.sha256(encoded).hexdigest(),
        }
    manifest["signature"] = digest(
        {
            "version": VERSION,
            "selection": manifest["selection"],
            "files": {k: v["sha256"] for k, v in manifest["tables"].items()},
        }
    )
    (directory / "manifest.json").write_text(json.dumps(manifest))
    return validate_package(directory)


async def test_selected_load_restarts_from_checkpoint_and_publish_reuses(environment, tmp_path):
    database = environment[2]
    manifest = package(tmp_path)
    await load_source(database, tmp_path, manifest)
    await load_source(database, tmp_path, manifest)
    async with database.transaction() as db:
        assert await db.scalar(select(func.count()).select_from(raw)) == 2
        checkpoints = await db.scalar(select(state.c.checkpoints))
        assert checkpoints == {"report": 1, "note_section": 1}
    first = await publish(database, database, manifest)
    second = await publish(database, database, manifest)
    assert first["dataset_id"] == second["dataset_id"] and second["reused"]
    async with database.transaction() as db:
        assert await db.scalar(select(func.count()).select_from(EvidenceReport)) == 1


async def test_failed_normalization_does_not_publish_partial_dataset(environment, tmp_path):
    database = environment[2]
    manifest = package(tmp_path, broken=True)
    await load_source(database, tmp_path, manifest)
    with pytest.raises(ValueError, match="invalid_dump_cells"):
        await publish(database, database, manifest)
    async with database.transaction() as db:
        assert await db.scalar(select(func.count()).select_from(EvidenceDataset)) == 0


def test_tampering_after_export_is_rejected(tmp_path):
    package(tmp_path)
    with (tmp_path / "report.jsonl").open("a") as stream:
        stream.write("{}\n")
    with pytest.raises((ValueError, KeyError)):
        validate_package(tmp_path)
