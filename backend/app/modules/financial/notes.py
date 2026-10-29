"""Deterministic extraction of exact rows from cached DART note tables."""

import re
from decimal import localcontext
from itertools import islice

from lxml import html

from app.modules.financial.domain import amount, clean_name

NOTE_VERSION = "financial-note-tables-v2"
NOTE_ACCOUNTS = {
    "이자비용": "interest_expense",
    "이자비용(금융원가)": "interest_expense",
    "이자비용(금융비용)": "interest_expense",
    "단기차입금": "short_borrowings",
    "장기차입금": "long_borrowings",
    "유동성장기차입금": "current_long_borrowings",
    "유동성사채": "current_bonds",
    "유동리스부채": "current_lease",
    "유동성리스부채": "current_lease",
    "비유동리스부채": "noncurrent_lease",
    "임대보증금": "rental_deposits",
}


def table_grid(table):
    """Expand span coordinates without duplicating numeric cells or losing XPath."""
    grid, occupied = [], {}
    rows = table.xpath("./tr | ./thead/tr | ./tbody/tr | ./tfoot/tr")
    for y, row in enumerate(rows):
        x = 0
        for cell in row.xpath("./td | ./th"):
            while (y, x) in occupied:
                x += 1
            try:
                height, width = int(cell.get("rowspan", "1")), int(cell.get("colspan", "1"))
            except ValueError:
                return []
            if not (1 <= height <= 500 and 1 <= width <= 100):
                return []
            for dy in range(height):
                for dx in range(width):
                    if (y + dy, x + dx) in occupied:
                        return []
                    occupied[y + dy, x + dx] = cell
                    if len(occupied) > 200000 or x + dx >= 500:
                        return []
            x += width
        width = max((col + 1 for row_index, col in occupied if row_index == y), default=0)
        grid.append([occupied.get((y, col)) for col in range(width)])
    return list(zip(rows, grid, strict=True))


def preceding_elements(table):
    return (s for s in table.itersiblings(preceding=True) if isinstance(s.tag, str))


def nearest_caption(table):
    for sibling in preceding_elements(table):
        text = " ".join(sibling.text_content().split())
        if text:
            # Do not jump over another data table to borrow its period or unit.
            return text
    return ""


