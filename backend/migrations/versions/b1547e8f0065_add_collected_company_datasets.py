"""Versioned CSV source snapshots linked to the existing company master."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "b1547e8f0065"
down_revision = "a0436d7e0054"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "company_dataset_import",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("signature", sa.String(64), nullable=False, unique=True),
        sa.Column("parser_version", sa.String(40), nullable=False),
        sa.Column("exported_on", sa.Date(), nullable=False),
        sa.Column("source_as_of", sa.Date(), nullable=False),
        sa.Column("manifest", JSONB(), nullable=False),
        sa.Column(
            "imported_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_table(
        "collected_financial",
        sa.Column(
            "import_id", sa.Uuid(), sa.ForeignKey("company_dataset_import.id"), primary_key=True
        ),
        sa.Column("corp_code", sa.String(8), sa.ForeignKey("company.corp_code"), primary_key=True),
        sa.Column("fiscal_year", sa.Integer(), primary_key=True),
        sa.Column("scope", sa.String(3), primary_key=True),
        sa.Column("receipt_no", sa.String(14), nullable=False),
        sa.Column("data", JSONB(), nullable=False),
        sa.CheckConstraint("scope IN ('CFS', 'OFS')", name="scope"),
        sa.CheckConstraint("receipt_no ~ '^[0-9]{14}$'", name="receipt_format"),
    )
    op.create_index(
        "ix_collected_financial_report", "collected_financial", ["corp_code", "receipt_no", "scope"]
    )
    op.create_table(
        "collected_risk_event",
        sa.Column(
            "import_id", sa.Uuid(), sa.ForeignKey("company_dataset_import.id"), primary_key=True
        ),
        sa.Column("source_id", sa.Integer(), primary_key=True),
        sa.Column("corp_code", sa.String(8), sa.ForeignKey("company.corp_code"), nullable=False),
        sa.Column("receipt_no", sa.String(14), nullable=False),
        sa.Column("event_date", sa.Date(), nullable=False),
        sa.Column("verified", sa.Boolean()),
        sa.Column("data", JSONB(), nullable=False),
    )
    op.create_index(
        "ix_collected_risk_event_company_date", "collected_risk_event", ["corp_code", "event_date"]
    )
    op.create_table(
        "collected_event_coverage",
        sa.Column(
            "import_id", sa.Uuid(), sa.ForeignKey("company_dataset_import.id"), primary_key=True
        ),
        sa.Column("corp_code", sa.String(8), sa.ForeignKey("company.corp_code"), primary_key=True),
        sa.Column("data", JSONB(), nullable=False),
    )


def downgrade():
    op.drop_table("collected_event_coverage")
    op.drop_table("collected_risk_event")
    op.drop_table("collected_financial")
    op.drop_table("company_dataset_import")
