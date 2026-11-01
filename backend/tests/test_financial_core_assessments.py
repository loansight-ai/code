import copy
import unittest
from decimal import Decimal
from unittest.mock import patch

from app.modules.financial.core_assessments import (
    assess_core_metrics,
    boundary_proximity,
    relative_band,
    with_core_assessments,
)
from app.modules.financial.core_benchmarks import build_benchmark, dataset, with_core_benchmark
from app.modules.financial.domain import map_facts


def result(key="current_ratio", current="118.4", industry="제조", **context):
    return {
        "industry": industry,
        "context": {
            "fiscal_year": "2025",
            "period": "2025.12",
            "scope": "OFS",
            "lease": "include",
            **context,
        },
        "metrics": [
            {
                "key": key,
                "unit": "배" if key == "interest_coverage" else "%",
                "values": [{"period": "current", "value": current, "state": "CONFIRMED"}],
            }
        ],
        "facts": [
            {"key": k, "period": "current", "value": "100", "state": "CONFIRMED"}
            for k in ("equity", "current_liabilities", "revenue", "assets", "interest_expense")
        ],
    }


def assessment(data, key="current_ratio"):
    return next(item for item in assess_core_metrics(data) if item["key"] == key)


class CoreAssessmentsTest(unittest.TestCase):
    def test_capital_mapping_supports_partial_impairment_without_guessing_missing_capital(self):
        data = result("debt_ratio", "50")
        data["facts"] = map_facts(
            [
                {
                    "sj_div": "BS",
                    "account_id": "ifrs-full_Equity",
                    "account_nm": "자본총계",
                    "currency": "KRW",
                    "thstrm_amount": "100",
                },
                {
                    "sj_div": "BS",
                    "account_id": "ifrs-full_IssuedCapital",
                    "account_nm": "자본금",
                    "currency": "KRW",
                    "thstrm_amount": "200",
                },
            ]
        )
        self.assertIn("부분자본잠식", assessment(data, "debt_ratio")["flags"])
        data["facts"] = [f for f in data["facts"] if f["key"] != "capital"]
        self.assertNotIn("부분자본잠식", assessment(data, "debt_ratio")["flags"])

    def test_unreadable_reference_file_withholds_comparison_without_losing_own_values(self):
        data = result()
        with patch("app.modules.financial.core_benchmarks.dataset", side_effect=ValueError):
            decorated = with_core_assessments(data)
        self.assertEqual(decorated["metrics"], data["metrics"])
        self.assertEqual(decorated["core_ratio_benchmark"]["version"], "unavailable")
        self.assertFalse(decorated["core_card_assessments"][0]["comparison_allowed"])

    def test_actual_csv_dimensions_exact_year_and_unit_conversion(self):
        self.assertEqual(len(dataset()[0]), 200)
        benchmark = build_benchmark(result())
        self.assertEqual(benchmark["industry_code"], "C10-34")
        self.assertEqual(len(benchmark["version"]), 64)
        current = benchmark["metrics"][0]
        self.assertEqual(current["median"], "166.550495")
        self.assertEqual([r["year"] for r in current["history"]], list(range(2021, 2026)))
        coverage = next(m for m in benchmark["metrics"] if m["key"] == "interest_coverage")
        self.assertEqual(coverage["median"], "2.01")
        self.assertEqual(coverage["q1"], "-2.504")
        self.assertEqual(coverage["q3"], "18.195")
        self.assertEqual(coverage["aggregate"], "5.3733")

    def test_exact_quartile_and_median_boundaries_use_value_order_for_debt_too(self):
        cases = [
            ("current_ratio", "94", "하위 25% 구간"),
            ("current_ratio", "94.448537", "25~50% 구간"),
            ("current_ratio", "166.550495", "50~75% 구간"),
            ("current_ratio", "349.47898", "50~75% 구간"),
            ("current_ratio", "349.478981", "상위 25% 구간"),
            ("debt_ratio", "102", "상위 25% 구간"),
            ("debt_ratio", "101.992157", "50~75% 구간"),
            ("debt_ratio", "53.131086", "50~75% 구간"),
        ]
        for key, current, expected in cases:
            with self.subTest(key=key, current=current):
                item = assessment(result(key, current), key)
                self.assertEqual(item["status"], "RELATIVE_POSITION")
                self.assertEqual(item["label"], expected)
                self.assertTrue(item["comparison_allowed"])
                self.assertEqual(item["reference"]["kind"], "INDUSTRY_MEDIAN")

    def test_fixed_reference_no_longer_drives_status(self):
        self.assertEqual(assessment(result())["label"], "25~50% 구간")
        # 2.5 < old 3x reference but > actual median 2.01x.
        self.assertEqual(
            assessment(result("interest_coverage", "2.5"), "interest_coverage")["label"],
            "50~75% 구간",
        )

    def test_scope_period_formula_lease_and_property_mismatches_are_on_hold(self):
        cases = [
            result(scope="CFS"),
            result(period="2025.06"),
            result("debt_ratio", "200", lease="exclude"),
            result("operating_roa", "1"),
            result(
                "interest_coverage",
                "1",
                industry="부동산 임대",
                fiscal_year="2016",
                period="2016.12",
            ),
            result(industry=None),
        ]
        for data in cases:
            key = data["metrics"][0]["key"]
            with self.subTest(context=data["context"], key=key, industry=data["industry"]):
                item = assessment(data, key)
                self.assertIn(item["status"], ("BENCHMARK_PENDING", "NOT_COMPARABLE"))
                self.assertFalse(item["comparison_allowed"])

    def test_nonpositive_denominators_and_approximate_values_do_not_get_ranked(self):
        for key, denominator in [
            ("current_ratio", "current_liabilities"),
            ("operating_margin", "revenue"),
            ("interest_coverage", "interest_expense"),
        ]:
            for value in ("0", "-1", None):
                data = result(key, "1")
                next(f for f in data["facts"] if f["key"] == denominator)["value"] = value
                self.assertFalse(assessment(data, key)["comparison_allowed"])
        data = result()
        data["metrics"][0]["values"][0]["state"] = "APPROXIMATE"
        self.assertFalse(assessment(data)["comparison_allowed"])
        data["metrics"][0]["unit"] = "배"
        self.assertFalse(assessment(data)["comparison_allowed"])

    def test_capital_impairment_overrides_relative_rating(self):
        for value in ("0", "-1"):
            data = result("debt_ratio", "-10")
            next(f for f in data["facts"] if f["key"] == "equity")["value"] = value
            item = assessment(data, "debt_ratio")
            self.assertEqual(item["status"], "CAPITAL_REVIEW")
            self.assertEqual(item["label"], "자본잠식 여부 확인 필요")
            self.assertFalse(item["comparison_allowed"])
            self.assertIsNone(item["band"])
        data = result("debt_ratio", "50")
        data["facts"].append(
            {"key": "capital", "period": "current", "value": "200", "state": "CONFIRMED"}
        )
        self.assertIn("부분자본잠식", assessment(data, "debt_ratio")["flags"])

    def test_operating_loss_is_separate_from_quartile_position(self):
        data = result("operating_margin", "-1")  # Between Q1 -3.4 and median 3.5.
        data["facts"].append(
            {"key": "operating_profit", "period": "current", "value": "-1", "state": "CONFIRMED"}
        )
        item = assessment(data, "operating_margin")
        self.assertEqual(item["status"], "RELATIVE_POSITION")
        self.assertIn("영업적자", item["flags"])

    def test_missing_year_and_quartile_are_not_filled_with_zero_or_other_years(self):
        item = assessment(result(fiscal_year="2015", period="2015.12"))
        self.assertFalse(item["comparison_allowed"])
        self.assertIsNone(item["reference"])
        self.assertIn("미확보", item["reason"])
        benchmark = build_benchmark(result(industry="부동산 임대"))
        roa = next(m for m in benchmark["metrics"] if m["key"] == "operating_roa")
        self.assertIsNone(roa["median"])
        data = with_core_benchmark(result())
        data["core_ratio_benchmark"]["metrics"][0]["q1"] = None
        self.assertFalse(assessment(data)["comparison_allowed"])

    def test_read_decoration_and_pinned_reference_are_immutable(self):
        data = result()
        saved = copy.deepcopy(data)
        decorated = with_core_assessments(data)
        self.assertEqual(data, saved)
        with patch(
            "app.modules.financial.core_benchmarks.build_benchmark", side_effect=AssertionError
        ):
            repeated = with_core_assessments(decorated)
        self.assertEqual(repeated, decorated)
        self.assertIsNone(with_core_assessments(None))
        self.assertIn("ECOS/OFS 출처", decorated["core_ratio_benchmark"]["source_note"])

    def test_provenance_sample_size_and_unrounded_ci_precision(self):
        benchmark = build_benchmark(result())
        liquidity = benchmark["metrics"][0]
        self.assertEqual(liquidity["source_kind"], "OFS")
        self.assertEqual(liquidity["sample_count"], 1676)
        self.assertEqual(liquidity["q1_ci_low"], "90.27952073798397")
        self.assertEqual(liquidity["resampling_change_rate"], "0.026611455847255373")
        coverage = next(m for m in benchmark["metrics"] if m["key"] == "interest_coverage")
        self.assertEqual(coverage["source_kind"], "ECOS")
        self.assertIsNone(coverage["sample_count"])
        retail = build_benchmark(result("interest_coverage", industry="도소매"))
        row = next(m for m in retail["metrics"] if m["key"] == "interest_coverage")
        self.assertEqual(row["median"], "1.17361476")
        self.assertEqual(Decimal(row["q1_ci_low"]), Decimal("-279.97352623662334") / 100)
        self.assertEqual(row["resampling_change_rate"], "0.08576024844720496")

    def test_all_three_boundaries_and_valid_order_are_required(self):
        for field in ("q1", "median", "q3"):
            data = with_core_benchmark(result())
            data["core_ratio_benchmark"]["metrics"][0][field] = None
            self.assertEqual(assessment(data)["label"], "비교 기준 확인 중")
        data = with_core_benchmark(result())
        data["core_ratio_benchmark"]["metrics"][0]["q1"] = "999"
        self.assertFalse(assessment(data)["comparison_allowed"])

    def test_equal_boundaries_apply_conditions_in_order(self):
        d = Decimal
        for value, expected in (("99.99999", 0), ("100", 2), ("100.00001", 3)):
            self.assertEqual(relative_band(d(value), d(100), d(100), d(100)), expected)

    def test_ci_endpoints_ecos_exclusion_and_invalid_ci_internal_state(self):
        data = with_core_benchmark(result())
        row = data["core_ratio_benchmark"]["metrics"][0]
        for point in (row["q1_ci_low"], row["q1_ci_high"]):
            self.assertEqual(boundary_proximity(Decimal(point), row), "NEAR")
        self.assertEqual(boundary_proximity(Decimal("999999"), row), "OUTSIDE")
        row["q1_ci_low"], row["q1_ci_high"] = "20", "10"
        self.assertEqual(boundary_proximity(Decimal("999999"), row), "UNKNOWN")
        for field in ("q1", "median", "q3"):
            row[f"{field}_ecos"] = True
        self.assertEqual(boundary_proximity(Decimal("15"), row), "NOT_APPLICABLE")
        data["metrics"][0]["values"][0]["value"] = "15"
        self.assertIsNone(assessment(data)["boundary_note"])

    def test_rental_rows_use_actual_industry_and_partial_rows_stay_pending(self):
        current = assessment(result(industry="부동산 임대"))
        self.assertTrue(current["comparison_allowed"])
        old = assessment(
            result(
                "interest_coverage",
                "1",
                industry="부동산 임대",
                fiscal_year="2016",
                period="2016.12",
            ),
            "interest_coverage",
        )
        self.assertEqual(old["label"], "비교 기준 확인 중")
        self.assertIn("부동산업", old["reason"])
        roa = assessment(result("operating_roa", "1", industry="부동산 임대"), "operating_roa")
        self.assertIn("손익기간 미확인", roa["reason"])

    def test_comparison_uses_formula_inputs_before_display_rounding(self):
        data = with_core_benchmark(result(current="100"))
        data["facts"].append(
            {
                "key": "current_assets",
                "period": "current",
                "value": "99.99999",
                "state": "CONFIRMED",
            }
        )
        row = data["core_ratio_benchmark"]["metrics"][0]
        row.update(q1="100", median="150", q3="200")
        self.assertEqual(assessment(data)["label"], "하위 25% 구간")

    def test_legacy_pinned_display_upgrades_without_mutating_saved_snapshot(self):
        data = result()
        data["core_ratio_benchmark"] = {"version": "old-csv-hash", "metrics": []}
        original = copy.deepcopy(data)
        decorated = with_core_assessments(data)
        self.assertEqual(data, original)
        self.assertEqual(
            decorated["core_ratio_benchmark"]["source_file"], "2016-2025_화면비교기준.csv"
        )


if __name__ == "__main__":
    unittest.main()
