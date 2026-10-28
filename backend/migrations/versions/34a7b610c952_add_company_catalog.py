"""Persist the DART company master and import checkpoint.

Revision ID: 34a7b610c952
Revises: 8e514c5e3b42
"""

import sqlalchemy as sa
from alembic import op

revision = "34a7b610c952"
down_revision = "8e514c5e3b42"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "company",
        sa.Column("corp_code", sa.String(8), primary_key=True),
        sa.Column("corp_name", sa.Text(), nullable=False),
        sa.Column("corp_eng_name", sa.Text()),
        sa.Column("stock_code", sa.String(6)),
        sa.Column("modify_date", sa.String(8), nullable=False),
        sa.Column("ksic11_code", sa.String(5)),
        sa.Column("ksic11_name", sa.Text()),
        sa.Column("ksic11_level", sa.Integer()),
        sa.Column("ksic11_status", sa.String(20), nullable=False),
        sa.Column("induty_code", sa.Text()),
        sa.Column("corp_cls", sa.String(1)),
        sa.Column("acc_mt", sa.String(2)),
        sa.Column("industry", sa.String(20)),
        sa.Column("search_name", sa.Text(), nullable=False),
        sa.Column("search_eng_name", sa.Text(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.CheckConstraint("corp_code ~ '^[0-9]{8}$'", name=op.f("ck_company_corp_code_format")),
    )
    op.create_index("ix_company_stock_code", "company", ["stock_code"])
    op.create_index(
        "ix_company_active_industry_name",
        "company",
        ["active", "industry", "corp_name", "corp_code"],
    )
    op.create_index("ix_company_active_name", "company", ["active", "corp_name", "corp_code"])
    op.create_table(
        "company_import",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("source_signature", sa.Text(), nullable=False),
        sa.Column("company_count", sa.Integer(), nullable=False),
        sa.Column(
            "imported_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("id = 1", name=op.f("ck_company_import_singleton")),
    )


def downgrade() -> None:
    op.drop_table("company_import")
    op.drop_table("company")
