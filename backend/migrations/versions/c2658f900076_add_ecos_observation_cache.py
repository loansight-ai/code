"""Cache exact-year ECOS observations without replacing the CSV source."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "c2658f900076"
down_revision = "b1547e8f0065"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "ecos_observation",
        sa.Column("adapter_version", sa.String(30), primary_key=True),
        sa.Column("stat_code", sa.String(10), primary_key=True),
        sa.Column("industry_code", sa.String(20), primary_key=True),
        sa.Column("size_code", sa.String(1), primary_key=True),
        sa.Column("metric_code", sa.String(10), primary_key=True),
        sa.Column("year", sa.Integer(), primary_key=True),
        sa.Column("value", sa.Numeric(38, 10), nullable=False),
        sa.Column("unit", sa.String(10), nullable=False),
        sa.Column("source_row", JSONB(), nullable=False),
        sa.Column("source_sha256", sa.String(64), nullable=False),
        sa.Column(
            "fetched_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )


def downgrade():
    op.drop_table("ecos_observation")
