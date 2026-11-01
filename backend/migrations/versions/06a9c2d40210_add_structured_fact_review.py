"""Structured fact candidates, immutable revisions and audited human review."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "06a9c2d40210"
down_revision = "f598b1c30109"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "evidence_fact",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("bundle_id", sa.Uuid(), sa.ForeignKey("evidence_bundle.id"), nullable=False),
        sa.Column("root_id", sa.Uuid(), nullable=False),
        sa.Column("supersedes_id", sa.Uuid(), sa.ForeignKey("evidence_fact.id"), unique=True),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("fingerprint", sa.String(64), unique=True, nullable=False),
        sa.Column("comparison_key", sa.String(64), nullable=False),
        sa.Column("value_key", sa.String(64), nullable=False),
        sa.Column("data", JSONB(), nullable=False),
        sa.Column("validation", JSONB(), nullable=False),
        sa.Column("origin", JSONB(), nullable=False),
        sa.Column("state", sa.String(16), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_evidence_fact_bundle_id", "evidence_fact", ["bundle_id"])
    op.create_index("ix_evidence_fact_comparison_key", "evidence_fact", ["comparison_key"])
    op.create_table(
        "fact_opening",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("fact_id", sa.Uuid(), sa.ForeignKey("evidence_fact.id"), nullable=False),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("app_user.id"), nullable=False),
        sa.Column("fact_version", sa.Integer(), nullable=False),
        sa.Column("source_digest", sa.String(64), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_fact_opening_fact_id", "fact_opening", ["fact_id"])
    op.create_table(
        "fact_review",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("fact_id", sa.Uuid(), sa.ForeignKey("evidence_fact.id"), nullable=False),
        sa.Column("request_id", sa.Uuid(), nullable=False),
        sa.Column("reviewer_id", sa.Uuid(), sa.ForeignKey("app_user.id"), nullable=False),
        sa.Column("opening_id", sa.Uuid(), sa.ForeignKey("fact_opening.id")),
        sa.Column("decision", sa.String(16), nullable=False),
        sa.Column("reason", sa.String(2000), nullable=False),
        sa.Column("before_state", sa.String(16), nullable=False),
        sa.Column("after_state", sa.String(16), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("fact_id", "request_id"),
    )
    op.create_index("ix_fact_review_fact_id", "fact_review", ["fact_id"])
    op.create_table(
        "fact_extraction",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("bundle_id", sa.Uuid(), sa.ForeignKey("evidence_bundle.id"), nullable=False),
        sa.Column(
            "job_id", sa.Uuid(), sa.ForeignKey("analysis_job.id"), unique=True, nullable=False
        ),
        sa.Column("config_key", sa.String(64), nullable=False),
        sa.Column("config", JSONB(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_fact_extraction_bundle_id", "fact_extraction", ["bundle_id"])
    op.create_index("ix_fact_extraction_config_key", "fact_extraction", ["config_key"])


def downgrade():
    for name in ("fact_extraction", "fact_review", "fact_opening", "evidence_fact"):
        op.drop_table(name)
