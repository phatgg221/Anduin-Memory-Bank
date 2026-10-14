"""Idempotent schema bootstrap.

create_all only knows about models that have been imported, so import every module's models.py here once
the data model is agreed (it's deliberately undecided — see ARCHITECTURE.md §9), e.g.:

    from app.modules.vault import models as _vault_models  # noqa: F401

Usage: python -m app.db.schema refresh   # drop + recreate all tables (bun run dev --refresh-db)
"""

import asyncio
import sys

from sqlalchemy import text

from app.db.base import Base
from app.db.session import engine


async def init_db() -> None:
    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        await conn.run_sync(Base.metadata.create_all)


async def drop_all() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


async def _refresh() -> None:
    await drop_all()
    await init_db()
    await engine.dispose()
    print(f"Schema refreshed ({len(Base.metadata.tables)} tables).")


if __name__ == "__main__":
    if sys.argv[1:] != ["refresh"]:
        sys.exit("usage: python -m app.db.schema refresh")
    asyncio.run(_refresh())
