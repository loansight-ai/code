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
