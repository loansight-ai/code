"""Cache verified company-specific annual filing lists.

Revision ID: 4b98ac01e762
Revises: 34a7b610c952
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "4b98ac01e762"
down_revision = "34a7b610c952"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "company_report_catalog",
        sa.Column("corp_code", sa.String(8), sa.ForeignKey("company.corp_code"), primary_key=True),
        sa.Column("items", JSONB(), nullable=False),
        sa.Column("checked_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("search_start", sa.String(8), nullable=False),
        sa.Column("search_end", sa.String(8), nullable=False),
        sa.Column("source_hashes", JSONB(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("company_report_catalog")
