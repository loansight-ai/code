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
from app.modules.evidence.maturity_ladder import build_ladder

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
    return list(
        {s["segment_id"]: s for r in records for s in r.get("sources", [r["source"]])}.values()
    )


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
    all_cases = [r for r in [*records, *nonmonetary] if r["data"]["kind"] == "litigation"]
    cases = [r for r in all_cases if r["data"]["direction"] == "DEFENDANT"]
    plaintiffs = [r for r in all_cases if r["data"]["direction"] == "PLAINTIFF"]

    def single(values):
        known = {v for v in values if v is not None and v != ""}
        return next(iter(known)) if len(known) == 1 else None

    def reported(entries, role):
        return single(
            r["value"]
            for r in entries
            if r["data"].get("aggregation_level") == "TOTAL" and r["data"]["amount_role"] == role
        )

    def reported_count(entries):
        return single(
            r["data"].get("case_count")
            for r in entries
            if r["data"].get("aggregation_level") == "TOTAL"
        )

    def metadata(entries, key):
        return single(r["data"].get(key) for r in entries)

    grouped = defaultdict(list)
    for r in cases:
        number = r["data"].get("case_number")
        grouped[re.sub(r"\s+", "", number) if number else None].append(r)
    details = []
    for number, entries in grouped.items():
        if number is None:
            continue
        # One case may have several sources; repeated reported claims are never summed.
        claim_entries = [
            r for r in entries if r["data"]["amount_role"] == "CLAIM" and r["value"] is not None
        ]
        claim = {r["value"] for r in claim_entries}
        if len(claim) == 1:
            details.append(
                {
                    "case_number": number,
                    "label": metadata(claim_entries, "statement") or number,
                    "claim": text(next(iter(claim))),
                    "filing_date": metadata(entries, "filing_date"),
                    "plaintiff": metadata(entries, "counterparty"),
                    "status": metadata(entries, "status"),
                    "sources": source_refs(entries),
                }
            )
    notes = defaultdict(list)
    for r in cases:
        if r["data"].get("case_note"):
            notes[r["data"]["case_note"]].append(r)
    return {
        "case_count": reported_count(cases),
        "claim": text(reported(cases, "CLAIM")),
        "provision": text(reported(cases, "PROVISION")),
        "top_cases": sorted(details, key=lambda r: Decimal(r["claim"]), reverse=True)[:3],
        "sources": source_refs(cases),
        "detected": bool(cases),
        "case_list_available": any(k is not None for k in grouped),
        "notes": [
            {"quote": quote, "sources": source_refs(entries)} for quote, entries in notes.items()
        ],
        "plaintiff": {
            "case_count": reported_count(plaintiffs),
            "claim": text(reported(plaintiffs, "CLAIM")),
            "sources": source_refs(plaintiffs),
        },
        "plaintiff_facts": sum(
            r["data"]["kind"] == "litigation" and r["data"]["direction"] == "PLAINTIFF"
            for r in records
        ),
    }


def build_summary(bundle, records, nonmonetary=(), equity=None, absences=(), unready=0):
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
        loans = unique_items([r for r in chosen if r["data"]["amount_role"] == "LOAN_BALANCE"])
        ladder = build_ladder(
            loans,
            start,
            provided["totals"]["loan_balance"],
            complete=provided["complete"],
            absences=absences,
            unready=unready,
            detected=bool(provided["rows"]),
        )
        obligation = maturity(loans, start, end)
        allocated = any(item["band"] != "UNDISCLOSED" for item in ladder["items"])
        by_band = {row["key"]: row["amount"] for row in ladder["bins"]}
        obligation.update(
            total=ladder["total"],
            within_percent=ladder["within_percent"],
            sources=ladder["sources"],
            availability_state=ladder["state"],
        )
        obligation["values"] = {
            "within": ladder["within_amount"],
            "beyond": text(
                sum((Decimal(by_band[k] or 0) for k in ("Y2", "Y3", "OVER3")), Decimal(0))
            )
            if allocated
            else None,
            "undisclosed": by_band["UNDISCLOSED"],
            "overdue": by_band.get("OVERDUE", "0") if loans else None,
        }
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
                "obligation": obligation,
            },
            "maturity_ladder": ladder,
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
    records, nonmonetary, absences, excluded, unready = [], [], [], 0, 0
    for row in rows:
        if row.data["kind"] not in {"guarantee", "borrowing_maturity", "litigation"}:
            continue
        provided_fact = row.data["kind"] == "guarantee" and row.data["direction"] == "PROVIDED"
        if (
            row.state != "APPROVED"
            or row.data.get("period") != tools.bundle.period
            or len(conflicts[row.comparison_key]) > 1
        ):
            excluded += 1
            unready += int(provided_fact)
            continue
        fact = FactInput.model_validate(row.data)
        checked = await validate(tools, fact)
        if checked["status"] != "CITATIONS_VALID" or checked["source_digest"] != row.validation.get(
            "source_digest"
        ):
            excluded += 1
            unready += int(provided_fact)
            continue
        sid = fact.amount.cell.segment_id if fact.amount else fact.citations[0].segment_id
        source = await resolve(tools, sid)
        ref = {"segment_id": str(sid), "title": source["title"], "scope": source["scope"]}
        if source["scope"] != tools.bundle.scope:
            excluded += 1
            unready += int(provided_fact)
            continue
        entry = {"data": row.data, "source": ref, "value": decimal(checked["normalized_amount"])}
        if fact.kind in {"litigation", "guarantee"}:
            references = {str(sid): ref}
            for cite in fact.citations:
                key = str(cite.segment_id)
                if key not in references:
                    cited = await resolve(tools, cite.segment_id)
                    references[key] = {
                        "segment_id": key,
                        "title": cited["title"],
                        "scope": cited["scope"],
                    }
            entry["sources"] = list(references.values())
        if fact.detection == "EXPLICITLY_NONE":
            if provided_fact:
                absences.append(entry)
            continue
        if not fact.amount:
            nonmonetary.append(entry)
            unready += int(provided_fact)
        elif fact.amount.currency == "KRW" and entry["value"] is not None:
            records.append(entry)
        else:
            excluded += 1
            unready += int(provided_fact)
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
                r["data"].get("maturity_bucket"),
                r["data"].get("loan_period"),
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
            unready += int(
                r["data"]["kind"] == "guarantee" and r["data"]["direction"] == "PROVIDED"
            )
    result = build_summary(b, clean, nonmonetary, equity, absences, unready)
    result["excluded_facts"] = excluded
    return result
