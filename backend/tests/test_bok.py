import copy
import json
import unittest
from decimal import Decimal
from pathlib import Path

from app.modules.financial.bok import build_benchmark, with_benchmark


def result():
    path = Path(__file__).resolve().parents[2] / "frontend/src/test/fixtures/financial-result.json"
    return json.loads(path.read_text(encoding="utf-8"))


def metric(benchmark, key):
    return next(m for m in benchmark["metrics"] if m["key"] == key)


class BokComparisonTests(unittest.TestCase):
    def test_real_source_year_mapping_and_percentage_to_multiple(self):
        data = result()
        snapshot = copy.deepcopy(data)
        actual = with_benchmark(data, "12000")
        benchmark = actual["bok_benchmark"]
        self.assertEqual(benchmark["industry_code"], "C10-34")
        self.assertIn("상위 업종", benchmark["mapping_note"])
        values = metric(benchmark, "current_ratio")["values"]
        self.assertEqual([v["year"] for v in values], [2025, 2024, 2023])
        self.assertEqual(values[0]["value"], "135.08")
        own = next(m for m in data["metrics"] if m["key"] == "current_ratio")
        self.assertEqual(
            Decimal(values[0]["gap"]), Decimal(own["values"][0]["value"]) - Decimal("135.08")
        )
        coverage = metric(benchmark, "interest_coverage")
        self.assertEqual(coverage["unit"], "배")
        self.assertIn("11065774", benchmark["source_url"])
        # Check the source-unit conversion independently against the CSV.
        import csv

        path = Path(__file__).resolve().parents[1] / "data/bok/bok_ratio_values.csv"
        with path.open(encoding="utf-8-sig", newline="") as source:
            row = next(
                r
                for r in csv.DictReader(source)
                if r["industry_code"] == "C10-34"
                and r["company_size_code"] == "전체"
                and r["year"] == "2025"
                and r["metric_code"] == "629"
            )
        self.assertEqual(Decimal(coverage["values"][0]["value"]), Decimal(row["value"]) / 100)
        self.assertEqual(data, snapshot)

    def test_longest_prefix_and_excluded_service_industries(self):
        self.assertEqual(build_benchmark(result(), "10740")["industry_code"], "C10")
        rental = build_benchmark(result(), "68112")
        self.assertEqual(rental["industry_code"], "L68")
        self.assertIn("상위 업종", rental["mapping_note"])
        for ksic in (None, "99999", "68221", "76300"):
            self.assertEqual(build_benchmark(result(), ksic)["status"], "UNAVAILABLE")

    def test_missing_year_and_missing_metric_do_not_use_another_statistic(self):
        data = result()
        data["context"].update(fiscal_year="2026", period="2026.12")
        benchmark = with_benchmark(data, "10740")["bok_benchmark"]
        values = metric(benchmark, "operating_margin")["values"]
        self.assertIsNone(values[0]["value"])
        self.assertIsNotNone(values[1]["value"])
        self.assertTrue(
            all(v["value"] is None for v in metric(benchmark, "operating_roa")["values"])
        )

    def test_scope_option_and_non_december_differences_withhold_only_gaps(self):
        for changes in ({"scope": "CFS"}, {"lease": "exclude"}, {"period": "2025.03"}):
            data = result()
            data["context"].update(changes)
            benchmark = with_benchmark(data, "10740")["bok_benchmark"]
            value = metric(benchmark, "debt_ratio")["values"][0]
            self.assertIsNotNone(value["value"])
            self.assertIsNone(value["gap"])
            self.assertIsNotNone(value["comparison_reason"])

    def test_snapshot_is_pinned_and_enrichment_recomputes_gap(self):
        data = with_benchmark(result(), "10740")
        own = next(m for m in data["metrics"] if m["key"] == "operating_margin")
        own["values"][0].update(value="100", state="CONFIRMED")
        updated = with_benchmark(data, "68112")["bok_benchmark"]
        self.assertEqual(updated["industry_code"], "C10")
        current = metric(updated, "operating_margin")["values"][0]
        self.assertEqual(Decimal(current["gap"]), Decimal(100) - Decimal(current["value"]))
        own["values"][0]["state"] = "APPROXIMATE"
        approximate = with_benchmark(data)["bok_benchmark"]
        self.assertIsNone(metric(approximate, "operating_margin")["values"][0]["gap"])


if __name__ == "__main__":
    unittest.main()
