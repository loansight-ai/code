import unittest

from app.modules.financial.domain import map_facts


def row(account, value, statement="CF", name="현금 계정"):
    return {
        "account_id": account,
        "account_nm": name,
        "sj_div": statement,
        "currency": "KRW",
        "thstrm_amount": value,
        "frmtrm_amount": "80",
        "bfefrmtrm_amount": "60",
    }


def fact(facts, key):
    return next(item for item in facts if item["key"] == key and item["period"] == "current")


class CashBalancesTest(unittest.TestCase):
    def test_cash_endpoints_preserve_zero_and_cashflow_sources(self):
        facts = map_facts([
            row("dart_CashAndCashEquivalentsAtBeginningOfPeriodCf", "0"),
            row("-표준계정코드 미사용-", "120", name="기말 현금 및 현금성자산"),
            row("ifrs-full_CashAndCashEquivalents", "999", statement="BS"),
        ])
        self.assertEqual(fact(facts, "cash_beginning")["value"], "0")
        self.assertEqual(fact(facts, "cash_ending")["value"], "120")
        self.assertEqual(fact(facts, "cash_ending")["sources"][0]["statement"], "CF")

    def test_bs_or_unknown_standard_ids_are_not_cashflow_endpoints(self):
        facts = map_facts([
            row("ifrs-full_CashAndCashEquivalents", "999", statement="BS"),
            row("ifrs-full_UnknownAccount", "888", name="기말현금및현금성자산"),
        ])
        for key in ("cash_beginning", "cash_ending"):
            self.assertEqual(fact(facts, key)["state"], "MISSING")

    def test_conflicting_endpoints_remain_ambiguous(self):
        facts = map_facts([
            row("dart_CashAndCashEquivalentsAtEndOfPeriodCf", "100"),
            row("dart_CashAndCashEquivalentsAtEndOfPeriodCf", "101"),
        ])
        self.assertEqual(fact(facts, "cash_ending")["reason"], "ambiguous_account")
