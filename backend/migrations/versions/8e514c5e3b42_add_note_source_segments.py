"""Add immutable source artifacts, note structures and source segments.

Revision ID: 8e514c5e3b42
Revises: adaf5b89c881
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "8e514c5e3b42"
down_revision = "adaf5b89c881"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "source_artifact",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("source_key", sa.String(64), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("corp_code", sa.String(8), nullable=False),
        sa.Column("receipt_no", sa.String(14), nullable=False),
        sa.Column("scope", sa.String(3), nullable=False),
        sa.Column("period", sa.String(7), nullable=False),
        sa.Column("encoding", sa.String(16), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("byte_length", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_source_artifact")),
        sa.UniqueConstraint("source_key", name=op.f("uq_source_artifact_source_key")),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspace.id"],
            name=op.f("fk_source_artifact_workspace_id_workspace"),
        ),
    )
    op.create_index(op.f("ix_source_artifact_workspace_id"), "source_artifact", ["workspace_id"])
    op.create_table(
        "note_structure",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("artifact_id", sa.Uuid(), nullable=False),
        sa.Column("job_id", sa.Uuid(), nullable=False),
        sa.Column("parser_version", sa.String(32), nullable=False),
        sa.Column("adapter_version", sa.String(32), nullable=False),
        sa.Column("rules_sha256", sa.String(64), nullable=False),
        sa.Column("rules", postgresql.JSONB(), nullable=False),
        sa.Column("link_periods", sa.Boolean(), nullable=False),
        sa.Column("hierarchy", postgresql.JSONB(), nullable=True),
        sa.Column("segment_count", sa.Integer(), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_note_structure")),
        sa.UniqueConstraint("job_id", name=op.f("uq_note_structure_job_id")),
        sa.ForeignKeyConstraint(
            ["artifact_id"],
            ["source_artifact.id"],
            name=op.f("fk_note_structure_artifact_id_source_artifact"),
        ),
        sa.ForeignKeyConstraint(
            ["job_id"], ["analysis_job.id"], name=op.f("fk_note_structure_job_id_analysis_job")
        ),
    )
    op.create_index(op.f("ix_note_structure_artifact_id"), "note_structure", ["artifact_id"])
    op.create_table(
        "source_segment",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("structure_id", sa.Uuid(), nullable=False),
        sa.Column("local_id", sa.String(40), nullable=False),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("source_xpath", sa.Text(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("owner_node_id", sa.String(40), nullable=False),
        sa.Column("top_note_ids", postgresql.JSONB(), nullable=False),
        sa.Column("payload", postgresql.JSONB(), nullable=False),
        sa.Column("table_data", postgresql.JSONB(), nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_source_segment")),
        sa.UniqueConstraint(
            "structure_id", "local_id", name=op.f("uq_source_segment_structure_id")
        ),
        sa.UniqueConstraint("structure_id", "ordinal", name="uq_source_segment_structure_ordinal"),
        sa.ForeignKeyConstraint(
            ["structure_id"],
            ["note_structure.id"],
            name=op.f("fk_source_segment_structure_id_note_structure"),
        ),
    )
    op.create_index(op.f("ix_source_segment_structure_id"), "source_segment", ["structure_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_source_segment_structure_id"), table_name="source_segment")
    op.drop_table("source_segment")
    op.drop_index(op.f("ix_note_structure_artifact_id"), table_name="note_structure")
    op.drop_table("note_structure")
    op.drop_index(op.f("ix_source_artifact_workspace_id"), table_name="source_artifact")
    op.drop_table("source_artifact")
