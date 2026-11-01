"""Stream a selected set of public COPY records; never execute archived SQL."""

import argparse
import hashlib
import json
import re
import subprocess
import tempfile
from collections import Counter
from pathlib import Path

TABLES = ("report", "note_section", "doc_section", "audit_opinion")
VERSION = "dump-evidence-v1"


def digest(value):
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, ensure_ascii=False).encode()
    ).hexdigest()


def copy_value(value):
    if value == r"\N":
        return None
    escapes = {"b": "\b", "f": "\f", "n": "\n", "r": "\r", "t": "\t", "v": "\v", "\\": "\\"}

    def replace(match):
        code = match[1]
        if re.fullmatch(r"[0-7]{1,3}", code):
            return chr(int(code, 8))
        if code.startswith("x") and len(code) > 1:
            return chr(int(code[1:], 16))
        return escapes.get(code, code)

    return re.sub(r"\\([0-7]{1,3}|x[0-9a-fA-F]{1,2}|.)", replace, value)


def archive_rows(archive, table, binary="pg_restore", *, selected_pairs=None, stats=None):
    if table not in TABLES:
        raise ValueError("unsupported_archive_table")
    # Stderr goes to a file so a verbose failing child cannot deadlock the pipe.
    with tempfile.TemporaryFile() as errors:
        child = subprocess.Popen(
            [
                binary,
                "--data-only",
                "--no-owner",
                "--no-privileges",
                "--schema",
                "public",
                "--table",
                table,
                "--file",
                "-",
                str(archive),
            ],
            stdout=subprocess.PIPE,
            stderr=errors,
        )
        columns = None
        try:
            for raw in child.stdout:
                if columns is not None and raw.rstrip(b"\r\n") != b"\\.":
                    if stats is not None:
                        stats["scanned"] += 1
                    if selected_pairs is not None:
                        corp_index, receipt_index = (
                            columns.index("corp_code"),
                            columns.index("rcept_no"),
                        )
                        prefix = raw.split(b"\t", max(corp_index, receipt_index) + 1)
                        pair = (
                            prefix[corp_index].decode("ascii"),
                            prefix[receipt_index].decode("ascii"),
                        )
                        if pair not in selected_pairs:
                            continue
                line = raw.decode("utf-8").rstrip("\r\n")
                if line.startswith("COPY "):
                    match = re.fullmatch(r"COPY public\." + table + r" \((.*?)\) FROM stdin;", line)
                    if not match:
                        raise ValueError("unexpected_copy_header")
                    columns = match[1].split(", ")
                elif columns is not None:
                    if line == r"\.":
                        columns = None
                        continue
                    values = line.split("\t")
                    if len(values) != len(columns):
                        raise ValueError("invalid_copy_row")
                    yield dict(zip(columns, map(copy_value, values), strict=True))
            if child.wait() != 0:
                raise ValueError("pg_restore_failed")
        finally:
            if child.poll() is None:
                child.terminate()
            child.stdout.close()
            child.wait()


def extract(archive, selection, output, binary="pg_restore"):
    selected = json.loads(selection.read_text(encoding="utf-8"))
    pairs = {(r["corp_code"], r["receipt_no"]) for r in selected}
    if not pairs or any(
        not re.fullmatch(r"\d{8}", c) or not re.fullmatch(r"\d{14}", r) for c, r in pairs
    ):
        raise ValueError("invalid_report_selection")
    output.mkdir(parents=True, exist_ok=True)
    manifest = {
        "version": VERSION,
        "archive_name": archive.name,
        "archive_bytes": archive.stat().st_size,
        "selection": sorted(selected, key=lambda r: (r["corp_code"], r["receipt_no"])),
        "tables": {},
    }
    report_pairs = set()
    for table in TABLES:
        path = output / (table + ".jsonl")
        kept = size = 0
        stats = {"scanned": 0}
        categories = Counter()
        stream_hash = hashlib.sha256()
        with path.with_suffix(".partial").open("wb") as stream:
            for row in archive_rows(archive, table, binary, selected_pairs=pairs, stats=stats):
                if (row["corp_code"], row["rcept_no"]) not in pairs:
                    continue
                if table == "note_section" and row["fs_div"] != "OFS":
                    continue
                if table == "report":
                    report_pairs.add((row["corp_code"], row["rcept_no"]))
                encoded = (json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n").encode()
                stream.write(encoded)
                stream_hash.update(encoded)
                size += len(encoded)
                kept += 1
                if table == "audit_opinion":
                    categories[row.get("fs")] += 1
                if table == "doc_section":
                    categories[
                        "body_skipped" if row.get("body_skipped") == "t" else "body_present"
                    ] += 1
        path.with_suffix(".partial").replace(path)
        manifest["tables"][table] = {
            "scanned": stats["scanned"],
            "rows": kept,
            "bytes": size,
            "sha256": stream_hash.hexdigest(),
            "categories": dict(categories),
        }
        print(
            json.dumps({"table": table, **manifest["tables"][table]}, ensure_ascii=True), flush=True
        )
    if pairs - report_pairs:
        raise ValueError("selected_reports_missing")
    manifest["signature"] = digest(
        {
            "version": VERSION,
            "selection": manifest["selection"],
            "files": {k: v["sha256"] for k, v in manifest["tables"].items()},
        }
    )
    (output / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--selection", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--pg-restore", default="pg_restore")
    args = parser.parse_args()
    extract(args.archive, args.selection, args.output, args.pg_restore)


if __name__ == "__main__":
    main()
