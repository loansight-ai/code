"""Import the supplied KSIC11 snapshot without converting DART industry codes."""

import csv
import hashlib
import io
import json
import re
from pathlib import Path
from tempfile import NamedTemporaryFile

from app.core.storage import LocalArtifactStore
from app.modules.company.ksic import Ksic11

FIELDS = (
    "corp_code",
    "corp_name",
    "corp_name_eng",
    "stock_name",
    "stock_code",
    "ceo_nm",
    "corp_cls",
    "jurir_no",
    "bizr_no",
    "adres",
    "hm_url",
    "ir_url",
    "phn_no",
    "fax_no",
    "induty_code",
    "est_dt",
    "acc_mt",
    "ksic11_code",
)


class ProfileError(Exception):
    pass


def read_seed(path: Path) -> tuple[dict[str, dict], str]:
    data = path.read_bytes()
    rows = csv.DictReader(io.StringIO(data.decode("utf-8-sig")))
    if rows.fieldnames != list(FIELDS):
        raise ProfileError("company_seed_columns_invalid")
    profiles = {}
    for raw in rows:
        if None in raw or any(value is None for value in raw.values()):
            raise ProfileError("company_seed_row_invalid")
        row = {key: value.strip() for key, value in raw.items()}
        code = row["corp_code"]
        if (
            not re.fullmatch(r"[0-9]{8}", code)
            or code in profiles
            or not row["corp_name"]
            or (row["ksic11_code"] and not re.fullmatch(r"[A-U]|[0-9]{2,5}", row["ksic11_code"]))
            or (row["stock_code"] and not re.fullmatch(r"[0-9A-Z]{6}", row["stock_code"]))
            or row["corp_cls"] not in {"", "Y", "K", "N", "E"}
            or (row["acc_mt"] and not re.fullmatch(r"0[1-9]|1[0-2]", row["acc_mt"]))
        ):
            raise ProfileError("company_seed_row_invalid")
        profiles[code] = row
    if not profiles:
        raise ProfileError("company_seed_empty")
    return profiles, hashlib.sha256(data).hexdigest()


def atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with NamedTemporaryFile(dir=path.parent, delete=False) as output:
            temporary = Path(output.name)
            output.write(data)
        temporary.replace(path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


class ProfileStore:
    def __init__(self, root: Path):
        self.pointer = root / "company/sync-current.json"
        self.objects = LocalArtifactStore(root / "company/history")

    def read(self) -> dict:
        if not self.pointer.exists():
            return {"profiles": {}, "companies": {}, "review": [], "last_success_at": None}
        pointer = json.loads(self.pointer.read_bytes())
        snapshot = json.loads(self.objects.read(pointer["snapshot_sha256"]))
        if pointer.get("overlay_sha256"):
            overlay = json.loads(self.objects.read(pointer["overlay_sha256"]))
            for field in ("profiles", "companies"):
                snapshot[field].update(overlay.pop(field, {}))
            snapshot.update(overlay)
        return snapshot

    def save(self, snapshot: dict, *, incremental: bool = False) -> None:
        pointer = None
        content = snapshot
        if incremental and self.pointer.exists():
            pointer = json.loads(self.pointer.read_bytes())
            base = json.loads(self.objects.read(pointer["snapshot_sha256"]))
            content = dict(snapshot)
            for field in ("profiles", "companies"):
                content[field] = {
                    code: row
                    for code, row in snapshot[field].items()
                    if row != base[field].get(code)
                }
        data = json.dumps(content, ensure_ascii=False, separators=(",", ":")).encode()
        digest = self.objects.put(data)
        pointer = (
            {"snapshot_sha256": pointer["snapshot_sha256"], "overlay_sha256": digest}
            if pointer
            else {"snapshot_sha256": digest}
        )
        # The immutable object is complete before its active pointer is changed.
        atomic_write(self.pointer, json.dumps(pointer).encode())


class ProfileIndex:
    def __init__(self, root: Path, seed: Path, codes: Path):
        self.store = ProfileStore(root)
        self.seed = seed
        self.codes_path = codes
        self.ksic: Ksic11 | None = None
        self._stamp = None
        self._profiles: dict[str, dict] = {}
        self._states: dict[str, dict] = {}

    def load(self) -> None:
        pointer = self.store.pointer
        source = pointer if pointer.exists() else self.seed
        stamp = (
            (str(source), source.stat().st_mtime_ns) if source.exists() else None,
            self.codes_path.stat().st_mtime_ns if self.codes_path.exists() else None,
        )
        if stamp == self._stamp:
            return
        try:
            ksic = Ksic11(self.codes_path) if self.codes_path.exists() else None
            if pointer.exists():
                snapshot = self.store.read()
                profiles = snapshot["profiles"]
                states = snapshot["companies"]
                if ksic is None and snapshot.get("ksic11_sha256"):
                    ksic = Ksic11(self.store.objects.path(snapshot["ksic11_sha256"]))
            elif self.seed.exists():
                profiles, _ = read_seed(self.seed)
                states = {}
            else:
                profiles, states = {}, {}
        except (OSError, ValueError, ProfileError) as exc:
            raise ProfileError("company_profiles_unavailable") from exc
        self._profiles, self._states, self._stamp = profiles, states, stamp
        self.ksic = ksic

    def fields(self, code: str) -> dict:
        row = self._profiles.get(code, {})
        ksic = row.get("ksic11_code") or None
        definition = self.ksic.codes.get(ksic) if self.ksic and ksic else None
        state = self._states.get(code, {})
        return {
            "ksic11_code": ksic if definition else None,
            "ksic11_name": definition["name"] if definition else None,
            "ksic11_level": definition["level"] if definition else None,
            "ksic11_status": (
                "review_required"
                if state.get("industry_review") or (ksic and not definition)
                else "matched"
                if definition
                else "unmatched"
            ),
            "induty_code": row.get("induty_code") or None,
            "corp_cls": row.get("corp_cls") or None,
            "acc_mt": row.get("acc_mt") or None,
        }
