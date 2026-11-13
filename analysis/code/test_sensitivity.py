"""Independent checks for boundary conventions and leave-one-out denominators."""

import unittest
from types import SimpleNamespace
import numpy as np
from run_sensitivity import assign, direction, loo_thresholds, analyze_series


class SensitivityTests(unittest.TestCase):
    """Check sensitivity calculations with synthetic observations."""

    def test_boundaries(self):
        """Verify tie handling and metric-specific unfavorable tails."""
        x = np.array([0.0, 7.5, 14.0, 15.0, 22.5, 30.0])
        q = np.array([7.5, 15.0, 22.5])
        self.assertEqual(assign(x, q).tolist(), [0, 1, 1, 2, 2, 3])
        self.assertEqual(
            direction(x, q, "부채비율").tolist(),
            [False, False, False, False, False, True],
        )
        self.assertEqual(
            direction(x, q, "유동비율").tolist(),
            [True, False, False, False, False, False],
        )

    def test_ties_and_every_loo_threshold(self):
        """Compare each leave-one-out boundary with direct NumPy quantiles."""
        for x in [
            np.array([0.0, 0.0, 1.0, 2.0, 2.0, 50.0, 100.0, 200.0, 200.0, 500.0]),
            np.ones(10),
            np.array([-50.0, -3.0, 0.0, 1.0, 2.0, 3.0, 8.0, 9.0, 10.0, 100.0]),
        ]:
            result = loo_thresholds(x)
            for i in range(len(x)):
                np.testing.assert_allclose(
                    result[i], np.quantile(np.delete(x, i), [0.25, 0.5, 0.75])
                )

    def test_loo_change_and_accounting(self):
        """Check change rates and counts against independent scalar classification."""
        x = np.array([0.0, 0.0, 1.0, 2.0, 2.0, 50.0, 100.0, 200.0, 200.0, 500.0])
        n = len(x)
        args = SimpleNamespace(iterations=1000, trim_percent=1.0, stress_percent=5.0)
        result, details, scenarios, transitions = analyze_series(
            x, [str(i) for i in range(n)], 2025, "시험업", "부채비율", args
        )
        q = np.quantile(x, [0.25, 0.5, 0.75])

        # Independent scalar classification, not the implementation's broadcasting.
        def classify(v, t):
            """Assign a band using explicit scalar comparisons for the reference test."""
            return 0 if v < t[0] else 3 if v > t[2] else 1 if v < t[1] else 2

        baseline = [classify(v, q) for v in x]
        rates = []
        for i in range(n):
            t = np.quantile(np.delete(x, i), [0.25, 0.5, 0.75])
            changed = sum(
                classify(v, t) != baseline[j] for j, v in enumerate(x) if j != i
            )
            rates.append(changed / (n - 1))
        self.assertAlmostEqual(result["LOO_4구간_평균변경률"], float(np.mean(rates)))
        self.assertAlmostEqual(result["LOO_4구간_최대변경률"], max(rates))
        self.assertAlmostEqual(
            result["bootstrap_4구간_평균변경률"],
            np.mean([v["bootstrap_4구간_변경빈도"] for v in details]),
        )
        self.assertEqual(
            sum(t["누적배정건수"] for t in transitions), n * args.iterations
        )
        result2, *_ = analyze_series(
            x, [str(i) for i in range(n)], 2025, "시험업", "부채비율", args
        )
        self.assertEqual(result, result2)


if __name__ == "__main__":
    unittest.main()
