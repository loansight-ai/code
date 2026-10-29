"""Bind provider-neutral agent requests to owner-scoped background jobs."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "7e214c5b0032"
down_revision = "6d103b4a0021"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "note_agent_run",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("workspace_id", sa.Uuid(), sa.ForeignKey("workspace.id"), nullable=False),
        sa.Column("structure_id", sa.Uuid(), sa.ForeignKey("note_structure.id"), nullable=False),
        sa.Column("job_id", sa.Uuid(), sa.ForeignKey("analysis_job.id"), nullable=False),
        sa.Column("config_key", sa.String(64), nullable=False),
        sa.Column("config", JSONB(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.UniqueConstraint("job_id"),
    )
    op.create_index("ix_note_agent_run_structure_id", "note_agent_run", ["structure_id"])
    op.create_index("ix_note_agent_run_config_key", "note_agent_run", ["config_key"])


def downgrade():
    op.drop_table("note_agent_run")
