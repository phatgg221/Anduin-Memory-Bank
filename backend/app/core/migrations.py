"""Alembic from code. The schema is owned by migrations in backend/migrations/ — never by create_all.

- The backend container runs `alembic upgrade head` before starting uvicorn (see Dockerfile).
- `reset()` wipes the public schema and re-applies every migration: `bun run db:reset`, `bun run dev --refresh-db`,
  and the test suite. Dev/test only.

Usage: python -m app.core.migrations reset
"""

import asyncio
import sys
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.config import settings

BACKEND_ROOT = Path(__file__).resolve().parents[2]


def alembic_config() -> Config:
    return Config(toml_file=BACKEND_ROOT / "pyproject.toml")


def upgrade_to_head() -> None:
    """Must be called outside a running event loop (env.py drives its own)."""
    command.upgrade(alembic_config(), "head")


async def _drop_public_schema() -> None:
    engine = create_async_engine(settings.database_url)
    async with engine.begin() as conn:
        # Drops every table, alembic_version, and the pgvector extension; migrations recreate them.
        await conn.execute(text("DROP SCHEMA public CASCADE"))
        await conn.execute(text("CREATE SCHEMA public"))
    await engine.dispose()


def reset() -> None:
    asyncio.run(_drop_public_schema())
    upgrade_to_head()


if __name__ == "__main__":
    if sys.argv[1:] != ["reset"]:
        sys.exit("usage: python -m app.core.migrations reset")
    reset()
    print("Database reset and migrated to head.")