def extract_note_candidates(source: bytes, encoding: str, digest: str):
    root = html.fromstring(source.decode(encoding))
    tree, candidates = root.getroottree(), []
    for table in root.xpath("//table"):
        if table.xpath(".//table"):
            continue
        grid = table_grid(table)
        if not grid:
            continue
        caption = nearest_caption(table)
        unit_text = caption if "단위" in caption else table.text_content()
        units = set(re.findall(r"단위\s*[:：]?\s*(백만원|천원|원)", unit_text))
        multiplier = (
            {"원": 1, "천원": 1000, "백만원": 1000000}.get(next(iter(units)))
            if len(units) == 1
            else None
        )
        caption_periods = set(
            re.findall(r"(?<![가-힣])(전전기|전기|당기)(?:말)?(?![가-힣])", caption)
        )
        caption_period = (
            {"당기": "current", "전기": "previous", "전전기": "before_previous"}.get(
                next(iter(caption_periods))
            )
            if len(caption_periods) == 1
            else None
        )
        section = " ".join(s.text_content() for s in islice(preceding_elements(table), 12))
        columns = {}
        for _, cells in grid:
            names = [clean_name(c.text_content()) if c is not None else "" for c in cells]
            current = [i for i, n in enumerate(names) if n in ("당기", "당기말")]
            previous = [i for i, n in enumerate(names) if n in ("전기", "전기말")]
            if len(current) == len(previous) == 1:
                columns = {"current": current[0], "previous": previous[0]}
                break
        if not columns and caption_period:
            # Choose an explicit total or a single reported-value column.
            # Never sum instrument categories, rates or maturity buckets.
            for _, cells in grid:
                names = [clean_name(c.text_content()) if c is not None else "" for c in cells]
                total = [i for i, n in enumerate(names) if n.endswith("합계")]
                reported = [i for i, n in enumerate(names) if n == "공시금액"]
                chosen = total if len(total) == 1 else reported
                if len(chosen) == 1:
                    columns = {caption_period: chosen[0]}
                    break
        for row, cells in grid:
            labels = [(c, clean_name(c.text_content())) for c in cells if c is not None]
            matched = [(c, label) for c, label in labels if label in NOTE_ACCOUNTS]
            unique = {(id(c), label): c for c, label in matched}
            if len(unique) != 1:
                continue
            (_, label), _ = next(iter(unique.items()))
            key = NOTE_ACCOUNTS[label]
            for period, index in columns.items():
                if index >= len(cells) or cells[index] is None:
                    continue
                cell = cells[index]
                raw = cell.text_content().strip()
                value = amount(raw)
                semantic = key != "interest_expense" or any(
                    word in caption + section for word in ("금융비용", "금융원가")
                )
                eligible = multiplier is not None and value is not None and semantic
                # Signed category P&L contributions require sign-policy review.
                if key == "interest_expense" and value is not None and value < 0:
                    eligible = False
                if cell.get("colspan", "1") != "1":
                    eligible = False
                with localcontext() as ctx:
                    ctx.prec = 40
                    normalized = str(value * multiplier) if eligible else None
                    if normalized is not None and amount(normalized) is None:
                        normalized, eligible = None, False
                    observed = (
                        str(value * multiplier)
                        if value is not None and multiplier is not None
                        else None
                    )
                candidates.append(
                    {
                        "key": key,
                        "period": period,
                        "value": normalized,
                        "raw_amount": raw,
                        "account_name": label,
                        "source_sha256": digest,
                        "source_xpath": tree.getpath(row),
                        "source_cell_xpath": tree.getpath(cell),
                        "period_caption": caption,
                        "unit_multiplier": multiplier,
                        "method": "note_exact_table",
                        "eligible": eligible,
                        "semantic_match": semantic,
                        "observed_value": observed,
                        "validation": "exact_row_period_unit_total",
                        "parser_version": NOTE_VERSION,
                    }
                )
    candidates.extend(extract_borrowing_subtotals(root, digest))
    return candidates


