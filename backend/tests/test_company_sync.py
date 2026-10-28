import asyncio
import csv
import io
import os
from zipfile import ZipFile

import pytest

from app.core.config import Settings
from app.modules.company import catalog as catalog_module
from app.modules.company import sync as sync_module
from app.modules.company.catalog import CatalogUnavailable, CompanyCatalog
from app.modules.company.ksic import Ksic11, KsicError
from app.modules.company.profiles import FIELDS, ProfileError, read_seed
from app.modules.company.sync import WEEK_SECONDS, CompanySync, sync_lock

NOW = 1_800_000_000


def master(codes, date="20261028"):
    xml = (
        "<result>"
        + "".join(
            f"<list><corp_code>{code}</corp_code><corp_name>동명기업</corp_name>"
            f"<stock_code>0010A0</stock_code><modify_date>{date}</modify_date></list>"
            for code in codes
        )
        + "</result>"
    )
    data = io.BytesIO()
    with ZipFile(data, "w") as archive:
        archive.writestr("CORPCODE.xml", xml)
    return data.getvalue()


def seed(path, rows):
    with path.open("w", encoding="utf-8-sig", newline="") as output:
        writer = csv.DictWriter(output, fieldnames=FIELDS)
        writer.writeheader()
        for row in rows:
            writer.writerow(dict.fromkeys(FIELDS, "") | row)


@pytest.fixture
def environment(tmp_path):
    codes = tmp_path / "ksic.csv"
    codes.write_text(
        "개정차수,코드,분류명,분류단계,분류수준,상위코드\n"
        "11,A,농림어업,1,대분류,\n"
        "11,01,농업,2,중분류,A\n"
        "11,011,작물 재배업,3,소분류,01\n"
        "11,0111,동일명,4,세분류,011\n"
        "11,01110,동일명,5,세세분류,0111\n",
        encoding="utf-8-sig",
    )
    settings = Settings(
        _env_file=None,
        database_url="postgresql+psycopg://test:test@localhost/test",
        artifact_root=tmp_path,
        company_seed_csv=tmp_path / "seed.csv",
        ksic11_codes_csv=codes,
        open_dart_api_key="private-test-key",
        company_sync_enabled=False,
    )
    seed(
        settings.company_seed_csv,
        [
            {
                "corp_code": "00123456",
                "corp_name": "동명기업",
                "ksic11_code": "0111",
                "induty_code": "DART-original",
                "corp_cls": "K",
                "acc_mt": "03",
                "jurir_no": "0011111111111",
            }
        ],
    )
    catalog = CompanyCatalog(settings)
    catalog.path.parent.mkdir(parents=True)
    catalog.path.write_bytes(master(["00123456", "00987654"]))
    os.utime(catalog.path, (NOW, NOW))
    return settings, catalog


def test_seed_preserves_identifiers_and_does_not_use_names_as_keys(environment):
    settings, _ = environment
    rows, _ = read_seed(settings.company_seed_csv)
    assert rows["00123456"]["ksic11_code"] == "0111"
    assert rows["00123456"]["jurir_no"] == "0011111111111"
    with settings.company_seed_csv.open("a", encoding="utf-8") as output:
        output.write("00123456," + ",".join(["x"] * 17) + "\n")
    with pytest.raises(ProfileError):
        read_seed(settings.company_seed_csv)


def test_official_hierarchy_exact_names_and_repeated_name_ancestor(environment):
    settings, _ = environment
    codes = Ksic11(settings.ksic11_codes_csv)
    assert codes.match_name("동일명") == "0111"
    assert codes.match_name("동일 명") is None
    assert codes.codes["01"]["parent"] == "A"
    settings.ksic11_codes_csv.write_text("개정차수,코드\n10,01\n", encoding="utf-8")
    with pytest.raises(KsicError):
        Ksic11(settings.ksic11_codes_csv)


def test_weekly_boundary_restart_diff_and_enrichment(environment, monkeypatch):
    settings, catalog = environment
    downloads = []

    def download(key):
        downloads.append(key)
        return master(["00123456", "00888888"], date="20261104")

    monkeypatch.setattr(catalog_module, "download_archive", download)
    sync = CompanySync(settings, catalog)
    assert sync.once(now=NOW)["status"] == "cached"
    assert downloads == []
    first = sync.store.read()
    assert first["changes"]["added"] == []
    assert first["companies"]["00987654"]["origin"] == "outside_seed"
    result = catalog.search("00123456", 0, 30)["items"][0]
    assert (result.ksic11_code, result.ksic11_name, result.acc_mt) == ("0111", "동일명", "03")
    assert result.induty_code == "DART-original"
    assert CompanySync(settings).once(now=NOW + WEEK_SECONDS - 1)["status"] == "cached"
    assert downloads == []
    sync.once(now=NOW + WEEK_SECONDS)
    assert downloads == ["private-test-key"]
    snapshot = sync.store.read()
    assert snapshot["changes"] == {
        "added": ["00888888"],
        "changed": ["00123456"],
        "missing": ["00987654"],
    }
    assert snapshot["companies"]["00987654"]["active"] is False
    assert catalog.search("00123456", 0, 30)["items"][0].ksic11_status == "review_required"
    assert catalog.search("00888888", 0, 30)["items"][0].ksic11_code is None
    assert (sync.store.pointer.parent / "review.csv").exists()


