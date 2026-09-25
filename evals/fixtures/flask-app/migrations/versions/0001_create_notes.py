import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None


def upgrade():
    op.create_table(
        "notes",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("owner_id", sa.Integer, nullable=False, index=True),
        sa.Column("title", sa.String(200), nullable=False),
    )


def downgrade():
    op.drop_table("notes")
