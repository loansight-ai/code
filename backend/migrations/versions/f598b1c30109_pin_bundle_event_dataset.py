"""Pin event observations to the evidence bundle instead of following latest."""

import sqlalchemy as sa
from alembic import op

revision = "f598b1c30109"
down_revision = "e487a0b20098"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("evidence_bundle", sa.Column("collection_import_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_evidence_bundle_collection_import_id_company_dataset_import",
        "evidence_bundle",
        "company_dataset_import",
        ["collection_import_id"],
        ["id"],
    )


def downgrade():
    op.drop_constraint(
        "fk_evidence_bundle_collection_import_id_company_dataset_import",
        "evidence_bundle",
        type_="foreignkey",
    )
    op.drop_column("evidence_bundle", "collection_import_id")
