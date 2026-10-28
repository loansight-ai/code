"""Save owner-scoped, reproducible baseline keyword searches."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "6d103b4a0021"
down_revision = "5c207e9d1a33"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "note_search_run",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("workspace_id", sa.Uuid(), sa.ForeignKey("workspace.id"), nullable=False),
        sa.Column("structure_id", sa.Uuid(), sa.ForeignKey("note_structure.id"), nullable=False),
        sa.Column("dictionary_version", sa.String(40), nullable=False),
        sa.Column("tool_version", sa.String(40), nullable=False),
        sa.Column("result", JSONB(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.UniqueConstraint("workspace_id", "structure_id", "dictionary_version", "tool_version"),
    )
    op.create_index("ix_note_search_run_structure_id", "note_search_run", ["structure_id"])


def downgrade():
    op.drop_index("ix_note_search_run_structure_id", table_name="note_search_run")
    op.drop_table("note_search_run")
