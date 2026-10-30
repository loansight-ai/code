"""Validate and atomically import CSV collections; never overwrite live analyses.

Amounts remain exact decimal strings in source JSON, blanks become null, and source
columns are retained. Validation also runs without a database or third-party packages.
"""

import argparse
import asyncio
import csv
import hashlib
import io
import json
import re
import sys
from collections import Counter
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path
from uuid import UUID, uuid4

PARSER_VERSION = "company-export-v1"
DEFAULT_DIRECTORY = Path(__file__).resolve().parents[3] / "data/company/exported"
FINANCIAL_META = set(
    "corp_code corp_name industry industry_group bsns_year fs_div rcept_no is_format".split()
)
FINANCIAL_AMOUNTS = set(
    """
bs_ta bs_ca bs_cash bs_stfi bs_ar bs_contract_a bs_inv bs_ca_other bs_nca bs_ppe bs_ip
bs_rou bs_intan bs_goodwill bs_assoc bs_dta bs_nca_other bs_tl bs_cl bs_ap bs_stb
bs_cpltd bs_cbond bs_clease bs_contract_l bs_ctax bs_cl_other bs_ncl bs_ltb bs_bond
bs_nclease bs_dbo bs_dtl bs_ncl_other bs_te bs_eq_p bs_nci bs_cap bs_capsur bs_re
bs_other_eq bs_tle bs_borrow bs_borrow_st bs_lease is_rev is_cogs is_gp is_sga is_opex
is_op_other is_op is_other_inc is_other_exp is_fin_inc is_fin_cost is_eq_method
is_nonop_other is_ebt is_tax is_disc is_ni is_ni_p is_ni_nci is_oci is_tci is_dep
is_ebitda cf_cfo cf_ni cf_cash_gen cf_dep cf_amort cf_wc cf_int_paid cf_int_rec cf_div_rec
cf_tax_paid cf_cfi cf_capex cf_ppe_disp cf_intan_acq cf_ip_acq cf_ip_disp cf_cfi_other
cf_cff cf_stb_in cf_stb_out cf_ltb_in cf_ltb_out cf_bond_in cf_bond_out cf_lease_pay
cf_div_paid cf_eq_iss cf_ts_acq cf_cff_other cf_fx cf_net cf_cash_beg cf_cash_end cf_fcf
cf_net_borrow sce_beg sce_adj sce_ni sce_oci sce_div sce_iss sce_ts sce_other sce_end
is_int_exp nt_rate_wavg nt_rate_min nt_rate_max nt_dev nt_fv_gain nt_disp_gain nt_pf nt_rental
""".split()
)
EVENT_COLUMNS = set(
    """
id industry corp_code corp_name event_type use event_date date_basis rcept_no rcept_dt
source title fiscal_period detail severity is_first_of_type verified
""".split()
)
COVERAGE_COUNTS = set(
    """
filings_b_count filings_i_count audit_api_calls label_candidates audit_doc_reports audit_doc_ok
""".split()
)
COVERAGE_COLUMNS = COVERAGE_COUNTS | set(
    """
corp_code industry corp_name corp_cls_name first_period last_period major_dfocr major_ctrcvsbgrq
major_bnkmngtpcbg major_range major_fetched_at filings_b filings_range filings_fetched_at
filings_i first_event_date
""".split()
)
SCHEMAS = {
    "financial": ("fs4_wide_ok", FINANCIAL_META | FINANCIAL_AMOUNTS | {"nt_ip_model"}),
    "events": ("risk_event", EVENT_COLUMNS),
    "coverage": ("event_coverage", COVERAGE_COLUMNS),
}


class ExportError(ValueError):
    pass


@dataclass
class ExportDataset:
    signature: str
    exported_on: date
    source_as_of: date
    manifest: dict
    financial: list[dict]
    events: list[dict]
    coverage: list[dict]
    warnings: dict

    def summary(self):
        return {
            "signature": self.signature,
            "rows": {key: len(getattr(self, key)) for key in SCHEMAS},
            "companies": len(self.coverage),
            "warnings": self.warnings,
        }


def require(value, pattern, field):
    if not isinstance(value, str) or not re.fullmatch(pattern, value, flags=re.ASCII):
        raise ExportError(f"invalid {field}")
    return value


