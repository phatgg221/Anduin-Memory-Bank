"""enable pgvector

Revision ID: bf40c273d236
Revises:
Create Date: 2026-10-14 17:27:56.755653

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "bf40c273d236"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Hand-written: autogenerate doesn't manage extensions. Needed before any vector(…) column exists.
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")


def downgrade() -> None:
    op.execute("DROP EXTENSION IF EXISTS vector")
