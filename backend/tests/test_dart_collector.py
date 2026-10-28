import io
import subprocess
import sys
from zipfile import ZipFile

import pytest

from app.core.storage import LocalArtifactStore
from app.modules.evidence import dart_collector as collector

RECEIPT = "20260320001416"


def test_worker_entrypoint_registers_all_referenced_tables():
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "import app.worker.main; from app.core.database import Base; "
            "print([t.name for t in Base.metadata.sorted_tables])",
        ],
        capture_output=True,
        text=True,
        timeout=15,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert "company" in result.stdout and "dart_document" in result.stdout


def toc(scope="OFS", receipt=RECEIPT):
    title = "3. 연결재무제표 주석" if scope == "CFS" else "5. 재무제표 주석"
    values = {
        "text": title,
        "rcpNo": receipt,
        "dcmNo": "11160477",
        "eleId": "31",
        "offset": "100",
        "length": "1000",
        "dtd": "dart4.xsd",
    }
    import json

    return (
        "<html><body><script>var node2 = {};"
        + "".join(
            f"node2['{key}'] = {json.dumps(value, ensure_ascii=False)};"
            for key, value in values.items()
        )
        + "</script></body></html>"
    ).encode()


def test_scopes_exact_and_ambiguous_or_wrong_receipt_refused():
    locators = collector.find_note_locators(toc() + toc("CFS"), RECEIPT)
    assert locators["OFS"]["text"] == "5. 재무제표 주석"
    assert locators["CFS"]["text"] == "3. 연결재무제표 주석"
    with pytest.raises(collector.CollectionError, match="ambiguous"):
        collector.find_note_locators(toc() + toc(), RECEIPT)
    with pytest.raises(collector.CollectionError, match="locator_invalid"):
        collector.find_note_locators(toc(receipt="20250320000001"), RECEIPT)


def test_zip_xml_and_toc_bytes_are_independently_preserved(tmp_path, monkeypatch):
    store = LocalArtifactStore(tmp_path)
    output = io.BytesIO()
    xml = b'<?xml version="1.0"?><DOCUMENT>original</DOCUMENT>'
    with ZipFile(output, "w") as archive:
        archive.writestr("../../original.xml", xml)
    responses = iter([output.getvalue(), toc()])
    monkeypatch.setattr(collector, "fetch", lambda *args: next(responses))
    result = collector.collect_document(store, "private-key", RECEIPT, 100000)
    assert store.read(result["archive_sha256"]) == output.getvalue()
    assert store.read(result["xml_files"][0]["sha256"]) == xml
    assert store.read(result["toc_sha256"]) == toc()
    assert not (tmp_path.parent / "original.xml").exists()


@pytest.mark.parametrize("body", [b'<?xml version="1.0"?><result>error</result>', b"not zip"])
def test_error_response_is_not_a_successful_archive(tmp_path, monkeypatch, body):
    monkeypatch.setattr(collector, "fetch", lambda *args: body)
    with pytest.raises(collector.CollectionError, match="archive_invalid"):
        collector.collect_document(LocalArtifactStore(tmp_path), "private-key", RECEIPT, 100000)


def test_note_html_requires_matching_heading_and_tables(tmp_path, monkeypatch):
    locator = collector.find_note_locators(toc(), RECEIPT)["OFS"]
    good = (
        "<html><body><h1>5. 재무제표 주석</h1><table><tr><td>"
        + "실제 원문 내용 " * 40
        + "</td></tr></table></body></html>"
    ).encode()
    monkeypatch.setattr(collector, "fetch", lambda *args: good)
    store = LocalArtifactStore(tmp_path)
    result = collector.collect_note(store, locator, 100000)
    assert store.read(result["sha256"]) == good
    monkeypatch.setattr(
        collector, "fetch", lambda *args: b"<html><body>access denied</body></html>"
    )
    with pytest.raises(collector.CollectionError, match="note_html_invalid"):
        collector.collect_note(store, locator, 100000)
