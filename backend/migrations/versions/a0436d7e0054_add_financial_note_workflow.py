"""Durable optional financial note enrichment and auditable candidates."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "a0436d7e0054"
down_revision = "9f325c6d0043"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "financial_note_workflow",
        sa.Column("run_id", sa.Uuid(), sa.ForeignKey("financial_run.id"), primary_key=True),
        sa.Column("structure_id", sa.Uuid(), sa.ForeignKey("note_structure.id")),
        sa.Column("job_id", sa.Uuid(), sa.ForeignKey("analysis_job.id"), unique=True),
        sa.Column("stage", sa.String(40), nullable=False),
        sa.Column("config", JSONB(), nullable=False),
        sa.Column("error_code", sa.String(80)),
        sa.Column("result", JSONB()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_financial_note_workflow_stage", "financial_note_workflow", ["stage"])
    op.create_table(
        "financial_note_candidate",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "run_id", sa.Uuid(), sa.ForeignKey("financial_note_workflow.run_id"), nullable=False
        ),
        sa.Column("account_key", sa.String(64), nullable=False),
        sa.Column("period", sa.String(24), nullable=False),
        sa.Column("amount", sa.Numeric(38, 6)),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("data", JSONB(), nullable=False),
    )
    op.create_index("ix_financial_note_candidate_run_id", "financial_note_candidate", ["run_id"])


def downgrade():
    op.drop_table("financial_note_candidate")
    op.drop_table("financial_note_workflow")
