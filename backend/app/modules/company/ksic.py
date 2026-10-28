"""Version 11 code hierarchy, using only the supplied official code table."""

import csv
import hashlib
import io
import re
from pathlib import Path


class KsicError(ValueError):
    pass


class Ksic11:
    def __init__(self, path: Path):
        data = path.read_bytes()
        self.sha256 = hashlib.sha256(data).hexdigest()
        self.codes = {}
        self.names: dict[str, list[str]] = {}
        rows = csv.DictReader(io.StringIO(data.decode("utf-8-sig")))
        if rows.fieldnames != ["개정차수", "코드", "분류명", "분류단계", "분류수준", "상위코드"]:
            raise KsicError("ksic11_columns_invalid")
        for row in rows:
            code = row["코드"].strip()
            level = row["분류단계"]
            if (
                row["개정차수"] != "11"
                or code in self.codes
                or not re.fullmatch(r"[A-U]|[0-9]{2,5}", code)
                or level not in {"1", "2", "3", "4", "5"}
                or len(code) != int(level)
                or not row["분류명"].strip()
            ):
                raise KsicError("ksic11_row_invalid")
            self.codes[code] = {
                "code": code,
                "name": row["분류명"].strip(),
                "level": int(level),
                "parent": row["상위코드"].strip() or None,
            }
            self.names.setdefault(row["분류명"].strip(), []).append(code)
        if not self.codes:
            raise KsicError("ksic11_empty")
        for row in self.codes.values():
            parent = self.codes.get(row["parent"])
            if row["level"] == 1:
                if row["parent"] is not None:
                    raise KsicError("ksic11_parent_invalid")
            elif parent is None or parent["level"] != row["level"] - 1:
                raise KsicError("ksic11_parent_invalid")

    def match_name(self, name: str) -> str | None:
        """Exact names only. Repeated names resolve to their verified common ancestor."""
        candidates = self.names.get(name.strip(), [])
        if not candidates:
            return None
        paths = []
        for code in candidates:
            path = []
            while code:
                path.append(code)
                code = self.codes[code]["parent"]
            paths.append(path[::-1])
        ancestor = None
        for codes in zip(*paths, strict=False):
            if len(set(codes)) != 1:
                break
            ancestor = codes[0]
        return ancestor
