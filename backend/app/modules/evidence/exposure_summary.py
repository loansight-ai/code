"""Read-only composition of current, reviewed facts; no keyword-derived amounts."""

import calendar
import re
from collections import defaultdict
from datetime import date
from decimal import Decimal, localcontext

from sqlalchemy import select
from sqlalchemy import text as sql_text

from app.modules.company.exported import read_company_collection
from app.modules.evidence.fact_models import EvidenceFact
from app.modules.evidence.fact_schemas import FactInput
from app.modules.evidence.fact_sources import resolve
from app.modules.evidence.fact_validation import validate

TYPES = {
    "PF_GUARANTEE": "PF 대출보증",
    "COMPLETION_SUPPORT": "책임준공 미이행 시 채무인수",
    "FUNDING_SUPPORT": "자금보충",
    "BUYER_GUARANTEE": "수분양자 중도금 보증",
    "OTHER": "기타 보증·조건부 의무",
}
ROLES = {
    "limit": "LIMIT",
    "commitment": "COMMITMENT",
    "loan_balance": "LOAN_BALANCE",
    "related_party": "RELATED_PARTY",
}


def decimal(value, *, allow_negative=False):
    if value is None:
        return None
    result = Decimal(str(value))
    return result if result.is_finite() and (allow_negative or result >= 0) else None


def total(values):
    return sum(values, Decimal(0)) if values and all(v is not None for v in values) else None


def text(value):
    return format(value, "f") if value is not None else None


def maturity_date(value):
    if not value or not re.fullmatch(r"\d{4}[-./]\d{2}[-./]\d{2}", value.strip()):
        return None
    try:
        return date.fromisoformat(re.sub(r"[./]", "-", value.strip()))
    except ValueError:
        return None


def boundaries(period):
    year, month = map(int, period.split("."))
    start = date(year, month, calendar.monthrange(year, month)[1])
    end = date(year + 1, month, min(start.day, calendar.monthrange(year + 1, month)[1]))
    return start, end


def measure(records):
    """One source cell/role is one observation, even if imported twice."""
    cells = defaultdict(list)
    for r in records:
        cell = r["data"]["amount"]["cell"]
        cells[(cell["segment_id"], cell["row"], cell["column"])].append(r)
    result = []
    for entries in cells.values():
        if len({r["value"] for r in entries}) != 1:
            return None
        result.append(entries[0]["value"])
    return total(result)


def select_level(records):
    detail = [r for r in records if r["data"].get("aggregation_level") == "DETAIL"]
    if detail:
        return detail
    totals = [r for r in records if r["data"].get("aggregation_level") == "TOTAL"]
    # A subtotal cannot establish the complete universe. Conflicting total rows are not added.
    rows = {
        (r["data"]["amount"]["cell"]["segment_id"], r["data"]["amount"]["cell"]["row"])
        for r in totals
    }
    return totals if len(rows) == 1 else []


def source_refs(records):
    return list({r["source"]["segment_id"]: r["source"] for r in records}.values())


def composition(records, direction):
    groups = defaultdict(list)
    for r in records:
        d = r["data"]
        if d["kind"] == "guarantee" and d["direction"] == direction:
            groups[d.get("obligation_type")].append(r)
    rows, selected_all, incomplete = [], [], False
    for kind, entries in groups.items():
        # Different source tables can repeat the same exposure. Require reconciliation first.
        proposed = select_level(entries)
        sources = {r["source"]["segment_id"] for r in proposed}
        selected = proposed if len(sources) == 1 and kind in TYPES else []
        values = {
            key: measure([r for r in selected if r["data"]["amount_role"] == role])
            for key, role in ROLES.items()
        }
        projects = defaultdict(set)
        for r in selected:
            projects[r["data"]["amount"]["cell"]["row"]].add(r["data"].get("project_count"))
        reported_counts = {
            r["data"]["project_count"]
            for r in entries
            if r["data"].get("aggregation_level") == "TOTAL"
            and r["data"].get("project_count") is not None
        }
        # Separate obligations/maturity rows can belong to the same project.
        # Only a directly reported total or a single row can establish project count.
        count = next(iter(reported_counts)) if len(reported_counts) == 1 else None
        if not reported_counts and len(projects) == 1:
            candidates = next(iter(projects.values()))
            if len(candidates) == 1:
                count = next(iter(candidates))
        rows.append(
            {
                "type": kind or "UNCLASSIFIED",
                "label": TYPES.get(kind, "유형 미확인"),
                "project_count": count,
                "values": {k: text(v) for k, v in values.items()},
                "sources": source_refs(entries),
                "aggregation_ready": bool(selected),
                "level": selected[0]["data"].get("aggregation_level") if selected else "UNKNOWN",
            }
        )
        selected_all.extend(selected)
        incomplete |= not selected or values["loan_balance"] is None
    amounts = {k: total([decimal(r["values"][k]) for r in rows]) for k in ROLES}
    if incomplete:
        amounts["loan_balance"] = None
    return {
        "rows": rows,
        "totals": {k: text(v) for k, v in amounts.items()},
        "complete": bool(rows) and not incomplete,
    }, selected_all


