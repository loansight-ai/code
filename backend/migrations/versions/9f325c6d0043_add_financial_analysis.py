"""Versioned financial runs, precise facts and their provenance."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "9f325c6d0043"
down_revision = "7e214c5b0032"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "financial_run",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("workspace_id", sa.Uuid(), sa.ForeignKey("workspace.id"), nullable=False),
        sa.Column(
            "job_id", sa.Uuid(), sa.ForeignKey("analysis_job.id"), nullable=False, unique=True
        ),
        sa.Column("context", JSONB(), nullable=False),
        sa.Column("source_sha256", sa.String(64)),
        sa.Column("result", JSONB()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_financial_run_workspace_id", "financial_run", ["workspace_id"])
    op.create_table(
        "financial_fact",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("run_id", sa.Uuid(), sa.ForeignKey("financial_run.id"), nullable=False),
        sa.Column("account_key", sa.String(64), nullable=False),
        sa.Column("period", sa.String(24), nullable=False),
        sa.Column("amount", sa.Numeric(38, 6)),
        sa.Column("provenance", JSONB(), nullable=False),
        sa.UniqueConstraint("run_id", "account_key", "period"),
    )
    op.create_index("ix_financial_fact_run_id", "financial_fact", ["run_id"])


def downgrade():
    op.drop_table("financial_fact")
    op.drop_table("financial_run")
