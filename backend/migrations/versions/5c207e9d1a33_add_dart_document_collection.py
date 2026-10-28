"""Preserve DART documents, viewer notes and collection requests."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "5c207e9d1a33"
down_revision = "4b98ac01e762"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "dart_document",
        sa.Column("receipt_no", sa.String(14), primary_key=True),
        sa.Column("corp_code", sa.String(8), sa.ForeignKey("company.corp_code"), nullable=False),
        sa.Column("archive_sha256", sa.String(64), nullable=False),
        sa.Column("archive_bytes", sa.Integer(), nullable=False),
        sa.Column("xml_files", JSONB(), nullable=False),
        sa.Column("toc_sha256", sa.String(64), nullable=False),
        sa.Column("locators", JSONB(), nullable=False),
        sa.Column(
            "collected_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_table(
        "dart_note",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "receipt_no", sa.String(14), sa.ForeignKey("dart_document.receipt_no"), nullable=False
        ),
        sa.Column("scope", sa.String(3), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("byte_length", sa.Integer(), nullable=False),
        sa.Column("encoding", sa.String(16), nullable=False),
        sa.Column("locator", JSONB(), nullable=False),
        sa.Column("collector_version", sa.String(32), nullable=False),
        sa.Column(
            "collected_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.UniqueConstraint("receipt_no", "scope"),
    )
    op.add_column("source_artifact", sa.Column("dart_note_id", sa.Uuid()))
    op.create_foreign_key(
        "fk_source_artifact_dart_note_id_dart_note",
        "source_artifact",
        "dart_note",
        ["dart_note_id"],
        ["id"],
    )
    op.create_table(
        "dart_collection_request",
        sa.Column("job_id", sa.Uuid(), sa.ForeignKey("analysis_job.id"), primary_key=True),
        sa.Column("workspace_id", sa.Uuid(), sa.ForeignKey("workspace.id"), nullable=False),
        sa.Column("context", JSONB(), nullable=False),
    )


def downgrade():
    op.drop_table("dart_collection_request")
    op.drop_constraint(
        "fk_source_artifact_dart_note_id_dart_note", "source_artifact", type_="foreignkey"
    )
    op.drop_column("source_artifact", "dart_note_id")
    op.drop_table("dart_note")
    op.drop_table("dart_document")