def day(value, field):
    require(value, r"\d{4}-\d{2}-\d{2}", field)
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise ExportError(f"invalid {field}") from None


def read_rows(path, columns):
    raw = path.read_bytes()
    reader = csv.DictReader(io.StringIO(raw.decode("utf-8-sig"), newline=""), strict=True)
    if not reader.fieldnames or set(reader.fieldnames) != columns:
        raise ExportError(f"{path.name}: unexpected columns")
    if len(reader.fieldnames) != len(columns):
        raise ExportError(f"{path.name}: duplicate columns")
    rows = []
    for number, row in enumerate(reader, 2):
        if None in row or any(value is None for value in row.values()):
            raise ExportError(f"{path.name}:{number}: malformed row")
        row = {key: value if value != "" else None for key, value in row.items()}
        require(row["corp_code"], r"\d{8}", "corp_code")
        if not row["corp_name"]:
            raise ExportError(f"{path.name}:{number}: missing corp_name")
        rows.append(row)
    if not rows:
        raise ExportError(f"{path.name}: empty dataset")
    return rows, {
        "filename": path.name,
        "sha256": hashlib.sha256(raw).hexdigest(),
        "bytes": len(raw),
        "rows": len(rows),
    }


def unique(rows, key, label):
    keys = [key(row) for row in rows]
    if len(keys) != len(set(keys)):
        raise ExportError(f"duplicate {label}")


def load_dataset(directory: Path, exported_on: date, source_as_of: date) -> ExportDataset:
    if source_as_of > exported_on:
        raise ExportError("source_as_of is later than exported_on")
    tables, manifest = {}, {}
    for kind, (stem, columns) in SCHEMAS.items():
        tables[kind], manifest[kind] = read_rows(
            directory / f"{stem}_{exported_on:%Y%m%d}.csv", columns
        )
    financial, events, coverage = (tables[key] for key in SCHEMAS)
    for row in financial:
        require(row["bsns_year"], r"\d{4}", "bsns_year")
        require(row["rcept_no"], r"\d{14}", "rcept_no")
        if row["fs_div"] not in {"CFS", "OFS"}:
            raise ExportError("invalid fs_div")
        for key in FINANCIAL_AMOUNTS:
            value = row[key]
            if value is not None:
                try:
                    numeric = Decimal(value)
                except InvalidOperation:
                    raise ExportError(f"invalid amount: {key}") from None
                if not numeric.is_finite():
                    raise ExportError(f"non-finite amount: {key}")
    unique(financial, lambda r: (r["corp_code"], r["bsns_year"], r["fs_div"]), "financial key")
    for row in events:
        require(row["id"], r"[1-9]\d*", "event id")
        require(row["rcept_no"], r"\d{14}", "rcept_no")
        day(row["event_date"], "event_date")
        # The export uses YYYY-MM-DD for receipt dates too.
        day(row["rcept_dt"], "rcept_dt")
        for key in ("verified", "is_first_of_type"):
            if row[key] not in (None, "t", "f"):
                raise ExportError(f"invalid boolean: {key}")
            row[key] = {None: None, "t": True, "f": False}[row[key]]
    unique(events, lambda r: int(r["id"]), "event id")
    unique(coverage, lambda r: r["corp_code"], "coverage company")
    for row in coverage:
        for key in COVERAGE_COUNTS:
            require(row[key], r"\d+", key)
            row[key] = int(row[key])
        if row["audit_doc_ok"] > row["audit_doc_reports"]:
            raise ExportError("audit_doc_ok exceeds audit_doc_reports")
    financial_codes = {r["corp_code"] for r in financial}
    event_codes = {r["corp_code"] for r in events}
    coverage_codes = {r["corp_code"] for r in coverage}
    if (financial_codes | event_codes) - coverage_codes:
        raise ExportError("financial/event company missing from coverage")
    candidates = Counter(r["corp_code"] for r in events if r["use"] == "라벨후보")
    if any(r["label_candidates"] != candidates[r["corp_code"]] for r in coverage):
        raise ExportError("coverage label_candidates does not match events")
    receipts = Counter(r["rcept_no"] for r in financial)
    warnings = {
        "coverage_without_financial": len(coverage_codes - financial_codes),
        "event_companies_without_financial": len(event_codes - financial_codes),
        "unverified_events": sum(r["verified"] is None for r in events),
        "incomplete_audit_companies": sum(
            r["audit_doc_ok"] < r["audit_doc_reports"] for r in coverage
        ),
        "repeated_financial_receipts": sorted(k for k, count in receipts.items() if count > 1),
    }
    identity = {
        "parser": PARSER_VERSION,
        "exported_on": exported_on.isoformat(),
        "source_as_of": source_as_of.isoformat(),
        "files": manifest,
    }
    signature = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()
    return ExportDataset(
        signature, exported_on, source_as_of, manifest, financial, events, coverage, warnings
    )


