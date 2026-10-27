import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

from app.core.storage import LocalArtifactStore, SourceIntegrityError


def test_atomic_content_addressed_writes_and_integrity(tmp_path):
    store = LocalArtifactStore(tmp_path)
    with ThreadPoolExecutor(max_workers=4) as pool:
        digests = list(pool.map(store.put, [b"<html>same source</html>"] * 8))
    assert len(set(digests)) == 1
    assert store.read(digests[0]) == b"<html>same source</html>"
    assert len(list(tmp_path.rglob(".upload-*"))) == 0
    store.path(digests[0]).write_bytes(b"corrupted")
    with pytest.raises(SourceIntegrityError):
        store.read(digests[0])
    with pytest.raises(SourceIntegrityError):
        store.put(b"<html>same source</html>")


def test_no_external_storage_paths(tmp_path):
    store = LocalArtifactStore(tmp_path)
    with pytest.raises(ValueError):
        store.read("../secrets")
    elsewhere = tmp_path.parent / "outside-artifacts"
    elsewhere.mkdir()
    # Resolving an existing symlink must not escape the configured root.
    try:
        (tmp_path / "aa").symlink_to(elsewhere, target_is_directory=True)
    except OSError:
        return  # Windows may deny creating symlinks; traversal rejection above still runs.
    with pytest.raises(ValueError):
        store.path("a" * 64)


@pytest.mark.skipif(os.name != "nt", reason="Windows extended path representation")
def test_accepts_equivalent_windows_extended_paths(tmp_path, monkeypatch):
    store = LocalArtifactStore(tmp_path)
    original = Path.resolve

    def extended(path, *args, **kwargs):
        resolved = str(original(path, *args, **kwargs))
        return Path("\\\\?\\" + resolved.removeprefix("\\\\?\\"))

    monkeypatch.setattr(Path, "resolve", extended)
    digest = store.put(b"extended path example")
    assert store.read(digest) == b"extended path example"
