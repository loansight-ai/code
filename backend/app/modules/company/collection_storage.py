"""Translate typed CSV columns to the existing analysis input contract."""

from datetime import date, datetime
from decimal import Decimal

from app.modules.company.collection_columns import COVERAGE_COUNTS, FINANCIAL_AMOUNTS, SCHEMAS

ALIASES = {
    "financial": {"bsns_year": "fiscal_year", "fs_div": "scope", "rcept_no": "receipt_no"},
    "events": {"id": "source_id", "rcept_no": "receipt_no"},
    "coverage": {},
}


def storage_values(kind, row):
    """Use Decimal throughout; never route source amounts through float."""
    values = {}
    for key, value in row.items():
        if key not in SCHEMAS[kind][1]:
            raise ValueError(f"unknown {kind} column: {key}")
        if value is not None:
            if kind == "financial" and key in FINANCIAL_AMOUNTS:
                value = Decimal(value)
            elif (
                (kind == "financial" and key == "bsns_year")
                or (kind == "events" and key == "id")
                or (kind == "coverage" and key in COVERAGE_COUNTS)
            ):
                value = int(value)
            elif key in {"event_date", "rcept_dt", "first_event_date"}:
                value = date.fromisoformat(value)
            elif key.endswith("_fetched_at"):
                value = datetime.fromisoformat(value)
        values[ALIASES[kind].get(key, key)] = value
    return values


def source_row(kind, record):
    """Keep source keys and string amounts compatible with existing consumers."""
    row = {}
    for key in sorted(SCHEMAS[kind][1]):
        value = getattr(record, ALIASES[kind].get(key, key))
        if isinstance(value, Decimal):
            value = format(value, "f")
        elif isinstance(value, (date, datetime)):
            value = value.isoformat()
        elif value is not None and (
            (kind == "financial" and key == "bsns_year") or (kind == "events" and key == "id")
        ):
            value = str(value)
        row[key] = value
    return row
