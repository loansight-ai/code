import copy
import unittest

from app.modules.financial.core_assessments import assess_core_metrics, with_core_assessments


def result(key, current, previous="5", industry="제조", state="CONFIRMED", equity=None):
    return {
        "industry": industry,
        "metrics": [{"key": key, "values": [
            {"period": "current", "value": current, "state": state},
            {"period": "previous", "value": previous, "state": "CONFIRMED"},
        ]}],
        "facts": [] if equity is None else [
            {"key": "equity", "period": "current", "value": equity, "state": "CONFIRMED"}
        ],
    }


def assessment(data, key):
    return next(item for item in assess_core_metrics(data) if item["key"] == key)


class CoreAssessmentsTest(unittest.TestCase):
    def test_user_authorized_team_thresholds(self):
        cases = [("current_ratio", "118.4", "CAUTION", "150"),
                 ("debt_ratio", "212.7", "WARNING", "200"),
                 ("interest_coverage", "1.6", "CAUTION", "3")]
        for key, value, status, reference in cases:
            with self.subTest(key=key):
                item = assessment(result(key, value), key)
                self.assertEqual(item["status"], status)
                self.assertEqual(item["reference"]["value"], reference)
                self.assertEqual(item["reference"]["kind"], "TEAM_HYPOTHESIS")

    def test_exact_boundaries_are_not_threshold_violations(self):
        for key, value in [("current_ratio", "150"), ("debt_ratio", "200"),
                           ("interest_coverage", "3")]:
            with self.subTest(key=key):
                item = assessment(result(key, value, value), key)
                self.assertEqual(item["status"], "UNCHANGED")

    def test_profitability_uses_real_previous_value(self):
        item = assessment(result("operating_margin", "3.0", "4.1"), "operating_margin")
        self.assertEqual(item["status"], "DETERIORATING")
        self.assertEqual(item["reference"]["value"], "4.1")
        self.assertEqual(item["reference"]["kind"], "PREVIOUS")

    def test_missing_or_approximate_values_do_not_become_confirmed_risk(self):
        item = assessment(result("interest_coverage", None), "interest_coverage")
        self.assertEqual(item["status"], "UNAVAILABLE")
        item = assessment(result("interest_coverage", "0.5", state="APPROXIMATE"),
                          "interest_coverage")
        self.assertEqual(item["status"], "NOT_EVALUATED")

    def test_capital_impairment_is_independent_of_uncomputable_debt_ratio(self):
        item = assessment(result("debt_ratio", None, equity="0"), "debt_ratio")
        self.assertEqual(item["status"], "WARNING")
        self.assertIn("완전자본잠식", item["reason"])

    def test_industry_exclusions_are_kept(self):
        for industry, key, value in [("도소매", "current_ratio", "90"),
                                     ("건설", "debt_ratio", "240"),
                                     ("부동산 임대", "interest_coverage", "0.5")]:
            with self.subTest(industry=industry):
                item = assessment(result(key, value, industry=industry), key)
                self.assertEqual(item["status"], "CONTEXT_REQUIRED")

    def test_read_decoration_does_not_change_saved_snapshot(self):
        data = result("operating_margin", "3.0", "4.1")
        saved = copy.deepcopy(data)
        decorated = with_core_assessments(data)
        self.assertEqual(data, saved)
        self.assertIn("core_card_assessments", decorated)
        self.assertIsNone(with_core_assessments(None))


if __name__ == "__main__":
    unittest.main()