def test_failed_refresh_preserves_master_mapping_and_active_snapshot(environment, monkeypatch):
    settings, catalog = environment
    sync = CompanySync(settings, catalog)
    sync.once(now=NOW)
    original = sync.store.pointer.read_bytes()
    archive = catalog.path.read_bytes()
    monkeypatch.setattr(catalog_module, "download_archive", lambda key: b"broken")
    with pytest.raises(CatalogUnavailable):
        sync.once(now=NOW + WEEK_SECONDS)
    assert sync.store.pointer.read_bytes() == original
    assert catalog.path.read_bytes() == archive
    assert catalog.search("00123456", 0, 30)["items"][0].ksic11_code == "0111"


def test_incremental_profile_does_not_copy_dart_code_or_overwrite_blanks(environment, monkeypatch):
    settings, catalog = environment
    sync = CompanySync(settings, catalog)
    sync.once(now=NOW)
    snapshot = sync.store.read()
    snapshot["companies"]["00123456"]["needs_profile"] = True
    sync.store.save(snapshot)
    payload = {
        "corp_name": "API name",
        "induty_code": "different",
        "acc_mt": "",
        "ksic11_code": "01",
    }
    monkeypatch.setattr(
        sync_module, "download_profile", lambda key, code: (payload, b"raw-response")
    )
    sync.once(now=NOW + 1, profile_limit=1)
    row = sync.store.read()["profiles"]["00123456"]
    assert row["ksic11_code"] == "0111"
    assert row["acc_mt"] == "03"
    assert row["induty_code"] == "different"
    state = sync.store.read()["companies"]["00123456"]
    assert state["industry_review"] is True
    assert state["queried_at"] == NOW + 1
    assert sync.store.objects.read(state["response_sha256"]) == b"raw-response"


def test_cross_process_lock_excludes_overlapping_jobs_and_releases(environment):
    settings, _ = environment
    path = settings.artifact_root / "company.lock"
    with sync_lock(path) as acquired:
        assert acquired
        with sync_lock(path) as second:
            assert not second
    with sync_lock(path) as acquired:
        assert acquired


def test_profile_quota_failure_keeps_good_values_and_backs_off(environment, monkeypatch):
    settings, catalog = environment
    sync = CompanySync(settings, catalog)
    sync.once(now=NOW)
    snapshot = sync.store.read()
    snapshot["companies"]["00123456"]["needs_profile"] = True
    sync.store.save(snapshot)
    calls = []

    def failed(key, code):
        calls.append(code)
        raise ProfileError("dart_profile_status_020")

    monkeypatch.setattr(sync_module, "download_profile", failed)
    sync.once(now=NOW + 1, profile_limit=20)
    after = sync.store.read()
    assert after["profiles"]["00123456"]["induty_code"] == "DART-original"
    assert after["companies"]["00123456"]["retry_after"] == NOW + 3601
    before = sync.store.pointer.read_bytes()
    sync.once(now=NOW + 2, profile_limit=20)
    assert calls == ["00123456"]
    assert sync.store.pointer.read_bytes() == before


def test_registration_conflicts_remain_separate_companies(environment):
    settings, catalog = environment
    seed(
        settings.company_seed_csv,
        [
            {
                "corp_code": code,
                "corp_name": "동명",
                "ksic11_code": "01",
                "jurir_no": "0011111111111",
            }
            for code in ("00123456", "00987654")
        ],
    )
    sync = CompanySync(settings, catalog)
    sync.once(now=NOW)
    snapshot = sync.store.read()
    assert len(snapshot["profiles"]) == 2
    assert all("registration_conflict" in row["reasons"] for row in snapshot["review"])


def test_unknown_ksic_code_does_not_publish_a_snapshot(environment):
    settings, catalog = environment
    seed(
        settings.company_seed_csv,
        [{"corp_code": "00123456", "corp_name": "test", "ksic11_code": "99"}],
    )
    sync = CompanySync(settings, catalog)
    with pytest.raises(ProfileError, match="company_seed_unknown_ksic11_code"):
        sync.once(now=NOW)
    assert not sync.store.pointer.exists()


async def test_scheduler_starts_and_stops_with_api_lifespan(environment, monkeypatch):
    from app.main import create_app

    settings, _ = environment
    events = []

    async def runner(sync):
        events.append("started")
        try:
            await asyncio.Event().wait()
        finally:
            events.append("stopped")

    monkeypatch.setattr("app.main.run_weekly", runner)
    app = create_app(settings.model_copy(update={"company_sync_enabled": True}))
    async with app.router.lifespan_context(app):
        await asyncio.sleep(0)
        assert events == ["started"]
    assert events == ["started", "stopped"]
