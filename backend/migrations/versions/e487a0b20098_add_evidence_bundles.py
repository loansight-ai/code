"""Publish selected dump evidence and pin owner-scoped mixed-source bundles."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "e487a0b20098"
down_revision = "d3769fa10087"
branch_labels = None
depends_on = None


def created():
    return sa.Column(
        "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
    )


def upgrade():
    op.create_table(
        "evidence_dataset",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("signature", sa.String(64), nullable=False, unique=True),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("manifest", JSONB(), nullable=False),
        created(),
    )
    op.create_table(
        "evidence_report",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("dataset_id", sa.Uuid(), sa.ForeignKey("evidence_dataset.id"), nullable=False),
        sa.Column("corp_code", sa.String(8), nullable=False),
        sa.Column("receipt_no", sa.String(14), nullable=False),
        sa.Column("period", sa.String(7), nullable=False),
        sa.Column("data", JSONB(), nullable=False),
        sa.UniqueConstraint("dataset_id", "corp_code", "receipt_no"),
    )
    op.create_index("ix_evidence_report_dataset_id", "evidence_report", ["dataset_id"])
    op.create_index("ix_evidence_report_corp_code", "evidence_report", ["corp_code"])
    op.create_table(
        "evidence_segment",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("report_id", sa.Uuid(), sa.ForeignKey("evidence_report.id"), nullable=False),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.Column("region", sa.String(24), nullable=False),
        sa.Column("scope", sa.String(16), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("location", JSONB(), nullable=False),
        sa.Column("data", JSONB(), nullable=False),
    )
    op.create_index("ix_evidence_segment_report_id", "evidence_segment", ["report_id"])
    op.create_table(
        "evidence_bundle",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("workspace_id", sa.Uuid(), sa.ForeignKey("workspace.id"), nullable=False),
        sa.Column("fingerprint", sa.String(64), nullable=False, unique=True),
        sa.Column("corp_code", sa.String(8), nullable=False),
        sa.Column("receipt_no", sa.String(14), nullable=False),
        sa.Column("scope", sa.String(3), nullable=False),
        sa.Column("period", sa.String(7), nullable=False),
        sa.Column("report_id", sa.Uuid(), sa.ForeignKey("evidence_report.id")),
        sa.Column("structure_ids", JSONB(), nullable=False),
        sa.Column("baseline", JSONB()),
        created(),
    )
    op.create_index("ix_evidence_bundle_workspace_id", "evidence_bundle", ["workspace_id"])
    op.create_table(
        "bundle_agent_run",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("bundle_id", sa.Uuid(), sa.ForeignKey("evidence_bundle.id"), nullable=False),
        sa.Column(
            "job_id", sa.Uuid(), sa.ForeignKey("analysis_job.id"), nullable=False, unique=True
        ),
        sa.Column("config_key", sa.String(64), nullable=False),
        sa.Column("config", JSONB(), nullable=False),
        created(),
    )
    op.create_index("ix_bundle_agent_run_bundle_id", "bundle_agent_run", ["bundle_id"])
    op.create_index("ix_bundle_agent_run_config_key", "bundle_agent_run", ["config_key"])


def downgrade():
    for table in (
        "bundle_agent_run",
        "evidence_bundle",
        "evidence_segment",
        "evidence_report",
        "evidence_dataset",
    ):
        op.drop_table(table)
