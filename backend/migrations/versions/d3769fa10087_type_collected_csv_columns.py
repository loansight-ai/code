"""Replace CSV row JSONB with typed source columns, preserving all import versions."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "d3769fa10087"
down_revision = "c2658f900076"
branch_labels = None
depends_on = None

# Frozen CSV contract: historical migrations must not import application schemas.
TABLES = {
    "collected_financial": (
        {"bsns_year": "fiscal_year", "fs_div": "scope", "rcept_no": "receipt_no"},
        ["bsns_year", "corp_code", "fs_div", "rcept_no"],
        {
            "bs_ap": "numeric",
            "bs_ar": "numeric",
            "bs_assoc": "numeric",
            "bs_bond": "numeric",
            "bs_borrow": "numeric",
            "bs_borrow_st": "numeric",
            "bs_ca": "numeric",
            "bs_ca_other": "numeric",
            "bs_cap": "numeric",
            "bs_capsur": "numeric",
            "bs_cash": "numeric",
            "bs_cbond": "numeric",
            "bs_cl": "numeric",
            "bs_cl_other": "numeric",
            "bs_clease": "numeric",
            "bs_contract_a": "numeric",
            "bs_contract_l": "numeric",
            "bs_cpltd": "numeric",
            "bs_ctax": "numeric",
            "bs_dbo": "numeric",
            "bs_dta": "numeric",
            "bs_dtl": "numeric",
            "bs_eq_p": "numeric",
            "bs_goodwill": "numeric",
            "bs_intan": "numeric",
            "bs_inv": "numeric",
            "bs_ip": "numeric",
            "bs_lease": "numeric",
            "bs_ltb": "numeric",
            "bs_nca": "numeric",
            "bs_nca_other": "numeric",
            "bs_nci": "numeric",
            "bs_ncl": "numeric",
            "bs_ncl_other": "numeric",
            "bs_nclease": "numeric",
            "bs_other_eq": "numeric",
            "bs_ppe": "numeric",
            "bs_re": "numeric",
            "bs_rou": "numeric",
            "bs_stb": "numeric",
            "bs_stfi": "numeric",
            "bs_ta": "numeric",
            "bs_te": "numeric",
            "bs_tl": "numeric",
            "bs_tle": "numeric",
            "bsns_year": "integer",
            "cf_amort": "numeric",
            "cf_bond_in": "numeric",
            "cf_bond_out": "numeric",
            "cf_capex": "numeric",
            "cf_cash_beg": "numeric",
            "cf_cash_end": "numeric",
            "cf_cash_gen": "numeric",
            "cf_cff": "numeric",
            "cf_cff_other": "numeric",
            "cf_cfi": "numeric",
            "cf_cfi_other": "numeric",
            "cf_cfo": "numeric",
            "cf_dep": "numeric",
            "cf_div_paid": "numeric",
            "cf_div_rec": "numeric",
            "cf_eq_iss": "numeric",
            "cf_fcf": "numeric",
            "cf_fx": "numeric",
            "cf_int_paid": "numeric",
            "cf_int_rec": "numeric",
            "cf_intan_acq": "numeric",
            "cf_ip_acq": "numeric",
            "cf_ip_disp": "numeric",
            "cf_lease_pay": "numeric",
            "cf_ltb_in": "numeric",
            "cf_ltb_out": "numeric",
            "cf_net": "numeric",
            "cf_net_borrow": "numeric",
            "cf_ni": "numeric",
            "cf_ppe_disp": "numeric",
            "cf_stb_in": "numeric",
            "cf_stb_out": "numeric",
            "cf_tax_paid": "numeric",
            "cf_ts_acq": "numeric",
            "cf_wc": "numeric",
            "corp_code": "text",
            "corp_name": "text",
            "fs_div": "text",
            "industry": "text",
            "industry_group": "text",
            "is_cogs": "numeric",
            "is_dep": "numeric",
            "is_disc": "numeric",
            "is_ebitda": "numeric",
            "is_ebt": "numeric",
            "is_eq_method": "numeric",
            "is_fin_cost": "numeric",
            "is_fin_inc": "numeric",
            "is_format": "text",
            "is_gp": "numeric",
            "is_int_exp": "numeric",
            "is_ni": "numeric",
            "is_ni_nci": "numeric",
            "is_ni_p": "numeric",
            "is_nonop_other": "numeric",
            "is_oci": "numeric",
            "is_op": "numeric",
            "is_op_other": "numeric",
            "is_opex": "numeric",
            "is_other_exp": "numeric",
            "is_other_inc": "numeric",
            "is_rev": "numeric",
            "is_sga": "numeric",
            "is_tax": "numeric",
            "is_tci": "numeric",
            "nt_dev": "numeric",
            "nt_disp_gain": "numeric",
            "nt_fv_gain": "numeric",
            "nt_ip_model": "text",
            "nt_pf": "numeric",
            "nt_rate_max": "numeric",
            "nt_rate_min": "numeric",
            "nt_rate_wavg": "numeric",
            "nt_rental": "numeric",
            "rcept_no": "text",
            "sce_adj": "numeric",
            "sce_beg": "numeric",
            "sce_div": "numeric",
            "sce_end": "numeric",
            "sce_iss": "numeric",
            "sce_ni": "numeric",
            "sce_oci": "numeric",
            "sce_other": "numeric",
            "sce_ts": "numeric",
        },
    ),
    "collected_risk_event": (
        {"id": "source_id", "rcept_no": "receipt_no"},
        ["corp_code", "event_date", "id", "rcept_no", "verified"],
        {
            "corp_code": "text",
            "corp_name": "text",
            "date_basis": "text",
            "detail": "text",
            "event_date": "date",
            "event_type": "text",
            "fiscal_period": "text",
            "id": "integer",
            "industry": "text",
            "is_first_of_type": "boolean",
            "rcept_dt": "date",
            "rcept_no": "text",
            "severity": "text",
            "source": "text",
            "title": "text",
            "use": "text",
            "verified": "boolean",
        },
    ),
    "collected_event_coverage": (
        {},
        ["corp_code"],
        {
            "audit_api_calls": "integer",
            "audit_doc_ok": "integer",
            "audit_doc_reports": "integer",
            "corp_cls_name": "text",
            "corp_code": "text",
            "corp_name": "text",
            "filings_b": "text",
            "filings_b_count": "integer",
            "filings_fetched_at": "timestamp",
            "filings_i": "text",
            "filings_i_count": "integer",
            "filings_range": "text",
            "first_event_date": "date",
            "first_period": "text",
            "industry": "text",
            "label_candidates": "integer",
            "last_period": "text",
            "major_bnkmngtpcbg": "text",
            "major_ctrcvsbgrq": "text",
            "major_dfocr": "text",
            "major_fetched_at": "timestamp",
            "major_range": "text",
        },
    ),
}
TYPES = {
    "numeric": sa.Numeric,
    "integer": sa.Integer,
    "boolean": sa.Boolean,
    "date": sa.Date,
    "timestamp": sa.DateTime,
    "text": sa.Text,
}


def upgrade():
    connection = op.get_bind()
    for table, (renames, existing, fields) in TABLES.items():
        # Refuse to silently discard fields or conflicting duplicated metadata.
        keys = ", ".join(f"'{key}'" for key in fields)
        unknown = connection.scalar(
            sa.text(
                f'SELECT EXISTS (SELECT 1 FROM "{table}", '
                f"jsonb_object_keys(data) AS k WHERE k NOT IN ({keys}))"
            )
        )
        if unknown:
            raise ValueError(f"{table}: unknown source fields; migration aborted")
        for key in existing:
            column = renames.get(key, key)
            conflict = connection.scalar(
                sa.text(
                    f'SELECT EXISTS (SELECT 1 FROM "{table}" '
                    f"WHERE NULLIF(data->>'{key}', '') IS NOT NULL "
                    f"AND (data->>'{key}')::{fields[key]} "
                    f'IS DISTINCT FROM "{column}")'
                )
            )
            if conflict:
                raise ValueError(f"{table}.{key}: conflicting source metadata")
        for key, kind in fields.items():
            if key not in existing:
                op.add_column(table, sa.Column(key, TYPES[kind](), nullable=True))
        assignments = ", ".join(
            f"\"{key}\" = NULLIF(data->>'{key}', '')::{kind}"
            for key, kind in fields.items()
            if key not in existing
        )
        connection.execute(sa.text(f'UPDATE "{table}" SET {assignments}'))
        for new, old in renames.items():
            op.alter_column(table, old, new_column_name=new)
        op.drop_column(table, "data")


def downgrade():
    connection = op.get_bind()
    for table, (renames, existing, fields) in reversed(TABLES.items()):
        op.add_column(table, sa.Column("data", JSONB(), nullable=True))
        pairs = []
        for key, kind in fields.items():
            # Financial amounts, fiscal year and event IDs were source strings.
            as_text = kind == "numeric" or key in {"bsns_year", "id"}
            expression = f'"{key}"::text' if as_text else f'"{key}"'
            pairs.append(f"'{key}', {expression}")
        # PostgreSQL limits function arguments; financial has over 100 fields.
        chunks = [
            "jsonb_build_object(" + ", ".join(pairs[i : i + 40]) + ")"
            for i in range(0, len(pairs), 40)
        ]
        connection.execute(sa.text(f'UPDATE "{table}" SET data = ' + " || ".join(chunks)))
        op.alter_column(table, "data", nullable=False)
        for new, old in renames.items():
            op.alter_column(table, new, new_column_name=old)
        for key in fields:
            if key not in existing:
                op.drop_column(table, key)
