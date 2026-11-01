"""Disjoint calendar maturity bands for reviewed, provided loan balances."""

import calendar
import re
from datetime import date
from decimal import Decimal

BANDS = (
    ("M3", "3개월", 3),
    ("M6", "6개월", 6),
    ("M12", "12개월", 12),
    ("Y2", "1~2년", 24),
    ("Y3", "2~3년", 36),
    ("OVER3", "3년 초과", None),
)
BAND_PATTERNS = {
    "M3": r"3개월(?:이내|이하)|0[~∼～-]3개월",
    "M6": r"3(?:개월)?[~∼～-]6개월|3개월초과6개월(?:이내|이하)",
    "M12": r"6(?:개월)?[~∼～-]12개월|6개월초과(?:12개월|1년)(?:이내|이하)",
    "Y2": r"1(?:년)?[~∼～-]2년|1년초과2년(?:이내|이하)",
    "Y3": r"2(?:년)?[~∼～-]3년|2년초과3년(?:이내|이하)",
    "OVER3": r"3년초과",
    "UNDISCLOSED": r"만기(?:일|정보|구간)?(?:미공시|미기재|미확인|없음)",
}


def add_months(start, months):
    year, month = divmod(start.year * 12 + start.month - 1 + months, 12)
    return date(year, month + 1, min(start.day, calendar.monthrange(year, month + 1)[1]))


def parse_date(value):
    if not value or not re.fullmatch(r"\d{4}[-./]\d{2}[-./]\d{2}", value.strip()):
        return None
    try:
        return date.fromisoformat(re.sub(r"[./]", "-", value.strip()))
    except ValueError:
        return None


def date_band(value, start):
    if value < start:
        return "OVERDUE"
    for key, _, months in BANDS:
        if months is None or value <= add_months(start, months):
            return key


def loan_period_band(value, start):
    token = r"(\d{4}|\d{2})[./-](\d{1,2})(?:[./-](\d{1,2}))?"
    match = re.fullmatch(rf"\s*{token}\s*[~∼～]\s*{token}\s*", value or "")
    if not match:
        return None
    sy, sm, sd, ey, em, ed = match.groups()
    sy, ey = (int(y) if len(y) == 4 else start.year // 100 * 100 + int(y) for y in (sy, ey))
    try:
        first = date(sy, int(sm), int(sd or 1))
        low = date(ey, int(em), int(ed or 1))
        high = date(ey, int(em), int(ed) if ed else calendar.monthrange(ey, int(em))[1])
    except ValueError:
        return None
    if first > high:
        return None
    # A month-only end crossing a band boundary cannot establish an exact band.
    return date_band(low, start) if date_band(low, start) == date_band(high, start) else None


def classify(data, start):
    reported = data.get("maturity_bucket")
    dated = parse_date(data.get("maturity"))
    if reported and reported != "UNDISCLOSED":
        if dated and date_band(dated, start) != reported:
            return "UNDISCLOSED", "CONFLICT"
        return reported, "REPORTED_BAND"
    if dated:
        return date_band(dated, start), "MATURITY_DATE"
    if data.get("loan_period"):
        band = loan_period_band(data["loan_period"], start)
        if band:
            return band, "LOAN_PERIOD"
    return "UNDISCLOSED", "EXPLICIT_UNDISCLOSED" if reported == "UNDISCLOSED" else "UNCONFIRMED"


def refs(records):
    return list(
        {s["segment_id"]: s for r in records for s in r.get("sources", [r["source"]])}.values()
    )


def build_ladder(records, start, total_amount, *, complete, absences=(), unready=0, detected=False):
    values = {key: Decimal(0) for key, _, _ in BANDS}
    values.update(UNDISCLOSED=Decimal(0), OVERDUE=Decimal(0))
    basis, items = set(), []
    for record in records:
        key, method = classify(record["data"], start)
        values[key] += record["value"]
        basis.add(method)
        items.append(
            {
                "label": record["data"]["statement"],
                "amount": format(record["value"], "f"),
                "band": key,
                "basis": method,
                "maturity": record["data"].get("maturity"),
                "loan_period": record["data"].get("loan_period"),
                "source": record["source"],
            }
        )
    allocated = any(item["band"] != "UNDISCLOSED" for item in items)
    within = sum((values[key] for key in ("M3", "M6", "M12")), Decimal(0))
    amount = sum(values.values(), Decimal(0)) if records else None
    total = Decimal(total_amount) if total_amount is not None else None
    reconciled = complete and amount is not None and total == amount
    if absences and records:
        state, reconciled = "CONFLICT", False
    elif absences and unready:
        state, reconciled = "REVIEW_REQUIRED", False
    elif absences:
        state = "EXPLICIT_NONE"
    elif not records:
        state = (
            "REVIEW_REQUIRED" if unready else "AMOUNT_UNCONFIRMED" if detected else "NOT_DETECTED"
        )
    elif not reconciled:
        state = "PARTIAL"
    elif "CONFLICT" in basis:
        state = "CONFLICT"
        reconciled = False
    elif not allocated:
        state = "UNDISCLOSED" if basis == {"EXPLICIT_UNDISCLOSED"} else "MATURITY_UNCONFIRMED"
    elif "LOAN_PERIOD" in basis:
        state = "RECALCULATED"
    else:
        state = "DISCLOSED"
    bins = [
        {
            "key": key,
            "label": label,
            "amount": format(values[key], "f") if records else None,
            "within_year": key in ("M3", "M6", "M12"),
        }
        for key, label, _ in BANDS
    ]
    if values["OVERDUE"]:
        bins.append(
            {
                "key": "OVERDUE",
                "label": "기준일 전 만기",
                "amount": format(values["OVERDUE"], "f"),
                "within_year": False,
            }
        )
    unknown_label = (
        "만기 미공시"
        if "UNCONFIRMED" not in basis and "CONFLICT" not in basis
        else "만기 미공시·미확인"
    )
    bins.append(
        {
            "key": "UNDISCLOSED",
            "label": unknown_label,
            "amount": format(values["UNDISCLOSED"], "f") if records else None,
            "within_year": False,
        }
    )
    can_measure = reconciled and allocated
    quotes = [
        {"quote": c["quote"], "sources": refs([r])}
        for r in absences
        for c in r["data"].get("citations", [])
        if c["field"] == "absence"
    ]
    return {
        "state": state,
        "bins": bins,
        "total": format(total, "f") if reconciled else None,
        "known_total": format(amount, "f") if amount is not None else None,
        "within_amount": format(within, "f") if can_measure else None,
        "within_percent": format(within / total * 100, "f") if can_measure and total else None,
        "denominator_includes_undisclosed": True,
        "reconciled": reconciled,
        "basis": sorted(basis),
        "sources": refs([*records, *absences]),
        "absence_quotes": quotes,
        "items": items,
        "unready_facts": unready,
    }
