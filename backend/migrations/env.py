"""Alembic environment: async engine, URL from app settings, metadata from every module's models."""

import asyncio
import logging

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.config import settings
from app.core.db import Base

# Import every module's models so autogenerate sees all tables. Add new modules here.
from app.modules.auth import models as _auth_models  # noqa: F401

if not logging.getLogger().handlers:  # CLI run (no alembic.ini): show "Running upgrade …" lines
    logging.basicConfig(level=logging.WARNING, format="%(levelname)-5.5s [%(name)s] %(message)s")
    logging.getLogger("alembic").setLevel(logging.INFO)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """`alembic upgrade head --sql`: emit SQL without connecting."""
    context.configure(
        url=settings.database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    engine = create_async_engine(settings.database_url, poolclass=pool.NullPool)
    async with engine.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_async_migrations())
