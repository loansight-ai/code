"""Immutable, content-addressed local storage shared by the API and Worker."""

import hashlib
import os
import re
import tempfile
from pathlib import Path


class SourceIntegrityError(ValueError):
    pass


def canonical_path(path: Path) -> Path:
    resolved = str(path.resolve())
    # Windows may return either DOS or extended-length paths as a concurrent
    # file appears. Compare both root and object using the same representation.
    if os.name == "nt":
        if resolved.startswith("\\\\?\\UNC\\"):
            resolved = "\\\\" + resolved[8:]
        elif resolved.startswith("\\\\?\\"):
            resolved = resolved[4:]
    return Path(resolved)


class LocalArtifactStore:
    def __init__(self, root: Path):
        self.root = canonical_path(root)

    def path(self, digest: str) -> Path:
        if not re.fullmatch(r"[a-f0-9]{64}", digest):
            raise ValueError("invalid_source_digest")
        target = canonical_path(self.root / digest[:2] / digest)
        if not target.is_relative_to(self.root):
            raise ValueError("invalid_storage_path")
        return target

    def put(self, content: bytes) -> str:
        digest = hashlib.sha256(content).hexdigest()
        target = self.path(digest)
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            self.read(digest)
            return digest
        fd, temporary = tempfile.mkstemp(dir=target.parent, prefix=".upload-")
        try:
            with os.fdopen(fd, "wb") as stream:
                stream.write(content)
                stream.flush()
                os.fsync(stream.fileno())
            # Publish without replacing an existing immutable object. A hard
            # link also avoids Windows rename races with concurrent readers.
            try:
                os.link(temporary, target)
            except FileExistsError:
                self.read(digest)
            if os.name != "nt":
                directory_fd = os.open(target.parent, os.O_RDONLY)
                try:
                    os.fsync(directory_fd)
                finally:
                    os.close(directory_fd)
        finally:
            Path(temporary).unlink(missing_ok=True)
        return digest

    def read(self, digest: str) -> bytes:
        content = self.path(digest).read_bytes()
        if hashlib.sha256(content).hexdigest() != digest:
            raise SourceIntegrityError("source_hash_mismatch")
        return content
