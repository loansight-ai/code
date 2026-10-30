"""Adapt an explicitly selected, immutable CSV collection to financial facts."""

import asyncio
import json
from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

from app.core.storage import LocalArtifactStore
from app.modules.company.exported import ExportError, read_company_collection
from app.modules.evidence.dart_collector import CollectionError
from app.modules.financial.domain import (
    ACCOUNTS,
    FORMULA_VERSION,
    MAPPING_VERSION,
    PERIODS,
    calculate,
    comparisons,
    note_borrowing_summaries,
)

# Only semantically matched fields. Broad borrowing subtotals and uncertain note
# columns are deliberately excluded; missing components never become zero.
COLUMNS = {
    "revenue": "is_rev",
    "operating_profit": "is_op",
    "net_profit": "is_ni",
    "cost_of_sales": "is_cogs",
    "gross_profit": "is_gp",
    "sga": "is_sga",
    "interest_expense": "is_int_exp",
    "assets": "bs_ta",
    "liabilities": "bs_tl",
    "equity": "bs_te",
    "current_assets": "bs_ca",
    "current_liabilities": "bs_cl",
    "inventory": "bs_inv",
    "receivables": "bs_ar",
    "payables": "bs_ap",
    "contract_assets": "bs_contract_a",
    "contract_liabilities": "bs_contract_l",
    "investment_property": "bs_ip",
    "short_borrowings": "bs_stb",
    "long_borrowings": "bs_ltb",
    "bonds": "bs_bond",
    "current_bonds": "bs_cbond",
    "current_lease": "bs_clease",
    "noncurrent_lease": "bs_nclease",
    "operating_cashflow": "cf_cfo",
    "investing_cashflow": "cf_cfi",
    "financing_cashflow": "cf_cff",
    "cash_beginning": "cf_cash_beg",
    "cash_ending": "cf_cash_end",
    "depreciation": "cf_dep",
    "amortisation": "cf_amort",
    "ppe_acquisition": "cf_capex",
}


def collection_facts(collection, context):
    year = int(context["fiscal_year"])
    selected = collection["financial"]
    if len(selected) != 1 or selected[0]["bsns_year"] != str(year):
        raise CollectionError("collected_financial_not_found")
    history = {
        int(r["bsns_year"]): r for r in collection["history"] if r["fs_div"] == context["scope"]
    }
    history[year] = selected[0]
    facts = []
    for account in ACCOUNTS:
        key, label = account[:2]
        column = COLUMNS.get(key)
        for offset, period in enumerate(PERIODS):
            row = history.get(year - offset)
            value = row.get(column) if row and column else None
            reason = None if value is not None else "collected_account_missing"
            # Note zeros may mean "not detected", not explicit absence.
            if key == "interest_expense" and value is not None and Decimal(value) == 0:
                value, reason = None, "collected_note_zero_unverified"
            facts.append(
                {
                    "key": key,
                    "label": label,
                    "period": period,
                    "value": value,
                    "state": "CONFIRMED" if value is not None else "MISSING",
                    "reason": reason,
                    "currency": "KRW",
                    "unit": "원",
                    "mapping_method": "csv_column" if value is not None else None,
                    "sources": [
                        {
                            "kind": "collected_csv",
                            "import_id": collection["import_id"],
                            "receipt_no": row["rcept_no"],
                            "scope": row["fs_div"],
                            "fiscal_year": row["bsns_year"],
                            "column": column,
                            "raw_amount": row.get(column),
                        }
                    ]
                    if row and column
                    else [],
                }
            )
    return facts


async def prepare_collected(database, settings, run_id, context, name, industry):
    from app.modules.financial.service import PreparedFinancials

    try:
        collection = await read_company_collection(
            database,
            UUID(context["source_import_id"]),
            context["corp_code"],
            context["receipt_no"],
            context["scope"],
            context["fiscal_year"],
        )
    except ExportError as exc:
        raise CollectionError("collected_financial_not_found") from exc
    facts = collection_facts(collection, context)
    raw = json.dumps(collection, ensure_ascii=False, sort_keys=True).encode()
    digest = await asyncio.to_thread(
        LocalArtifactStore(settings.artifact_root / "financial/originals").put, raw
    )
    metrics, totals = calculate(facts, context["lease"])
    changes, bridge = comparisons(facts)
    result = {
        "analysis_run_id": str(run_id),
        "context": context,
        "company_name": name,
        "industry": industry,
        "source_sha256": digest,
        "source_url": f"https://dart.fss.or.kr/dsaf001/main.do?rcpNo={context['receipt_no']}",
        "collected_at": datetime.now(UTC).isoformat(),
        "mapping_version": MAPPING_VERSION + "+collected-v1",
        "formula_version": FORMULA_VERSION,
        "periods": [
            {"key": p, "label": f"{int(context['fiscal_year']) - i} 사업연도"}
            for i, p in enumerate(PERIODS)
        ],
        "facts": facts,
        "metrics": metrics,
        "changes": changes,
        "profit_bridge": bridge,
        "borrowing_totals": totals,
        "note_borrowing_summaries": note_borrowing_summaries(facts, context["lease"]),
        "availability": "AVAILABLE",
        "note_state": "NOT_COLLECTED",
        "note_error": None,
        "note_candidates": [],
        "comparison_basis": (
            "수집 CSV의 각 사업연도 원보고서 값. 같은 회계 범위만 비교하며 "
            "정정·재작성 비교금액과 다를 수 있습니다."
        ),
        "collection_source": {
            "import_id": collection["import_id"],
            "source_as_of": collection["source_as_of"],
            "exported_on": collection["exported_on"],
        },
    }
    return PreparedFinancials(result, digest)
