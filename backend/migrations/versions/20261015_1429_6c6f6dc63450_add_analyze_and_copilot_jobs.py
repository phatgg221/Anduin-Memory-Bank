"""add analyze and copilot jobs

Revision ID: 6c6f6dc63450
Revises: 38743878dc51
Create Date: 2026-10-15 14:29:42.606730

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "6c6f6dc63450"
down_revision: str | Sequence[str] | None = "38743878dc51"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("case_jobs", sa.Column("input", postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.drop_constraint(op.f("ck_case_jobs_kind"), "case_jobs", type_="check")
    op.create_check_constraint(
        op.f("ck_case_jobs_kind"), "case_jobs", "kind IN ('ANALYZE', 'SUMMARIZE', 'INDEX', 'COPILOT')"
    )
    op.drop_index("uq_case_jobs_one_active", table_name="case_jobs")
    op.create_index(
        "uq_case_jobs_one_active",
        "case_jobs",
        ["case_id", "kind"],
        unique=True,
        postgresql_where=sa.text("status IN ('QUEUED', 'PROCESSING') AND kind <> 'COPILOT'"),
    )


def downgrade() -> None:
    op.execute("DELETE FROM case_jobs WHERE kind IN ('ANALYZE', 'COPILOT')")
    op.drop_index("uq_case_jobs_one_active", table_name="case_jobs")
    op.create_index(
        "uq_case_jobs_one_active",
        "case_jobs",
        ["case_id", "kind"],
        unique=True,
        postgresql_where=sa.text("status IN ('QUEUED', 'PROCESSING')"),
    )
    op.drop_constraint(op.f("ck_case_jobs_kind"), "case_jobs", type_="check")
    op.create_check_constraint(op.f("ck_case_jobs_kind"), "case_jobs", "kind IN ('SUMMARIZE', 'INDEX')")
    op.drop_column("case_jobs", "input")