async def import_dataset(database, dataset):
    # Lazy imports keep local CSV validation independent of runtime dependencies.
    from sqlalchemy import insert, select, text

    from app.modules.company.models import (
        CollectedEventCoverage,
        CollectedFinancial,
        CollectedRiskEvent,
        CompanyDatasetImport,
        CompanyRecord,
    )

    async with database.transaction() as session:
        await session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": 7364201102})
        existing = await session.scalar(
            select(CompanyDatasetImport).where(CompanyDatasetImport.signature == dataset.signature)
        )
        if existing:
            return {"import_id": str(existing.id), "reused": True, **dataset.summary()}
        codes = {r["corp_code"] for r in dataset.coverage}
        known = set(
            await session.scalars(
                select(CompanyRecord.corp_code).where(CompanyRecord.corp_code.in_(codes))
            )
        )
        missing = sorted(codes - known)
        if missing:
            raise ExportError(f"companies missing from master ({len(missing)}): {missing[:10]}")
        import_id = uuid4()
        session.add(
            CompanyDatasetImport(
                id=import_id,
                signature=dataset.signature,
                parser_version=PARSER_VERSION,
                exported_on=dataset.exported_on,
                source_as_of=dataset.source_as_of,
                manifest={"files": dataset.manifest, "warnings": dataset.warnings},
            )
        )
        await session.flush()
        batches = (
            (
                CollectedFinancial,
                [
                    {
                        "import_id": import_id,
                        "corp_code": r["corp_code"],
                        "fiscal_year": int(r["bsns_year"]),
                        "scope": r["fs_div"],
                        "receipt_no": r["rcept_no"],
                        "data": r,
                    }
                    for r in dataset.financial
                ],
            ),
            (
                CollectedRiskEvent,
                [
                    {
                        "import_id": import_id,
                        "source_id": int(r["id"]),
                        "corp_code": r["corp_code"],
                        "receipt_no": r["rcept_no"],
                        "event_date": day(r["event_date"], "event_date"),
                        "verified": r["verified"],
                        "data": r,
                    }
                    for r in dataset.events
                ],
            ),
            (
                CollectedEventCoverage,
                [
                    {"import_id": import_id, "corp_code": r["corp_code"], "data": r}
                    for r in dataset.coverage
                ],
            ),
        )
        for model, rows in batches:
            for start in range(0, len(rows), 500):
                await session.execute(insert(model), rows[start : start + 500])
    return {"import_id": str(import_id), "reused": False, **dataset.summary()}