def maturity(records, start, end):
    buckets = {"within": [], "beyond": [], "undisclosed": [], "overdue": []}
    for r in records:
        d = maturity_date(r["data"].get("maturity"))
        key = (
            "undisclosed"
            if d is None
            else "overdue"
            if d < start
            else "within"
            if d <= end
            else "beyond"
        )
        buckets[key].append(r["value"])
    values = {k: sum(v, Decimal(0)) if records else None for k, v in buckets.items()}
    amount = sum((r["value"] for r in records), Decimal(0))
    percent = values["within"] / amount * 100 if amount else None
    return {
        "values": {k: text(v) for k, v in values.items()},
        "within_percent": text(percent),
        "total": text(amount) if records else None,
        "sources": source_refs(records),
        "items": [
            {
                "label": r["data"]["statement"],
                "amount": text(r["value"]),
                "maturity": r["data"].get("maturity"),
                "source": r["source"],
            }
            for r in records
        ],
    }


def unique_items(records):
    grouped = defaultdict(list)
    for r in records:
        c = r["data"]["amount"]["cell"]
        grouped[(c["segment_id"], c["row"], c["column"])].append(r)
    return [v[0] for v in grouped.values() if len({r["value"] for r in v}) == 1]


def litigation(records, nonmonetary):
    nonmonetary = [
        r
        for r in nonmonetary
        if r["data"]["kind"] == "litigation" and r["data"]["direction"] == "DEFENDANT"
    ]
    cases = [
        r
        for r in records
        if r["data"]["kind"] == "litigation" and r["data"]["direction"] == "DEFENDANT"
    ]
    grouped = defaultdict(list)
    for r in cases:
        number = r["data"].get("case_number")
        grouped[re.sub(r"\s+", "", number) if number else None].append(r)
    details = []
    for number, entries in grouped.items():
        if number is None:
            continue
        # One case may have several sources; repeated reported claims are never summed.
        claim = {r["value"] for r in entries if r["data"]["amount_role"] == "CLAIM"}
        if len(claim) == 1:
            details.append(
                {
                    "case_number": number,
                    "label": entries[0]["data"]["statement"],
                    "claim": text(next(iter(claim))),
                    "sources": source_refs(entries),
                }
            )
    official = [r for r in cases if r["data"].get("aggregation_level") == "TOTAL"]
    claims = {r["value"] for r in official if r["data"]["amount_role"] == "CLAIM"}
    provisions = {r["value"] for r in official if r["data"]["amount_role"] == "PROVISION"}
    counts = {
        r["data"].get("case_count")
        for r in [*official, *nonmonetary]
        if r["data"]["kind"] == "litigation"
        and r["data"]["direction"] == "DEFENDANT"
        and r["data"].get("aggregation_level") == "TOTAL"
        and r["data"].get("case_count") is not None
    }
    return {
        "case_count": next(iter(counts)) if len(counts) == 1 else None,
        "claim": text(next(iter(claims))) if len(claims) == 1 else None,
        "provision": text(next(iter(provisions))) if len(provisions) == 1 else None,
        "top_cases": sorted(details, key=lambda r: Decimal(r["claim"]), reverse=True)[:3],
        "sources": source_refs([*cases, *nonmonetary]),
        "plaintiff_facts": sum(
            r["data"]["kind"] == "litigation" and r["data"]["direction"] == "PLAINTIFF"
            for r in records
        ),
    }


