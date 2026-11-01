"""Load verified selected JSONL into a source DB, then publish immutable segments."""

import argparse
import asyncio
import hashlib
import json
import os
import sys
from pathlib import Path
from uuid import NAMESPACE_URL, uuid5

from sqlalchemy import Column, Integer, MetaData, String, Table, select, text
from sqlalchemy.dialects.postgresql import JSONB, insert

from app.core.config import Settings
from app.core.database import Database
from app.modules.evidence.bundle_models import EvidenceDataset, EvidenceReport, EvidenceSegment
from app.modules.evidence.dump_archive import TABLES, VERSION, digest
from app.modules.evidence.dump_normalize import segments

metadata = MetaData()
raw = Table(
    "evidence_raw",
    metadata,
    Column("signature", String(64), primary_key=True),
    Column("table_name", String(32), primary_key=True),
    Column("row_number", Integer, primary_key=True),
    Column("data", JSONB, nullable=False),
)
state = Table(
    "evidence_load",
    metadata,
    Column("signature", String(64), primary_key=True),
    Column("manifest", JSONB, nullable=False),
    Column("checkpoints", JSONB, nullable=False),
)


def validate_package(directory):
    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    if manifest["version"] != VERSION or set(manifest["tables"]) != set(TABLES):
        raise ValueError("unsupported_package")
    pairs = {(r["corp_code"], r["receipt_no"]) for r in manifest["selection"]}
    reports = set()
    for table in TABLES:
        checksum, count = hashlib.sha256(), 0
        with (directory / (table + ".jsonl")).open("rb") as stream:
            for line in stream:
                checksum.update(line)
                count += 1
                row = json.loads(line)
                pair = (row["corp_code"], row["rcept_no"])
                if pair not in pairs or (table == "note_section" and row["fs_div"] != "OFS"):
                    raise ValueError("row_outside_selection")
                if table == "report":
                    if pair in reports:
                        raise ValueError("duplicate_report")
                    reports.add(pair)
        if (
            count != manifest["tables"][table]["rows"]
            or checksum.hexdigest() != manifest["tables"][table]["sha256"]
        ):
            raise ValueError("package_integrity_failed")
    if reports != pairs:
        raise ValueError("package_reports_missing")
    expected = digest(
        {
            "version": VERSION,
            "selection": manifest["selection"],
            "files": {k: v["sha256"] for k, v in manifest["tables"].items()},
        }
    )
    if expected != manifest["signature"]:
        raise ValueError("invalid_package_signature")
    return manifest


async def load_source(source, directory, manifest):
    signature = manifest["signature"]
    async with source.engine.begin() as connection:
        await connection.run_sync(metadata.create_all)
    # One source importer per signature. A session advisory lock survives chunk commits.
    async with source.engine.connect() as connection:
        lock = int(signature[:15], 16)
        await connection.execute(text("SELECT pg_advisory_lock(:key)"), {"key": lock})
        await connection.commit()
        try:
            await connection.execute(
                insert(state)
                .values(signature=signature, manifest=manifest, checkpoints={})
                .on_conflict_do_nothing()
            )
            await connection.commit()
            checkpoints = dict(
                await connection.scalar(
                    select(state.c.checkpoints).where(state.c.signature == signature)
                )
            )
            for table in TABLES:
                batch = []
                with (directory / (table + ".jsonl")).open(encoding="utf-8") as stream:
                    for number, line in enumerate(stream, 1):
                        if number <= checkpoints.get(table, 0):
                            continue
                        batch.append(
                            {
                                "signature": signature,
                                "table_name": table,
                                "row_number": number,
                                "data": json.loads(line),
                            }
                        )
                        if len(batch) == 100:
                            await connection.execute(insert(raw), batch)
                            checkpoints[table] = number
                            await connection.execute(
                                state.update()
                                .where(state.c.signature == signature)
                                .values(checkpoints=checkpoints)
                            )
                            await connection.commit()
                            batch = []
                if batch:
                    await connection.execute(insert(raw), batch)
                    checkpoints[table] = batch[-1]["row_number"]
                    await connection.execute(
                        state.update()
                        .where(state.c.signature == signature)
                        .values(checkpoints=checkpoints)
                    )
                    await connection.commit()
        finally:
            await connection.rollback()
            await connection.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": lock})
            await connection.commit()


async def publish(source, service, manifest):
    signature = manifest["signature"]
    dataset_id = uuid5(NAMESPACE_URL, "loansight-dump:" + signature)
    async with service.transaction() as db:
        await db.execute(
            text("SELECT pg_advisory_xact_lock(:key)"), {"key": int(signature[:15], 16)}
        )
        existing = await db.get(EvidenceDataset, dataset_id)
        if existing and existing.status == "READY":
            return {"dataset_id": str(dataset_id), "reused": True}
        db.add(
            EvidenceDataset(id=dataset_id, signature=signature, status="LOADING", manifest=manifest)
        )
        await db.flush()
        report_ids = {}
        total = 0
        async with source.engine.connect() as connection:
            for table in TABLES:
                result = await connection.stream(
                    select(raw.c.data)
                    .where(raw.c.signature == signature, raw.c.table_name == table)
                    .order_by(raw.c.row_number)
                )
                batch = []
                async for row in result.scalars():
                    pair = row["corp_code"], row["rcept_no"]
                    if table == "report":
                        report_id = uuid5(dataset_id, ":".join(pair))
                        report_ids[pair] = report_id
                        db.add(
                            EvidenceReport(
                                id=report_id,
                                dataset_id=dataset_id,
                                corp_code=pair[0],
                                receipt_no=pair[1],
                                period=row["period"],
                                data=row,
                            )
                        )
                        await db.flush()
                    else:
                        batch.extend(segments(report_ids[pair], table, row))
                        if len(batch) >= 100:
                            await db.execute(insert(EvidenceSegment), batch)
                            total += len(batch)
                            batch = []
                if batch:
                    await db.execute(insert(EvidenceSegment), batch)
                    total += len(batch)
        dataset = await db.get(EvidenceDataset, dataset_id)
        dataset.status = "READY"
    return {
        "dataset_id": str(dataset_id),
        "reused": False,
        "reports": len(report_ids),
        "segments": total,
    }


async def run(args):
    manifest = await asyncio.to_thread(validate_package, args.directory)
    settings = Settings()
    source = Database(Settings(_env_file=None, database_url=os.environ[args.source_url_env]))
    service = Database(settings)
    try:
        if source.engine.url.database == service.engine.url.database:
            raise ValueError("source_database_must_be_separate")
        await load_source(source, args.directory, manifest)
        return await publish(source, service, manifest)
    finally:
        await source.close()
        await service.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--source-url-env", default="LOANSIGHT_SOURCE_DATABASE_URL")
    args = parser.parse_args()
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    print(json.dumps(asyncio.run(run(args))))


if __name__ == "__main__":
    main()