async def read_company_collection(
    database, import_id, corp_code, receipt_no, scope, fiscal_year=None
):
    """Exact report/scope match; events and coverage remain company-level sources.

    Return a list of financial rows because one receipt may (erroneously) refer to
    multiple fiscal years. Never silently choose one or fall back between scopes.
    """
    from sqlalchemy import select

    from app.modules.company.models import (
        CollectedEventCoverage,
        CollectedFinancial,
        CollectedRiskEvent,
        CompanyDatasetImport,
    )

    async with database.transaction() as session:
        if import_id is None:
            source = await session.scalar(
                select(CompanyDatasetImport)
                .join(CollectedEventCoverage)
                .where(CollectedEventCoverage.corp_code == corp_code)
                .order_by(
                    CompanyDatasetImport.source_as_of.desc(),
                    CompanyDatasetImport.imported_at.desc(),
                    CompanyDatasetImport.id.desc(),
                )
                .limit(1)
            )
        else:
            source = await session.get(CompanyDatasetImport, import_id)
        if source is None:
            if import_id is not None:
                raise ExportError("unknown import_id")
            return {
                "corp_code": corp_code,
                "receipt_no": receipt_no,
                "scope": scope,
                "import_id": None,
                "source_as_of": None,
                "exported_on": None,
                "financial": [],
                "history": [],
                "available_scopes": [],
                "event_candidates": [],
                "coverage": None,
            }
        import_id = source.id
        conditions = [
            CollectedFinancial.import_id == import_id,
            CollectedFinancial.corp_code == corp_code,
            CollectedFinancial.receipt_no == receipt_no,
            CollectedFinancial.scope == scope,
        ]
        if fiscal_year is not None:
            conditions.append(CollectedFinancial.fiscal_year == int(fiscal_year))
        financial = list(
            await session.scalars(
                select(CollectedFinancial)
                .where(
                    *conditions,
                )
                .order_by(CollectedFinancial.fiscal_year)
            )
        )
        events = list(
            await session.scalars(
                select(CollectedRiskEvent)
                .where(
                    CollectedRiskEvent.import_id == import_id,
                    CollectedRiskEvent.corp_code == corp_code,
                )
                .order_by(CollectedRiskEvent.event_date, CollectedRiskEvent.source_id)
            )
        )
        coverage = await session.get(CollectedEventCoverage, (import_id, corp_code))
        scopes = list(
            await session.scalars(
                select(CollectedFinancial.scope)
                .where(
                    CollectedFinancial.import_id == import_id,
                    CollectedFinancial.corp_code == corp_code,
                    CollectedFinancial.receipt_no == receipt_no,
                )
                .distinct()
                .order_by(CollectedFinancial.scope)
            )
        )
        history = []
        if len(financial) == 1:
            year = financial[0].fiscal_year
            history = list(
                await session.scalars(
                    select(CollectedFinancial)
                    .where(
                        CollectedFinancial.import_id == import_id,
                        CollectedFinancial.corp_code == corp_code,
                        CollectedFinancial.fiscal_year.between(year - 4, year),
                    )
                    .order_by(CollectedFinancial.fiscal_year, CollectedFinancial.scope)
                )
            )
        return {
            "corp_code": corp_code,
            "receipt_no": receipt_no,
            "scope": scope,
            "import_id": str(import_id),
            "source_as_of": source.source_as_of.isoformat(),
            "exported_on": source.exported_on.isoformat(),
            "financial": [r.data for r in financial],
            "history": [r.data for r in history],
            "available_scopes": scopes,
            "event_candidates": [r.data for r in events],
            "coverage": coverage.data if coverage else None,
        }


async def run_database(args, dataset=None):
    from app.core.config import Settings
    from app.core.database import Database

    database = Database(Settings())
    try:
        if args.command == "show":
            return await read_company_collection(
                database, args.import_id, args.corp_code, args.receipt_no, args.scope
            )
        return await import_dataset(database, dataset)
    finally:
        await database.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for command in ("validate", "load"):
        sub = commands.add_parser(command)
        sub.add_argument("--directory", type=Path, default=DEFAULT_DIRECTORY)
        sub.add_argument("--exported-on", type=date.fromisoformat, required=True)
        sub.add_argument("--source-as-of", type=date.fromisoformat, required=True)
    show = commands.add_parser("show")
    show.add_argument("--import-id", type=UUID, required=True)
    show.add_argument("--corp-code", required=True)
    show.add_argument("--receipt-no", required=True)
    show.add_argument("--scope", choices=("CFS", "OFS"), required=True)
    args = parser.parse_args()
    if sys.platform == "win32" and args.command != "validate":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    try:
        if args.command == "show":
            require(args.corp_code, r"\d{8}", "corp_code")
            require(args.receipt_no, r"\d{14}", "receipt_no")
            result = asyncio.run(run_database(args))
        else:
            dataset = load_dataset(args.directory, args.exported_on, args.source_as_of)
            result = (
                dataset.summary()
                if args.command == "validate"
                else asyncio.run(run_database(args, dataset))
            )
    except (ExportError, OSError, UnicodeError, csv.Error) as exc:
        parser.exit(1, f"{exc}\n")
    print(json.dumps(result, ensure_ascii=True, indent=2))


if __name__ == "__main__":
    main()