def build_summary(bundle, records, nonmonetary=(), equity=None):
    with localcontext() as ctx:
        ctx.prec = 60
        start, end = boundaries(bundle.period)
        provided, chosen = composition(records, "PROVIDED")
        received, _ = composition(records, "RECEIVED")
        loan = decimal(provided["totals"]["loan_balance"])
        capital = decimal(equity, allow_negative=True)
        ratio = loan / capital * 100 if loan is not None and capital and capital > 0 else None
        debts = [
            r
            for r in records
            if r["data"]["kind"] == "borrowing_maturity"
            and r["data"]["amount_role"] == "BALANCE"
            and r["data"].get("aggregation_level") == "DETAIL"
        ]
        # Mixed tables can duplicate the same debt; do not silently combine them.
        if len({r["source"]["segment_id"] for r in debts}) > 1:
            debts = []
        return {
            "bundle_id": str(bundle.id),
            "bundle_revision": bundle.fingerprint,
            "period": bundle.period,
            "scope": bundle.scope,
            "as_of": start.isoformat(),
            "cutoff": end.isoformat(),
            "currency": "KRW",
            "unit": "원",
            "provided": provided,
            "received": received,
            "equity": text(capital),
            "ratio_percent": text(ratio),
            "maturity": {
                "debt": maturity(unique_items(debts), start, end),
                "obligation": maturity(
                    unique_items([r for r in chosen if r["data"]["amount_role"] == "LOAN_BALANCE"]),
                    start,
                    end,
                ),
            },
            "litigation": litigation(records, nonmonetary),
        }


async def read_summary(db, tools, database):
    await db.execute(
        sql_text("SELECT pg_advisory_xact_lock_shared(:key)"),
        {"key": int(tools.bundle.fingerprint[:15], 16)},
    )
    rows = list(
        (
            await db.scalars(
                select(EvidenceFact)
                .where(
                    EvidenceFact.bundle_id == tools.bundle.id,
                    EvidenceFact.state.in_(["PENDING", "APPROVED"]),
                )
                .order_by(EvidenceFact.created_at, EvidenceFact.id)
                .with_for_update(read=True)
            )
        ).all()
    )
    conflicts = defaultdict(set)
    for row in rows:
        if row.state == "APPROVED":
            conflicts[row.comparison_key].add(row.value_key)
    records, nonmonetary, excluded = [], [], 0
    for row in rows:
        if row.data["kind"] not in {"guarantee", "borrowing_maturity", "litigation"}:
            continue
        if (
            row.state != "APPROVED"
            or row.data.get("period") != tools.bundle.period
            or len(conflicts[row.comparison_key]) > 1
        ):
            excluded += 1
            continue
        fact = FactInput.model_validate(row.data)
        checked = await validate(tools, fact)
        if (
            checked["status"] != "CITATIONS_VALID"
            or checked["source_digest"] != row.validation.get("source_digest")
            or fact.detection != "DETECTED"
        ):
            excluded += 1
            continue
        sid = fact.amount.cell.segment_id if fact.amount else fact.citations[0].segment_id
        source = await resolve(tools, sid)
        ref = {"segment_id": str(sid), "title": source["title"], "scope": source["scope"]}
        if source["scope"] != tools.bundle.scope:
            excluded += 1
            continue
        entry = {"data": row.data, "source": ref, "value": decimal(checked["normalized_amount"])}
        if not fact.amount:
            nonmonetary.append(entry)
        elif fact.amount.currency == "KRW" and entry["value"] is not None:
            records.append(entry)
        else:
            excluded += 1
    equity = None
    b = tools.bundle
    # The immutable CSV has annual rows; non-December periods cannot be inferred.
    if b.collection_import_id and b.period.endswith(".12"):
        collection = await read_company_collection(
            database, b.collection_import_id, b.corp_code, b.receipt_no, b.scope, int(b.period[:4])
        )
        if len(collection["financial"]) == 1:
            equity = collection["financial"][0].get("bs_te")
    ambiguous = defaultdict(set)
    for r in records:
        cell = r["data"]["amount"]["cell"]
        key = (
            cell["segment_id"],
            cell["row"],
            cell["column"],
            r["data"]["kind"],
            r["data"]["amount_role"],
        )
        ambiguous[key].add(
            (
                r["value"],
                r["data"]["direction"],
                r["data"].get("obligation_type"),
                r["data"].get("aggregation_level"),
                r["data"].get("maturity"),
            )
        )
    clean = []
    for r in records:
        cell = r["data"]["amount"]["cell"]
        key = (
            cell["segment_id"],
            cell["row"],
            cell["column"],
            r["data"]["kind"],
            r["data"]["amount_role"],
        )
        if len(ambiguous[key]) == 1:
            clean.append(r)
        else:
            excluded += 1
    result = build_summary(b, clean, nonmonetary, equity)
    result["excluded_facts"] = excluded
    return result