def extract_borrowing_subtotals(root, digest):
    """Derive only the issuer's reconciled capital-management subtotal.

    This is not evidence that undisclosed bonds are zero. The normalized fact
    has a separate key and never replaces the calculator's full borrowing total.
    """
    borrowings = {"단기차입금", "유동성장기차입금", "장기차입금"}
    reductions = {
        "현금및현금성자산",
        "당기손익인식금융자산",
        "기타포괄손익인식금융자산",
        "상각후원가로측정하는금융자산",
    }
    controls = {"순부채(순자산)", "순차입금(순현금)"}
    tree, candidates = root.getroottree(), []
    for table in root.xpath("//table"):
        if table.xpath(".//table"):
            continue
        text = clean_name(table.text_content())
        if not all(name in text for name in borrowings) or not any(
            name in text for name in controls
        ):
            continue
        caption = nearest_caption(table)
        context = " ".join(s.text_content() for s in islice(preceding_elements(table), 12))
        if "자본관리" not in caption + context:
            continue
        periods = set(re.findall(r"(?<![가-힣])(전전기|전기|당기)(?:말)?(?![가-힣])", caption))
        if len(periods) != 1:
            continue
        period = {"당기": "current", "전기": "previous", "전전기": "before_previous"}[
            next(iter(periods))
        ]
        units = set(re.findall(r"단위\s*[:：]?\s*(백만원|천원|원)", caption))
        if len(units) != 1:
            continue
        multiplier = {"원": 1, "천원": 1000, "백만원": 1000000}[next(iter(units))]
        grid = table_grid(table)
        if not grid:
            continue
        # Only an explicit single amount column is supported here. Currency,
        # rate, maturity and instrument-category columns are not summed.
        header = [
            i
            for i, c in enumerate(grid[0][1])
            if c is not None and clean_name(c.text_content()) == "공시금액"
        ]
        if len(header) != 1:
            continue
        column = header[0]
        entries, control, invalid = [], None, False
        for row, cells in grid[1:]:
            if column >= len(cells) or cells[column] is None:
                invalid = True
                break
            label = clean_name(cells[0].text_content()) if cells[0] is not None else ""
            raw = cells[column].text_content().strip()
            value = amount(raw)
            if label in controls:
                control = {"label": label, "value": value, "source_xpath": tree.getpath(row)}
                break
            if label not in borrowings | reductions or value is None:
                invalid = True
                break
            if (label in borrowings and value < 0) or (label in reductions and value > 0):
                invalid = True
                break
            entries.append(
                {
                    "label": label,
                    "value": value,
                    "raw_amount": raw,
                    "source_xpath": tree.getpath(row),
                    "source_cell_xpath": tree.getpath(cells[column]),
                }
            )
        if invalid or control is None or control["value"] is None:
            continue
        labels = [entry["label"] for entry in entries]
        if len(set(labels)) != len(labels) or not borrowings.issubset(labels):
            continue
        with localcontext() as ctx:
            ctx.prec = 60
            # No accounting tolerance is invented: the displayed table must
            # reconcile exactly in its disclosed unit.
            if sum((e["value"] for e in entries), start=amount("0")) != control["value"]:
                continue
            subtotal = sum(
                (e["value"] for e in entries if e["label"] in borrowings), start=amount("0")
            )
            normalized = str(subtotal * multiplier)
            if amount(normalized) is None:
                continue
            serialized = [
                {
                    **e,
                    "value": str(e["value"] * multiplier),
                    "kind": "borrowing" if e["label"] in borrowings else "reduction",
                }
                for e in entries
            ]
        candidates.append(
            {
                "key": "note_borrowing_subtotal",
                "period": period,
                "value": normalized,
                "raw_amount": str(subtotal),
                "account_name": "주석 차입금 소계",
                "source_sha256": digest,
                "source_xpath": tree.getpath(table),
                "period_caption": caption,
                "unit_multiplier": multiplier,
                "components": serialized,
                "control": {**control, "value": str(control["value"] * multiplier)},
                "derived": True,
                "method": "note_reconciled_subtotal",
                "eligible": True,
                "validation": "capital_management_exact_reconciliation",
                "scope": "issuer_disclosed_borrowing_components_excluding_lease",
                "parser_version": NOTE_VERSION,
            }
        )
    return candidates


def supplement(facts, candidates):
    for fact in facts:
        if fact["value"] is not None:
            continue
        matches = [
            c
            for c in candidates
            if c["key"] == fact["key"]
            and c["period"] == fact["period"]
            and c.get("semantic_match", True)
        ]
        eligible = [c for c in matches if c["eligible"]]
        values = {c["value"] for c in eligible}
        if len(values) != 1:
            continue
        selected = amount(next(iter(values)))
        # A positive finance-cost total can be corroborated by the same cost
        # shown as a negative P&L contribution elsewhere. A negative-only row
        # is never sufficient to create a positive expense.
        rejected = [c for c in matches if not c["eligible"]]
        if any(
            fact["key"] != "interest_expense"
            or amount(c.get("observed_value")) is None
            or abs(amount(c["observed_value"])) != selected
            for c in rejected
        ):
            continue
        if fact["reason"] not in ("account_not_found", "amount_not_disclosed"):
            continue
        fact.update(
            value=next(iter(values)),
            state="CONFIRMED",
            reason=None,
            mapping_method=eligible[0].get("method", "note_exact_table"),
            sources=eligible,
        )
    return facts
