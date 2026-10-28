"""Restart-safe weekly master refresh and incremental company profile synchronization."""

import argparse
import asyncio
import json
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from contextlib import contextmanager, suppress
from datetime import UTC, datetime

import structlog

from app.core.config import Settings
from app.modules.company.catalog import CatalogUnavailable, CompanyCatalog
from app.modules.company.ksic import Ksic11
from app.modules.company.profiles import FIELDS, ProfileError, ProfileStore, atomic_write, read_seed

WEEK_SECONDS = 7 * 24 * 60 * 60


@contextmanager
def sync_lock(path):
    """OS lock is released on process exit, including crashes; shared by API workers."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a+b") as handle:
        if path.stat().st_size == 0:
            handle.write(b"0")
            handle.flush()
        handle.seek(0)
        try:
            if os.name == "nt":
                import msvcrt

                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            yield False
            return
        try:
            yield True
        finally:
            handle.seek(0)
            if os.name == "nt":
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(handle, fcntl.LOCK_UN)


def download_profile(key: str, code: str) -> tuple[dict, bytes]:
    query = urllib.parse.urlencode({"crtfc_key": key, "corp_code": code})
    try:
        with urllib.request.urlopen(
            f"https://opendart.fss.or.kr/api/company.json?{query}", timeout=30
        ) as response:
            raw = response.read(1024 * 1024 + 1)
        if len(raw) > 1024 * 1024:
            raise ProfileError("dart_profile_invalid")
        payload = json.loads(raw)
        status = payload.get("status")
        if status != "000":
            # Never include the original message, request URL or credentials.
            raise ProfileError(
                f"dart_profile_status_{status}"
                if status in {"010", "011", "012", "013", "020", "800", "900", "901"}
                else "dart_profile_failed"
            )
        if payload.get("corp_code", code) != code or not payload.get("corp_name"):
            raise ProfileError("dart_profile_identity_invalid")
        for field, pattern in (
            ("stock_code", r"[0-9A-Z]{6}"),
            ("corp_cls", r"[YKNE]"),
            ("acc_mt", r"0[1-9]|1[0-2]"),
        ):
            value = payload.get(field)
            if value and (not isinstance(value, str) or not re.fullmatch(pattern, value.strip())):
                raise ProfileError("dart_profile_invalid")
        return payload, raw
    except (urllib.error.URLError, TimeoutError, OSError, ValueError, AttributeError):
        raise ProfileError("dart_profile_failed") from None


class CompanySync:
    def __init__(self, settings: Settings, catalog: CompanyCatalog | None = None):
        self.settings = settings
        self.catalog = catalog or CompanyCatalog(settings)
        self.store = ProfileStore(settings.artifact_root)
        self.stop = threading.Event()

    def once(self, *, force: bool = False, profile_limit: int = 0, now: float | None = None):
        now = time.time() if now is None else now
        with sync_lock(self.store.pointer.with_suffix(".lock")) as acquired:
            if not acquired:
                return {"status": "busy"}
            snapshot = self.store.read()
            seed = self.settings.company_seed_csv
            table = self.settings.ksic11_codes_csv
            signatures = [p.stat().st_mtime_ns if p.exists() else None for p in (seed, table)]
            source_changed = snapshot.get("source_signatures") != signatures
            profiles = snapshot["profiles"]
            last_success = snapshot.get("last_success_at")
            archive_stamp = (
                self.catalog.path.stat().st_mtime_ns if self.catalog.path.exists() else None
            )
            master_changed = snapshot.get("archive_stamp") != archive_stamp
            if last_success is None and self.catalog.path.exists():
                last_success = self.catalog.path.stat().st_mtime
            due = force or last_success is None or now - last_success >= WEEK_SECONDS
            pending = any(
                state.get("needs_profile")
                and state.get("active")
                and state.get("retry_after", 0) <= now
                for state in snapshot["companies"].values()
            )
            pending = pending and snapshot.get("profile_retry_after", 0) <= now
            pending = pending and snapshot.get("profile_batch_after", 0) <= now
            if (
                not due
                and not source_changed
                and not master_changed
                and not (profile_limit and pending)
            ):
                return {"status": "cached"}
            # A configured bad/missing table must not silently unvalidate existing mappings.
            ksic = Ksic11(table) if table.exists() else None
            if source_changed and seed.exists():
                if ksic is None:
                    raise ProfileError("ksic11_table_missing")
                imported, digest = read_seed(seed)
                if any(
                    row["ksic11_code"] and row["ksic11_code"] not in ksic.codes
                    for row in imported.values()
                ):
                    raise ProfileError("company_seed_unknown_ksic11_code")
                seed_changed = snapshot.get("seed_sha256") != digest
                snapshot["seed_sha256"] = digest
                self.store.objects.put(seed.read_bytes())
                for code, row in imported.items():
                    previous = profiles.get(code, {})
                    state = snapshot["companies"].get(code, {})
                    # New seed values update seed fields but do not replace verified API values.
                    merged = dict(previous)
                    for field, value in row.items():
                        if value and (not state.get("queried_at") or not merged.get(field)):
                            merged[field] = value
                    merged["ksic11_code"] = row["ksic11_code"] or previous.get("ksic11_code", "")
                    if seed_changed and row["ksic11_code"]:
                        state["industry_review"] = False
                    profiles[code] = merged
            if ksic is not None:
                snapshot["ksic11_sha256"] = self.store.objects.put(table.read_bytes())
            snapshot["source_signatures"] = signatures
            previous_companies = snapshot["companies"]
            initial_baseline = not previous_companies
            if due:
                if self.catalog.path.exists():
                    self.store.objects.put(self.catalog.path.read_bytes())
                companies = self.catalog.load(refresh=True)
                last_success = now
            else:
                companies = self.catalog.load()
            archive = self.catalog.path.read_bytes()
            snapshot["archive_sha256"] = self.store.objects.put(archive)
            current_codes = {company.corp_code for company in companies}
            added, changed = [], []
            for company in companies:
                code = company.corp_code
                state = previous_companies.get(code)
                if state is None:
                    if not initial_baseline:
                        added.append(code)
                    state = {
                        "needs_profile": code not in profiles,
                        "origin": "seed" if code in profiles else "outside_seed",
                    }
                elif state.get("modify_date") != company.modify_date:
                    changed.append(code)
                    state["needs_profile"] = True
                    state["industry_review"] = bool(profiles.get(code, {}).get("ksic11_code"))
                state.update(modify_date=company.modify_date, active=True)
                previous_companies[code] = state
            missing = []
            for code, state in previous_companies.items():
                if code not in current_codes:
                    state["active"] = False
                    missing.append(code)
            attempted = 0
            if (
                profile_limit
                and self.settings.open_dart_api_key
                and snapshot.get("profile_retry_after", 0) <= now
                and snapshot.get("profile_batch_after", 0) <= now
            ):
                targets = sorted(
                    code
                    for code, state in previous_companies.items()
                    if state.get("active")
                    and state.get("needs_profile")
                    and state.get("retry_after", 0) <= now
                )
                for code in targets[:profile_limit]:
                    if self.stop.is_set():
                        break
                    state = previous_companies[code]
                    attempted += 1
                    try:
                        payload, raw = download_profile(
                            self.settings.open_dart_api_key.get_secret_value(), code
                        )
                        row = dict(profiles.get(code, {"corp_code": code}))
                        old_industry = row.get("induty_code")
                        for field in FIELDS:
                            value = payload.get(field)
                            if (
                                field not in {"corp_code", "ksic11_code"}
                                and isinstance(value, str)
                                and value.strip()
                            ):
                                row[field] = value.strip()
                        if old_industry and row.get("induty_code") != old_industry:
                            state["industry_review"] = True
                        # company.json has no official industry-name field; never copy its code.
                        profiles[code] = row
                        state.update(
                            needs_profile=False,
                            queried_at=now,
                            response_sha256=self.store.objects.put(raw),
                        )
                        state.pop("profile_error", None)
                    except ProfileError as exc:
                        state["profile_error"] = str(exc)
                        state["retry_after"] = now + 3600
                        if str(exc) != "dart_profile_status_013":
                            snapshot["profile_retry_after"] = now + 3600
                            break
                    if self.stop.wait(0.2):
                        break
            if attempted:
                snapshot["profile_batch_after"] = now + 60
            review = []
            registrations: dict[tuple[str, str], list[str]] = {}
            for code, row in profiles.items():
                for field in ("jurir_no", "bizr_no"):
                    if row.get(field) and set(row[field]) != {"0"}:
                        registrations.setdefault((field, row[field]), []).append(code)
            conflicts = {
                code for codes in registrations.values() if len(codes) > 1 for code in codes
            }
            for code in sorted(current_codes | profiles.keys()):
                state = previous_companies.get(code, {})
                row = profiles.get(code, {})
                reasons = []
                if code not in current_codes:
                    reasons.append("absent_from_latest_master")
                if not row.get("ksic11_code"):
                    reasons.append("ksic11_unmatched")
                if state.get("industry_review"):
                    reasons.append("industry_change_requires_review")
                if state.get("needs_profile"):
                    reasons.append("profile_pending")
                if state.get("profile_error"):
                    reasons.append("profile_fetch_failed")
                if code in conflicts:
                    reasons.append("registration_conflict")
                if reasons:
                    review.append({"corp_code": code, "reasons": reasons})
            snapshot.update(
                last_success_at=last_success,
                updated_at=now,
                profiles=profiles,
                companies=previous_companies,
                review=review,
                changes=(
                    {"added": added, "changed": changed, "missing": missing}
                    if due or master_changed
                    else snapshot.get("changes", {})
                ),
                archive_stamp=self.catalog.path.stat().st_mtime_ns,
            )
            self.store.save(snapshot, incremental=not (due or source_changed or master_changed))
            lines = ["corp_code,reasons"] + [
                row["corp_code"] + "," + "|".join(row["reasons"]) for row in review
            ]
            atomic_write(
                self.store.pointer.parent / "review.csv",
                ("\n".join(lines) + "\n").encode("utf-8-sig"),
            )
            return {
                "status": "refreshed" if due else "cached",
                "companies": len(companies),
                "profiles": len(profiles),
                "review": len(review),
                "profile_attempts": attempted,
                "next_refresh_at": datetime.fromtimestamp(
                    last_success + WEEK_SECONDS, UTC
                ).isoformat(),
            }


async def run_weekly(sync: CompanySync):
    try:
        while True:
            work = asyncio.create_task(
                asyncio.to_thread(sync.once, profile_limit=sync.settings.company_profile_batch_size)
            )
            try:
                result = await asyncio.shield(work)
                structlog.get_logger().info("company_sync", **result)
            except asyncio.CancelledError:
                sync.stop.set()
                with suppress(Exception):
                    await work
                raise
            except (CatalogUnavailable, ProfileError, OSError, ValueError):
                structlog.get_logger().warning("company_sync_failed")
            await asyncio.sleep(60)
    finally:
        sync.stop.set()


def main():
    parser = argparse.ArgumentParser(description="Weekly DART master and KSIC11 snapshot sync")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--watch", action="store_true")
    parser.add_argument("--profile-limit", type=int)
    args = parser.parse_args()
    if args.profile_limit is not None and args.profile_limit < 0:
        parser.error("--profile-limit must be nonnegative")
    settings = Settings(
        **(
            {"company_profile_batch_size": args.profile_limit}
            if args.profile_limit is not None
            else {}
        )
    )
    sync = CompanySync(settings)
    if args.watch:
        asyncio.run(run_weekly(sync))
        return
    try:
        print(
            json.dumps(
                sync.once(force=args.force, profile_limit=settings.company_profile_batch_size)
            )
        )
    except (CatalogUnavailable, ProfileError, OSError, ValueError):
        parser.exit(1, "company_sync_failed\n")


if __name__ == "__main__":
    main()
