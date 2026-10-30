from uuid import uuid4

import pytest

from app.modules.evidence.dart_collector import CollectionError
from app.modules.financial.collected import collection_facts
from app.modules.financial.domain import calculate


def source():
    current = {
        "corp_code": "00164478",
        "rcept_no": "20260318001395",
        "bsns_year": "2025",
        "fs_div": "CFS",
        "bs_ca": "30000000000",
        "bs_cl": "20000000000",
        "is_int_exp": "0",
        "bs_borrow": "500",
        "nt_pf": "0",
        "is_op": "100",
    }
    previous = {**current, "bsns_year": "2024", "rcept_no": "20250318001395", "fs_div": "OFS"}
    return {"import_id": str(uuid4()), "financial": [current], "history": [previous, current]}


def test_exact_csv_facts_reuse_calculator_without_scope_or_note_zero_fallback():
    facts = collection_facts(source(), {"fiscal_year": "2025", "scope": "CFS"})
    lookup = {(f["key"], f["period"]): f for f in facts}
    assert lookup["current_assets", "current"]["value"] == "30000000000"
    assert lookup["current_assets", "previous"]["value"] is None
    assert lookup["interest_expense", "current"]["reason"] == "collected_note_zero_unverified"
    assert lookup["note_borrowing_subtotal", "current"]["value"] is None
    metrics, _ = calculate(facts)
    ratio = next(m for m in metrics if m["key"] == "current_ratio")
    assert ratio["values"][0]["value"] == "150.0000"
    assert ratio["values"][1]["value"] is None


def test_missing_or_ambiguous_year_is_rejected():
    for financial in ([], source()["financial"] * 2):
        collection = source()
        collection["financial"] = financial
        with pytest.raises(CollectionError, match="collected_financial_not_found"):
            collection_facts(collection, {"fiscal_year": "2025", "scope": "CFS"})


def test_csv_borrowing_components_and_fourth_balance_year_restore_calculations():
    collection = source()
    current = collection["financial"][0]
    current.update(
        bs_stb="100",
        bs_cpltd="20",
        bs_ltb="200",
        bs_bond="30",
        bs_cbond="10",
        bs_clease="5",
        bs_nclease="15",
        bs_ta="1000",
        bs_ip="800",
        bs_nca="600",
        bs_ncl="300",
        bs_te="500",
        bs_inv="100",
        bs_ar="200",
        bs_ap="50",
        is_rev="1000",
        cf_int_paid="10",
        cf_tax_paid="20",
        cf_intan_acq="30",
    )
    collection["history"] = [
        {**current, "bsns_year": str(year), "rcept_no": f"{year + 1}0320000001"}
        for year in (2022, 2023, 2024)
    ] + [current]
    facts = collection_facts(collection, {"fiscal_year": "2025", "scope": "CFS"})
    lookup = {(f["key"], f["period"]): f for f in facts}
    assert lookup["current_long_borrowings", "current"]["value"] == "20"
    assert lookup["interest_paid", "current"]["value"] == "10"
    assert lookup["intangible_acquisition", "current"]["value"] == "30"
    assert lookup["assets", "opening_balance"]["sources"][0]["fiscal_year"] == "2022"
    metrics, totals = calculate(facts)
    values = {m["key"]: m["values"] for m in metrics}
    assert totals["current"] == "380"
    assert values["borrowing_ratio"][0]["value"] == "38.0000"
    assert values["short_borrowing_ratio"][0]["value"] == "26.3158"
    assert values["borrowing_investment_property"][0]["value"] == "47.5000"
    assert values["long_term_asset_fit"][0]["value"] == "75.0000"
    assert all(v["value"] == "10.0000" for v in values["inventory_turnover"])
    assert calculate(facts, "exclude")[1]["current"] == "360"
    current["bs_cpltd"] = None
    assert (
        calculate(collection_facts(collection, {"fiscal_year": "2025", "scope": "CFS"}))[1][
            "current"
        ]
        is None
    )
