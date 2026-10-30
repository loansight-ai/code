"""CSV contract tests runnable with the Python standard library."""

import csv
import tempfile
import unittest
from datetime import date
from pathlib import Path

from app.modules.company.exported import SCHEMAS, ExportError, load_dataset


def write_dataset(directory, *, amount="9007199254740993", scope="CFS"):
    financial = dict.fromkeys(SCHEMAS["financial"][1], "")
    financial.update(
        corp_code="00164478",
        corp_name="현대건설",
        bsns_year="2025",
        fs_div=scope,
        rcept_no="20260318001395",
        bs_ta=amount,
        bs_cash="0",
    )
    event = dict.fromkeys(SCHEMAS["events"][1], "")
    event.update(
        id="1",
        corp_code="00164478",
        corp_name="현대건설",
        rcept_no="20260318001395",
        event_date="2026-03-18",
        rcept_dt="2026-03-18",
        use="라벨후보",
        is_first_of_type="t",
        detail="첫 문단\n다음 문단, 인용",
    )
    coverage = dict.fromkeys(SCHEMAS["coverage"][1], "")
    coverage.update(
        corp_code="00164478",
        corp_name="현대건설",
        filings_b_count="0",
        filings_i_count="0",
        audit_api_calls="1",
        label_candidates="1",
        audit_doc_reports="2",
        audit_doc_ok="1",
    )
    rows = {"financial": [financial], "events": [event], "coverage": [coverage]}
    save_rows(directory, rows)
    return rows


def save_rows(directory, tables):
    for key, rows in tables.items():
        stem, columns = SCHEMAS[key]
        with (directory / f"{stem}_20261030.csv").open(
            "w", encoding="utf-8-sig", newline=""
        ) as handle:
            writer = csv.DictWriter(handle, fieldnames=sorted(columns))
            writer.writeheader()
            writer.writerows(rows)


def load(directory):
    return load_dataset(directory, date(2026, 10, 30), date(2026, 10, 26))


class ExportContractTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.rows = write_dataset(self.directory)

    def test_preserves_identifiers_exact_amount_null_zero_and_multiline(self):
        data = load(self.directory)
        row = data.financial[0]
        self.assertEqual(row["corp_code"], "00164478")
        self.assertEqual(row["bs_ta"], "9007199254740993")
        self.assertEqual(row["bs_cash"], "0")
        self.assertIsNone(row["bs_ar"])
        self.assertEqual(data.events[0]["detail"], "첫 문단\n다음 문단, 인용")
        self.assertIsNone(data.events[0]["verified"])
        self.assertIs(data.events[0]["is_first_of_type"], True)
        self.assertEqual(data.warnings["incomplete_audit_companies"], 1)

    def test_same_files_have_same_signature_and_changes_create_new_version(self):
        first = load(self.directory)
        self.assertEqual(first.signature, load(self.directory).signature)
        write_dataset(self.directory, amount="42")
        self.assertNotEqual(first.signature, load(self.directory).signature)

    def test_duplicate_financial_key_rejected_but_different_scope_allowed(self):
        self.rows["financial"].append(dict(self.rows["financial"][0]))
        save_rows(self.directory, self.rows)
        with self.assertRaisesRegex(ExportError, "duplicate financial"):
            load(self.directory)
        self.rows["financial"][1]["fs_div"] = "OFS"
        save_rows(self.directory, self.rows)
        self.assertEqual(len(load(self.directory).financial), 2)

    def test_events_require_coverage_but_not_financial_data(self):
        row = dict(self.rows["coverage"][0], corp_code="00000002", label_candidates="0")
        self.rows["coverage"].append(row)
        save_rows(self.directory, self.rows)
        self.assertEqual(load(self.directory).warnings["coverage_without_financial"], 1)
        self.rows["events"][0]["corp_code"] = "00000003"
        save_rows(self.directory, self.rows)
        with self.assertRaisesRegex(ExportError, "missing from coverage"):
            load(self.directory)

    def test_rejects_invalid_types_and_mismatched_counts(self):
        for key, value in (
            ("fs_div", "UNKNOWN"),
            ("bs_ta", "NaN"),
            ("bs_ta", "oops"),
            ("corp_code", "164478"),
        ):
            with self.subTest(key=key, value=value):
                original = self.rows["financial"][0][key]
                self.rows["financial"][0][key] = value
                save_rows(self.directory, self.rows)
                with self.assertRaises(ExportError):
                    load(self.directory)
                self.rows["financial"][0][key] = original
        self.rows["coverage"][0]["label_candidates"] = "0"
        save_rows(self.directory, self.rows)
        with self.assertRaisesRegex(ExportError, "label_candidates"):
            load(self.directory)


if __name__ == "__main__":
    unittest.main()
